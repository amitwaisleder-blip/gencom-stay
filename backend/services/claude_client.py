"""Thin wrapper around the Anthropic SDK with JSON-output handling, retry, and
prompt loading. Used by the extractor service and the cost-engine AI fallback.
"""
from __future__ import annotations

import base64
import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

from anthropic import Anthropic, APIError, BadRequestError
from pydantic import BaseModel, ValidationError

from config import BACKEND_DIR, settings


logger = logging.getLogger(__name__)

PROMPTS_DIR = BACKEND_DIR / "prompts"


class ClaudeError(Exception):
    """Raised when a Claude call can't return usable JSON."""
    pass


_client: Optional[Anthropic] = None


def client() -> Anthropic:
    global _client
    if _client is None:
        if not settings.anthropic_api_key:
            raise ClaudeError(
                "No ANTHROPIC_API_KEY configured. Set it in backend/.env "
                "or via the settings screen."
            )
        _client = Anthropic(api_key=settings.anthropic_api_key)
    return _client


def load_prompt(name: str, substitutions: dict[str, str] | None = None) -> str:
    path = PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"Prompt not found: {path}")
    text = path.read_text(encoding="utf-8")
    for k, v in (substitutions or {}).items():
        text = text.replace("{{" + k + "}}", v)
    return text


_JSON_OBJECT_RE = re.compile(r"\{[\s\S]*\}\s*$")


def _find_balanced_json(text: str) -> Optional[str]:
    """Scan text for the first balanced JSON object (`{...}`) and return it.

    Tracks brace depth while ignoring braces inside string literals (handling
    escapes). Returns None if no balanced object is found.
    """
    in_str = False
    escape = False
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                return text[start : i + 1]
    return None


def _extract_json(text: str) -> Any:
    text = text.strip()
    # Strip common markdown fences if the model disobeys instructions.
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try greedy trailing-object match first (preserves prior behavior).
        m = _JSON_OBJECT_RE.search(text)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
        # Fall back to brace-balanced scan, which handles preambles + trailing
        # commentary that the greedy regex misses.
        candidate = _find_balanced_json(text)
        if candidate:
            return json.loads(candidate)
        raise


def _stream_text(
    *, model: str, max_tokens: int, system: str, messages: list[dict]
) -> tuple[str, Optional[str]]:
    """Call Claude with streaming and return (accumulated_text, stop_reason).

    Streaming is required by the API for long requests (>10 min wall-clock),
    which is easy to hit at large max_tokens on Opus — so we stream every call.
    """
    try:
        with client().messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=messages,
        ) as stream:
            for _ in stream.text_stream:
                pass
            final = stream.get_final_message()
    except BadRequestError as e:
        msg = str(e)
        if "credit balance" in msg.lower():
            raise ClaudeError(
                "Anthropic API credit balance is too low. Add credits at https://console.anthropic.com/settings/billing, then retry."
            )
        raise ClaudeError(f"Anthropic API error: {msg}")
    except APIError as e:
        raise ClaudeError(f"Anthropic API error: {e}")

    text = "".join(
        block.text for block in final.content if getattr(block, "type", None) == "text"
    )
    return text, getattr(final, "stop_reason", None)


def complete_json(
    *,
    system: str,
    user_content: list[dict],
    model: Optional[str] = None,
    max_tokens: int = 8000,
    retry_on_invalid_json: bool = True,
) -> dict:
    """Call Claude and return parsed JSON.

    `user_content` is a list of content blocks (text / document / image) as
    supported by the Anthropic API.
    """
    m = model or settings.extraction_model
    text, stop_reason = _stream_text(
        model=m,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_content}],
    )
    try:
        return _extract_json(text)
    except Exception as e:
        # If Claude stopped because it hit the output-token ceiling, the JSON is
        # truncated mid-object. Retrying with the same ceiling will truncate
        # again — surface a targeted error instead.
        if stop_reason == "max_tokens":
            raise ClaudeError(
                f"Claude response was truncated at max_tokens={max_tokens}. "
                f"The document likely contains more content than fits in one response. "
                f"Increase max_tokens or split the input."
            )
        if not retry_on_invalid_json:
            raise ClaudeError(f"Invalid JSON from Claude: {e}. Response: {text[:500]}")
        # One retry with the error appended.
        followup = (
            f"Your previous response could not be parsed as JSON: {e}.\n"
            "Return ONLY the JSON object. No preamble, no markdown fences."
        )
        retry_text, retry_stop = _stream_text(
            model=m,
            max_tokens=max_tokens,
            system=system,
            messages=[
                {"role": "user", "content": user_content},
                {"role": "assistant", "content": [{"type": "text", "text": text}]},
                {"role": "user", "content": [{"type": "text", "text": followup}]},
            ],
        )
        try:
            return _extract_json(retry_text)
        except Exception as e2:
            if retry_stop == "max_tokens":
                raise ClaudeError(
                    f"Claude response was truncated at max_tokens={max_tokens} on retry. "
                    f"Increase max_tokens or split the input."
                )
            raise ClaudeError(f"Invalid JSON after retry: {e2}. Response: {retry_text[:500]}")


def pdf_block(path: Path) -> dict:
    """Build an Anthropic document block for a PDF file."""
    data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    return {
        "type": "document",
        "source": {"type": "base64", "media_type": "application/pdf", "data": data},
    }


def image_block(path: Path) -> dict:
    ext = path.suffix.lower().lstrip(".")
    media_type = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
                  "gif": "image/gif", "webp": "image/webp"}.get(ext, "image/jpeg")
    data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": data},
    }


def text_block(text: str) -> dict:
    return {"type": "text", "text": text}
