"""Scope-aware chat endpoint. Streams Claude responses over plain-text
chunked HTTP. The system prompt is seeded with the property's metadata and
a compact scope summary so Claude can answer questions like "why is my
soft-cost total so high?" or "suggest a cost for the sleeper sofa" without
the user having to restate context each turn.
"""
from __future__ import annotations

import json
import logging
from typing import Iterator, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db import get_db
from models.entities import Property, ScopeItem
from services.claude_client import client as claude_client, ClaudeError, load_prompt
from config import settings


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/properties/{property_id}/chat", tags=["chat"])


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    # Optional extra text to append to the system prompt's context. Used by the
    # PIP preview flow to let Claude see items that haven't been imported yet
    # (e.g. "here are 125 pending items Claude flagged as unclear…").
    extra_context: Optional[str] = None


def _property_context(prop: Property) -> str:
    return (
        f"Property: {prop.name or '(unnamed)'}\n"
        f"Location: {prop.city or '?'}, {prop.state or '?'} {prop.country or ''}\n"
        f"Current: {prop.current_brand or '?'} {prop.current_flag or ''}\n"
        f"Target: {prop.target_brand or '?'} {prop.target_flag or ''} ({prop.target_brand_tier or '?'})\n"
        f"Type: {prop.property_type or '?'}  |  Keys: {prop.keys or '?'}  |  Floors: {prop.floors or '?'}  |  GSF: {prop.total_gsf or '?'}\n"
        f"Year built / renovated: {prop.year_built or '?'} / {prop.year_last_renovated or '?'}\n"
        f"Guestroom mix: {prop.guestroom_mix or '{}'}\n"
        f"Meeting space: {prop.meeting_space_json or '{}'}\n"
        f"F&B outlets: {prop.fb_outlets or '[]'}"
    )


def _scope_summary(items: list[ScopeItem]) -> str:
    """Compact summary of active scope — division totals + counts."""
    active = [i for i in items if i.included_in_budget and not i.deleted]
    if not active:
        return "(no scope items yet)"

    # Division rollup
    div_totals: dict[str, tuple[int, float]] = {}
    grand = 0.0
    for it in active:
        total = it.line_total()
        grand += total
        cur = div_totals.get(it.division, (0, 0.0))
        div_totals[it.division] = (cur[0] + 1, cur[1] + total)

    lines = [f"Scope totals (active items only): ${grand:,.0f} across {len(active)} items"]
    for div, (count, total) in sorted(div_totals.items(), key=lambda kv: -kv[1][1]):
        lines.append(f"  - {div}: {count} items · ${total:,.0f}")

    # List top 25 items by cost so Claude can reference specifics.
    sorted_items = sorted(active, key=lambda i: -i.line_total())[:25]
    lines.append("")
    lines.append("Top items by cost (up to 25):")
    for it in sorted_items:
        cost = it.line_total()
        lines.append(
            f"  - [{it.division}] {it.line_item} · qty {it.effective_quantity():g} {it.unit} · "
            f"${it.effective_unit_cost():,.0f}/unit · ${cost:,.0f} total · priority {it.priority}"
        )

    return "\n".join(lines)


def _system_prompt(prop: Property, scope_items: list[ScopeItem]) -> str:
    try:
        base = load_prompt("chat_system")
    except FileNotFoundError:
        base = (
            "You are an expert assistant helping a hotel development PM plan a renovation budget. "
            "Be concise, specific, and numerate. Use the property + scope context below to answer."
        )
    return (
        f"{base}\n\n"
        f"## Property context\n{_property_context(prop)}\n\n"
        f"## Scope context\n{_scope_summary(scope_items)}"
    )


@router.post("")
def chat(property_id: str, payload: ChatRequest, db: Session = Depends(get_db)):
    prop = db.get(Property, property_id)
    if not prop:
        raise HTTPException(404, "Property not found")
    if not payload.messages:
        raise HTTPException(400, "No messages provided")

    scope_items = list(prop.scope_items)
    system = _system_prompt(prop, scope_items)
    if payload.extra_context and payload.extra_context.strip():
        system += "\n\n## Additional context (preview / unapproved items)\n" + payload.extra_context.strip()
    anthropic_messages = [{"role": m.role, "content": m.content} for m in payload.messages]

    def gen() -> Iterator[bytes]:
        try:
            with claude_client().messages.stream(
                model=settings.extraction_model,
                max_tokens=4000,
                system=system,
                messages=anthropic_messages,
            ) as stream:
                for text in stream.text_stream:
                    if text:
                        yield text.encode("utf-8")
        except Exception as e:
            logger.exception("chat stream failed")
            # Emit a prefixed error so the client can surface it.
            yield f"\n\n[ERROR: {e}]".encode("utf-8")

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")
