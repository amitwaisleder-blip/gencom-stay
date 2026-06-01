"""Org Chart API — currently a single endpoint that takes a sketch
(PDF or image of a hand-drawn ownership/reporting diagram) and asks
Claude to reconstruct it into a structured chart that the frontend
editor can render directly.

The rest of the Org Chart app is fully client-side (boxes/connectors
live in localStorage); this route exists only because the AI sketch
parsing needs the Anthropic API key, which the frontend doesn't ship
with.
"""
from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, ValidationError

from services.claude_client import ClaudeError, complete_json, text_block


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/orgchart", tags=["orgchart"])


# ---------- Schemas mirroring the frontend ChartState shape ---------
# The frontend treats these as authoritative; if you add a field here,
# also update `lib/types.ts` so the editor reads it.

EntityType = Literal[
    "LLC", "Corporation", "LP", "LLP", "Trust", "Individual", "Partnership", "Other",
]
RouteStyle = Literal["orthogonal", "straight"]
ConnectorSide = Literal["top", "right", "bottom", "left"]


class AIBox(BaseModel):
    name: str
    entity_type: EntityType = Field("LLC", alias="entityType")
    ownership_pct: Optional[float] = Field(None, alias="ownershipPct")
    x: float
    y: float
    width: float = 200
    height: float = 90

    model_config = {"populate_by_name": True}


class AIConnector(BaseModel):
    from_name: str = Field(alias="fromName")
    to_name: str = Field(alias="toName")
    label: Optional[str] = None
    from_side: Optional[ConnectorSide] = Field(None, alias="fromSide")
    to_side: Optional[ConnectorSide] = Field(None, alias="toSide")

    model_config = {"populate_by_name": True}


class AIChart(BaseModel):
    """Loose intermediate shape Claude returns. We resolve `from_name`
    / `to_name` to internal box ids before sending to the frontend."""
    title: str = "Imported sketch"
    boxes: list[AIBox]
    connectors: list[AIConnector] = []


SKETCH_SYSTEM = """\
You read hand-drawn or digital sketches of organizational and ownership
structure charts and return them as structured JSON. The user's sketch
will show boxes (each labeled with an entity name, sometimes an
ownership % or entity type like LLC/LP/Trust) connected by lines or
arrows showing reporting / ownership relationships.

Return JSON in EXACTLY this shape (no markdown, no commentary):

{
  "title": "<short chart name inferred from the sketch, or 'Imported sketch'>",
  "boxes": [
    {
      "name": "<exact label as written>",
      "entityType": "LLC|Corporation|LP|LLP|Trust|Individual|Partnership|Other",
      "ownershipPct": <number or null>,
      "x": <integer pixel x, top-left>,
      "y": <integer pixel y, top-left>,
      "width": <integer pixels, default 200 if unsure>,
      "height": <integer pixels, default 90 if unsure>
    }
  ],
  "connectors": [
    {
      "fromName": "<exact name of parent box>",
      "toName": "<exact name of child box>",
      "fromSide": "top|right|bottom|left",
      "toSide": "top|right|bottom|left"
    }
  ]
}

Rules:
1. PRESERVE THE SKETCH'S LAYOUT. Place boxes at coordinates that mirror
   the relative positions in the sketch — if box A is above-and-left
   of box B, that should be true in your output too. Use a coordinate
   system roughly 1200 wide × 800 tall (you can exceed if the sketch
   has many levels). Top-left of the canvas is (0, 0).
2. KEEP BOX SIZES SIMILAR. Use 180–240 wide × 70–110 tall by default.
   If the sketch shows visibly larger boxes (e.g. a parent twice the
   width of children), reflect that proportion. Don't make every box
   the same size if the sketch doesn't.
3. SPACE BOXES so they don't overlap — leave at least 40px between any
   two boxes' edges.
4. CONNECTORS go from PARENT (higher in the hierarchy) to CHILD. If the
   arrow direction is unclear, use position: the higher box is parent.
   `fromSide` and `toSide` should match where the line attaches in the
   sketch. Most org charts have connectors leaving the parent's bottom
   ("fromSide": "bottom") and entering the child's top ("toSide":
   "top") — use those defaults when in doubt.
5. ENTITY TYPE: pick from the suffix in the label (LLC, LP, Inc., Corp,
   Trust, etc.). Default to "LLC" if no suffix is visible. Use
   "Individual" for personal names without an entity suffix.
6. OWNERSHIP %: only fill if the sketch shows a percentage on or near
   the connector or inside the box. Otherwise null.
7. EVERY connector's `fromName` and `toName` MUST exactly match a name
   in the `boxes` array — no orphan references.

Return ONLY the JSON object. No preamble, no explanation, no markdown
fences.
"""


@router.post("/import-sketch")
async def import_sketch(file: UploadFile = File(...)) -> dict:
    """Parse a single PDF or image sketch into a ChartState payload."""
    name = file.filename or "sketch"
    suffix = Path(name).suffix.lower()
    content = await file.read()

    if not content:
        raise HTTPException(400, "Uploaded file is empty.")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 20 MB).")

    user_content: list[dict] = [
        text_block(
            "Reconstruct the org / ownership chart shown in the attached "
            "file. Preserve the layout and relative box sizes as best you can. "
            "Output ONLY the JSON object."
        )
    ]

    if suffix == ".pdf":
        user_content.append({
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(content).decode("ascii"),
            },
        })
    elif suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif"}:
        # HEIC/HEIF aren't accepted by Anthropic directly; flag those rather
        # than silently failing inside the SDK call.
        if suffix in {".heic", ".heif"}:
            raise HTTPException(
                415,
                "HEIC/HEIF images aren't supported — convert to PNG or JPEG and try again.",
            )
        media = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp",
        }[suffix]
        user_content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media,
                "data": base64.standard_b64encode(content).decode("ascii"),
            },
        })
    else:
        raise HTTPException(
            415,
            f"Unsupported file type '{suffix or '<none>'}'. Upload a PDF or PNG/JPEG/WebP image.",
        )

    try:
        data = complete_json(
            system=SKETCH_SYSTEM,
            user_content=user_content,
            max_tokens=8000,
        )
    except ClaudeError as e:
        raise HTTPException(502, f"Claude couldn't read the sketch: {e}")

    try:
        ai_chart = AIChart.model_validate(data)
    except ValidationError as e:
        # Surface the first error in plain English — full pydantic dumps are
        # noisy and unhelpful in a toast.
        first = e.errors()[0]
        loc = ".".join(str(p) for p in first.get("loc", []))
        raise HTTPException(
            502,
            f"Claude returned an unexpected shape ({loc}: {first.get('msg')}). "
            f"Try a clearer image or re-run.",
        )

    if not ai_chart.boxes:
        raise HTTPException(
            502,
            "Claude didn't find any boxes in the sketch. Try a clearer image "
            "or one with darker lines.",
        )

    chart_dict, summary = _materialize_chart(ai_chart)
    return {"chart": chart_dict, "summary": summary}


# ---------- helpers ------------------------------------------------

def _materialize_chart(ai: AIChart) -> tuple[dict, dict]:
    """Convert the AI's name-keyed connectors into the frontend's
    id-keyed ChartState. Resolves duplicate names (same label appears
    on two boxes) by matching the FIRST occurrence — Claude is told to
    use exact names, so duplicates are rare and equally valid.
    """
    import secrets

    notes: list[str] = []
    boxes_out: list[dict] = []
    name_to_id: dict[str, str] = {}

    # Reasonable theme defaults — the frontend will overwrite these
    # to match the chart's active theme on apply, but we ship a
    # legible legal-white palette so the chart is usable raw if the
    # frontend code path skips re-theming.
    fill = "#FFFFFF"
    border = "#000000"
    text_color = "#000000"

    for b in ai.boxes:
        bid = "imp_ai_" + secrets.token_hex(4)
        # First-wins for duplicate names so connector resolution is
        # deterministic. Subsequent boxes still render fine — they
        # just won't be selectable as connector endpoints.
        if b.name not in name_to_id:
            name_to_id[b.name] = bid
        boxes_out.append({
            "id": bid,
            "name": b.name,
            "entityType": b.entity_type,
            "ownershipPct": b.ownership_pct,
            "fillColor": fill,
            "borderColor": border,
            "textColor": text_color,
            "x": int(round(b.x)),
            "y": int(round(b.y)),
            "width": max(120, int(round(b.width))),
            "height": max(60, int(round(b.height))),
        })

    connectors_out: list[dict] = []
    seen_pairs: set[tuple[str, str]] = set()
    dropped = 0
    for c in ai.connectors:
        from_id = name_to_id.get(c.from_name)
        to_id = name_to_id.get(c.to_name)
        if not from_id or not to_id or from_id == to_id:
            dropped += 1
            continue
        # Dedupe ignoring direction — same logical edge twice in either
        # direction collapses to one connector.
        key = tuple(sorted([from_id, to_id]))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        cid = "imp_ai_c_" + secrets.token_hex(4)
        conn: dict = {
            "id": cid,
            "fromBoxId": from_id,
            "toBoxId": to_id,
            "routeStyle": "orthogonal",
            "showArrowhead": True,
        }
        if c.from_side:
            conn["fromSide"] = c.from_side
        if c.to_side:
            conn["toSide"] = c.to_side
        connectors_out.append(conn)

    if dropped > 0:
        notes.append(
            f"{dropped} connector{'s' if dropped != 1 else ''} couldn't be "
            "matched to a box and were dropped — re-link in the editor.",
        )

    chart_dict = {
        "version": 1,
        "title": ai.title or "Imported sketch",
        # The frontend overrides theme on apply; we emit "legal-white"
        # so a raw response is still rendered legibly.
        "theme": "legal-white",
        "boxes": boxes_out,
        "connectors": connectors_out,
        "uniformSize": False,
    }

    summary = {
        "boxes": len(boxes_out),
        "connectors": len(connectors_out),
        "notes": notes,
    }
    return chart_dict, summary
