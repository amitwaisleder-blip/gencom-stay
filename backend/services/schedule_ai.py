"""Claude-backed helpers for the Schedule Generator.

`recommend_durations` — given the wizard state, return per-phase design
durations (concept / sd / dd / cd) in weeks plus a one-sentence rationale
per phase naming the top 1–2 drivers.

The system prompt encodes industry baselines + adjustment rules so the model
doesn't have to invent them. It returns strict JSON; the API layer maps the
response to the frontend's DesignTimeline state shape.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from services.claude_client import complete_json, text_block, ClaudeError


logger = logging.getLogger(__name__)


_DURATIONS_SYSTEM = """You are a hospitality renovation scheduling expert. Given project context, recommend per-phase design durations (in weeks) and explain the reasoning.

Return ONLY a JSON object — no preamble, no markdown fences:
{
  "concept": <number>,
  "sd": <number>,
  "dd": <number>,
  "cd": <number>,
  "rationale": {
    "concept": "<one short sentence>",
    "sd": "<one short sentence>",
    "dd": "<one short sentence>",
    "cd": "<one short sentence>"
  }
}

Industry baselines (urban full-renovation, mid-tier ID firm, 1 owner review per phase, no brand approval gate):
- Concept Design: 6–8 weeks
- Schematic Design: 8–12 weeks
- Design Development: 10–14 weeks
- CD / FF&E Specifications: 10–14 weeks

Adjustment rules:
- ID firm tier: boutique ≈ baseline (capacity-limited on large scope); mid ≈ baseline; global adds 1–2 weeks per phase (more review layers).
- Architect engagement: separate AOR adds 1–2 weeks per phase for cross-discipline coordination; in-house or ID-firm-in-house adds 0.
- Scope size: more than 6 selected scope buckets adds 1 week to SD and DD.
- Property keys: 250+ keys adds 1 week to DD and 1 week to CD.
- Brand standards review (yes): adds 1 week per phase.
- Brand approval gates flagged at end of a phase: adds 2 weeks to that phase.
- Owner review cycles per phase: each cycle beyond 1 adds 1 week to that phase.
- Multi-firm concept competition: adds 4 weeks to Concept (parallel firm work + selection).
- Mockup at end of CD: adds 2 weeks to CD.
- Existing conditions survey work lives in Pre-Design; do NOT extend design phases for it.
- Procurement agent during DD: does NOT extend DD; flag in rationale only.

Each rationale must be one sentence naming the top 1–2 drivers (e.g. "12 weeks: global ID firm + brand approval gate at end of SD"). Round all phase numbers to whole or half weeks. If the user has selected a project type other than full_renovation or amenity, return baseline values and note the limitation in the rationale."""


def recommend_durations(state: dict[str, Any]) -> dict[str, Any]:
    """Call Claude for per-phase duration recommendations.

    Returns:
        {"concept": 6, "sd": 10, "dd": 12, "cd": 12,
         "rationale": {"concept": "...", "sd": "...", "dd": "...", "cd": "..."}}
    """
    # Compact the state down to just the fields the model actually needs —
    # smaller payload, lower token cost, less chance of distraction.
    relevant = {
        "projectType": state.get("projectType"),
        "property": {
            k: (state.get("property") or {}).get(k)
            for k in ("name", "brand", "keys", "propertyType", "location")
        },
        "scope": [k for k, v in (state.get("scope") or {}).items() if v],
        "designTeam": state.get("designTeam"),
        "designProcess": state.get("designProcess"),
    }

    try:
        result = complete_json(
            system=_DURATIONS_SYSTEM,
            user_content=[text_block(
                "Project context:\n```json\n" + json.dumps(relevant, indent=2) + "\n```\n"
                "Recommend per-phase durations in weeks."
            )],
            max_tokens=1200,
        )
    except ClaudeError as e:
        logger.exception("AI duration recommendation failed")
        raise

    # Defensive normalization — the model occasionally returns string numbers
    # or wraps the response in an extra key. Coerce to floats and ensure all
    # required keys are present.
    out = {}
    for k in ("concept", "sd", "dd", "cd"):
        v = result.get(k)
        try:
            out[k] = float(v)
        except (TypeError, ValueError):
            raise ClaudeError(f"AI returned non-numeric duration for '{k}': {v!r}")
    rat = result.get("rationale") or {}
    out["rationale"] = {
        k: str(rat.get(k) or "") for k in ("concept", "sd", "dd", "cd")
    }
    return out
