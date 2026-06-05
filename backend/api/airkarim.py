"""AirKarim AI endpoints — document extraction for trip planning and city
recommendations for bars/restaurants. Uses the shared claude_client streaming
JSON helper; nothing is persisted server-side (AirKarim state lives in
localStorage on the frontend)."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Form
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Iterator

from config import UPLOADS_DIR
from db import get_db
from models.entities import AirKarimTrip, AirKarimFile
from services.airkarim_ics import trip_to_ics
from services.claude_client import (
    ClaudeError,
    client as claude_client,
    complete_json,
    image_block,
    pdf_block,
    text_block,
)
from config import settings


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/airkarim", tags=["airkarim"])


TRIP_EXTRACTION_SYSTEM = """You are AirKarim — an executive trip-planning assistant. You receive one or more travel documents (itineraries, boarding passes, hotel confirmations, meeting agendas, ground-transport confirmations) and return a single normalized trip as JSON.

Return ONLY a JSON object matching this schema (no prose, no markdown fences):

{
  "title": string,
  "purpose": string,
  "startDate": ISO 8601 datetime string,
  "endDate": ISO 8601 datetime string,
  "destinations": [{ "city": string, "arriveAt"?: ISO, "departAt"?: ISO }],
  "flights": [{
    "airline": string, "flightNumber": string, "aircraftType"?: string,
    "departAirport": string, "departCity"?: string, "departTerminal"?: string, "departGate"?: string, "departAt": ISO,
    "arriveAirport": string, "arriveCity"?: string, "arriveTerminal"?: string, "arriveGate"?: string, "arriveAt": ISO,
    "confirmation"?: string, "seat"?: string, "cabin"?: string, "durationMin"?: number, "notes"?: string
  }],
  "lodging": [{
    "hotel": string, "address": string, "city"?: string,
    "checkInAt": ISO, "checkOutAt": ISO,
    "confirmation"?: string, "roomType"?: string, "phone"?: string, "notes"?: string
  }],
  "meetings": [{
    "title": string, "startAt": ISO, "endAt": ISO,
    "location": string, "address": string, "city"?: string,
    "attendees": [{ "name": string, "company"?: string, "title"?: string, "email"?: string, "phone"?: string }],
    "agenda"?: string, "materials"?: string, "notes"?: string
  }],
  "dining": [{
    "restaurant": string, "address": string, "city"?: string, "time": ISO,
    "reservation"?: string, "partySize"?: number, "dressCode"?: string, "notes"?: string
  }],
  "ground": [{
    "transportKind": "car" | "limo" | "taxi" | "rideshare" | "rail" | "walk" | "other",
    "provider"?: string, "pickup": string, "dropoff": string, "time": ISO,
    "confirmation"?: string, "driverContact"?: string, "notes"?: string
  }],
  "contacts": [{ "name": string, "role"?: string, "phone"?: string, "email"?: string }],
  "documents": [{ "label": string, "docType"?: string, "note"?: string }],
  "notes"?: string
}

Rules:
- Use 3-letter IATA codes for airports when you can recognize them (MIA, LGA, LHR, etc.)
- Airport terminals/gates: include only if explicitly stated.
- If dates have no explicit year, pick the year that makes the trip fall in the future relative to 2026.
- If you can't find a field, OMIT it (don't fabricate).
- `title` should be short and descriptive: "Paris — Gencom IC" or "NY Site Walk — Q2".
- Add a documents entry for each input document so the trip retains a paper trail.
- Output ONLY the JSON object. No prose, no markdown."""


RECOMMENDATIONS_SYSTEM = """You are AirKarim's concierge. You are given a city (and optionally a neighborhood or hotel name) plus a category of venue. Return a ranked list of 6-10 actual, real, currently-operating venues.

Ranking priority (highest first):
- Michelin Guide listings (stars, bib gourmand, or recommended)
- The Infatuation (their city guides)
- Eater (city guides / 38 / essentials)

Return ONLY a JSON object:
{
  "city": string,
  "category": string,
  "venues": [{
    "name": string,
    "cuisine_or_style": string,
    "neighborhood": string,
    "source": "Michelin" | "Infatuation" | "Eater",
    "accolade": string,
    "website": string,
    "why": string,
    "price_range": "$" | "$$" | "$$$" | "$$$$"
  }]
}

Rules:
- `website` must be the venue's own URL (https://...), not a review link.
- `why` is ONE sentence, under 20 words.
- `price_range`: $ = casual/under $30 pp, $$ = $30-60 pp, $$$ = $60-120 pp, $$$$ = $120+ pp. For bars, base on a cocktail's typical price: $ = <$12, $$ = $12-18, $$$ = $18-24, $$$$ = $24+. Always include it.
- Don't fabricate venues. If you're unsure, omit.
- Output ONLY the JSON object."""


@router.post("/extract-trip")
async def extract_trip(files: list[UploadFile] = File(...)) -> dict:
    """Accept one or more PDFs / images / text files and return a Trip JSON.
    The frontend merges the returned fields into the current trip."""
    if not files:
        raise HTTPException(400, "No files provided")

    user_content: list[dict] = [
        text_block(
            "Extract a single consolidated trip from the following documents. "
            "Merge overlapping info (same flight mentioned twice = one entry)."
        )
    ]

    for f in files:
        name = f.filename or "document"
        suffix = Path(name).suffix.lower()
        content = await f.read()
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(413, f"File too large: {name}")

        if suffix == ".pdf":
            # Anthropic accepts PDFs directly as document blocks.
            import base64
            user_content.append(
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": base64.standard_b64encode(content).decode("ascii"),
                    },
                }
            )
        elif suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
            import base64
            media = {
                ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".gif": "image/gif", ".webp": "image/webp",
            }[suffix]
            user_content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media,
                        "data": base64.standard_b64encode(content).decode("ascii"),
                    },
                }
            )
        else:
            try:
                text = content.decode("utf-8", errors="ignore")
            except Exception:
                raise HTTPException(415, f"Unsupported file type: {name}")
            user_content.append(text_block(f"--- {name} ---\n{text}"))

    try:
        data = complete_json(
            system=TRIP_EXTRACTION_SYSTEM,
            user_content=user_content,
            max_tokens=8000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))

    return data


class RecoRequest(BaseModel):
    city: str
    # "food" is the frontend term; "restaurants" is legacy — both accepted.
    category: Literal["bars", "food", "restaurants"]
    neighborhood: Optional[str] = None
    hotel: Optional[str] = None


@router.post("/recommendations")
def recommendations(req: RecoRequest) -> dict:
    if not req.city.strip():
        raise HTTPException(400, "City required")

    prompt_lines = [f"City: {req.city}"]
    if req.neighborhood:
        prompt_lines.append(f"Neighborhood focus: {req.neighborhood}")
    if req.hotel:
        prompt_lines.append(f"Near hotel: {req.hotel}")
    if req.category == "bars":
        prompt_lines.append(
            "Category: Top cocktail lounges and bars. Start with Michelin-listed "
            "bars/lounges; if none, include the highest-rated cocktail bars from "
            "The Infatuation, then Eater."
        )
    else:
        prompt_lines.append(
            "Category: Top restaurants. Start with Michelin-starred and "
            "recommended; then Infatuation city essentials; then Eater's city "
            "guide."
        )

    try:
        data = complete_json(
            system=RECOMMENDATIONS_SYSTEM,
            user_content=[text_block("\n".join(prompt_lines))],
            max_tokens=3000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))

    return data


# ------------------------------------------------------------------
# Outlook ICS subscription feed
# ------------------------------------------------------------------
class TripPayload(BaseModel):
    """Frontend-side Trip JSON, accepted as-is. Shape matches
    frontend/src/pages/AirKarim/types.ts — we don't validate fields here
    because the renderer is forgiving and new fields would otherwise
    require schema coordination."""

    model_config = {"extra": "allow"}


@router.put("/trips/{trip_id}")
def upsert_trip(trip_id: str, payload: dict, db: Session = Depends(get_db)) -> dict:
    """Store / replace the server-side copy of a trip so Outlook's polling
    can pick up changes. Bumps SEQUENCE each call so Outlook applies
    updates cleanly instead of creating duplicate events."""
    existing = db.get(AirKarimTrip, trip_id)
    if existing:
        existing.data = payload
        existing.sequence = (existing.sequence or 0) + 1
    else:
        db.add(AirKarimTrip(id=trip_id, data=payload, sequence=0))
    db.commit()
    row = db.get(AirKarimTrip, trip_id)
    return {
        "id": row.id,
        "sequence": row.sequence,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.delete("/trips/{trip_id}", status_code=204)
def delete_trip(trip_id: str, db: Session = Depends(get_db)):
    row = db.get(AirKarimTrip, trip_id)
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


@router.get("/trips/{trip_id}.ics")
def trip_ics(trip_id: str, db: Session = Depends(get_db)) -> Response:
    row = db.get(AirKarimTrip, trip_id)
    if not row:
        raise HTTPException(404, "Trip not synced yet")
    body = trip_to_ics(trip_id, row.data, row.sequence)
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="airkarim-{trip_id}.ics"',
            # Outlook's internet-calendar refresh honors Cache-Control when
            # choosing how aggressively to re-fetch.
            "Cache-Control": "public, max-age=600",
        },
    )


# ------------------------------------------------------------------
# Concierge chat — Claude has full trip context and streams answers
# ------------------------------------------------------------------
CONCIERGE_SYSTEM = """You are AirKarim, a personal concierge for a Gencom executive's trip.
You have full context on the trip: flights, hotel, meetings, dining reservations, ground transport, attendees, contacts, and documents.

Style:
- Concise and tactical. The exec may be in a car or walking between meetings.
- Numerate: quote flight numbers, times, addresses, and confirmation numbers verbatim from the context when asked.
- Proactive: if they ask "what's next", look at the trip data plus the current time in the user's context and answer with the next scheduled item.
- When they ask for restaurants or bars, defer to the recommendations tab (don't invent venues).
- If asked about weather, currency, or anything you'd need live data for, say what you don't know and suggest where they'd find out.

Format answers in short paragraphs or tight bullet lists. Don't add signoffs."""


def _trip_context_summary(trip: dict) -> str:
    """Compact but complete trip summary for the system prompt."""
    lines: list[str] = []

    title = trip.get("title") or "Trip"
    lines.append(f"## Trip: {title}")
    if trip.get("purpose"):
        lines.append(f"Purpose: {trip['purpose']}")
    if trip.get("startDate") and trip.get("endDate"):
        lines.append(f"Dates: {trip['startDate']} -> {trip['endDate']}")
    cities = ", ".join(
        d.get("city", "") for d in (trip.get("destinations") or []) if d.get("city")
    )
    if cities:
        lines.append(f"Cities: {cities}")
    if trip.get("notes"):
        lines.append(f"Owner notes: {trip['notes']}")

    flights = trip.get("flights") or []
    if flights:
        lines.append("\n## Flights")
        for f in flights:
            parts = [
                f"{f.get('airline', '')} {f.get('flightNumber', '')}".strip(),
                f"{f.get('departAirport', '')}->{f.get('arriveAirport', '')}",
                f"depart {f.get('departAt', '')}",
                f"arrive {f.get('arriveAt', '')}",
            ]
            for k, prefix in [
                ("aircraftType", "aircraft"),
                ("seat", "seat"),
                ("cabin", ""),
                ("departTerminal", "dep T"),
                ("departGate", "gate"),
                ("arriveTerminal", "arr T"),
                ("confirmation", "conf"),
                ("notes", "notes:"),
            ]:
                v = f.get(k)
                if v:
                    parts.append(f"{prefix} {v}".strip())
            lines.append(f"- {' | '.join(p for p in parts if p)}")

    lodging = trip.get("lodging") or []
    if lodging:
        lines.append("\n## Lodging")
        for l in lodging:
            parts = [l.get("hotel", "?")]
            if l.get("address"):
                parts.append(l["address"])
            if l.get("checkInAt"):
                parts.append(f"check-in {l['checkInAt']}")
            if l.get("checkOutAt"):
                parts.append(f"check-out {l['checkOutAt']}")
            if l.get("roomType"):
                parts.append(f"room: {l['roomType']}")
            if l.get("phone"):
                parts.append(f"phone {l['phone']}")
            if l.get("confirmation"):
                parts.append(f"conf {l['confirmation']}")
            if l.get("notes"):
                parts.append(f"notes: {l['notes']}")
            lines.append(f"- {' | '.join(parts)}")

    meetings = trip.get("meetings") or []
    if meetings:
        lines.append("\n## Meetings")
        for m in meetings:
            parts = [
                m.get("title", "?"),
                f"{m.get('startAt', '')} -> {m.get('endAt', '')}",
                m.get("location", ""),
            ]
            if m.get("address"):
                parts.append(m["address"])
            if m.get("agenda"):
                parts.append(f"agenda: {m['agenda']}")
            atts = m.get("attendees") or []
            if atts:
                bits = []
                for a in atts:
                    s = a.get("name", "")
                    if a.get("company"):
                        s += f" ({a['company']})"
                    if a.get("title"):
                        s += f" - {a['title']}"
                    bits.append(s)
                parts.append("attendees: " + "; ".join(bits))
            if m.get("materials"):
                parts.append(f"materials: {m['materials']}")
            if m.get("notes"):
                parts.append(f"notes: {m['notes']}")
            lines.append(f"- {' | '.join(p for p in parts if p)}")

    dining = trip.get("dining") or []
    if dining:
        lines.append("\n## Dining")
        for d in dining:
            parts = [d.get("restaurant", "?"), d.get("time", "")]
            if d.get("address"):
                parts.append(d["address"])
            if d.get("partySize"):
                parts.append(f"party of {d['partySize']}")
            if d.get("reservation"):
                parts.append(f"reservation {d['reservation']}")
            if d.get("dressCode"):
                parts.append(f"dress: {d['dressCode']}")
            if d.get("notes"):
                parts.append(f"notes: {d['notes']}")
            lines.append(f"- {' | '.join(parts)}")

    ground = trip.get("ground") or []
    if ground:
        lines.append("\n## Ground transport")
        for g in ground:
            parts = [g.get("transportKind", "?")]
            if g.get("provider"):
                parts.append(g["provider"])
            parts.append(g.get("time", ""))
            if g.get("pickup"):
                parts.append(f"pickup {g['pickup']}")
            if g.get("dropoff"):
                parts.append(f"dropoff {g['dropoff']}")
            if g.get("driverContact"):
                parts.append(f"driver {g['driverContact']}")
            if g.get("confirmation"):
                parts.append(f"conf {g['confirmation']}")
            lines.append(f"- {' | '.join(parts)}")

    contacts = trip.get("contacts") or []
    if contacts:
        lines.append("\n## Contacts")
        for c in contacts:
            parts = [c.get("name", "?")]
            if c.get("role"):
                parts.append(c["role"])
            if c.get("phone"):
                parts.append(c["phone"])
            if c.get("email"):
                parts.append(c["email"])
            lines.append(f"- {' | '.join(parts)}")

    docs = trip.get("documents") or []
    if docs:
        lines.append("\n## Documents on file")
        for d in docs:
            lines.append(f"- {d.get('label', '?')} ({d.get('docType', 'doc')})")

    return "\n".join(lines)


class ConciergeMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ConciergeRequest(BaseModel):
    trip: dict  # full Trip JSON sent from the client
    messages: list[ConciergeMessage]
    now: Optional[str] = None  # ISO timestamp so Claude knows "right now"


@router.post("/chat")
def concierge_chat(payload: ConciergeRequest):
    if not payload.messages:
        raise HTTPException(400, "No messages")

    system = CONCIERGE_SYSTEM + "\n\n" + _trip_context_summary(payload.trip)
    if payload.now:
        system += f"\n\n## Right now\nCurrent time (user's perspective): {payload.now}"

    anthropic_messages = [{"role": m.role, "content": m.content} for m in payload.messages]

    def gen() -> Iterator[bytes]:
        try:
            with claude_client().messages.stream(
                model=settings.extraction_model,
                max_tokens=2000,
                system=system,
                messages=anthropic_messages,
            ) as stream:
                for text in stream.text_stream:
                    if text:
                        yield text.encode("utf-8")
        except Exception as e:
            yield f"\n\n[ERROR: {e}]".encode("utf-8")

    return StreamingResponse(gen(), media_type="text/plain; charset=utf-8")


# ------------------------------------------------------------------
# File attachments per trip — boarding passes, confirmations, decks,
# anything the user uploaded. Each file is tagged with a section
# ("flights" | "lodging" | "meetings" | "dining" | "ground" | "other")
# so the editor can show per-tab attachments.
# ------------------------------------------------------------------
AK_UPLOADS_ROOT = UPLOADS_DIR / "airkarim"
VALID_SECTIONS = {"flights", "lodging", "meetings", "dining", "ground", "other"}


def _file_to_dict(f: AirKarimFile) -> dict:
    return {
        "id": f.id,
        "trip_id": f.trip_id,
        "filename": f.filename,
        "section": f.section,
        "content_type": f.content_type,
        "size_bytes": f.size_bytes,
        "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else None,
        "url": f"/api/airkarim/files/{f.id}",
    }


def _guess_section(filename: str) -> str:
    """Heuristic section assignment when the uploader doesn't specify one.
    Runs on the filename + Claude's extracted docType when known."""
    n = (filename or "").lower()
    if any(kw in n for kw in ["boarding", "ticket", "flight", "airline"]):
        return "flights"
    if any(kw in n for kw in ["hotel", "reservation", "lodging", "check-in", "checkin"]):
        return "lodging"
    if any(kw in n for kw in ["meeting", "agenda", "ic ", " ic_", "deck"]):
        return "meetings"
    if any(kw in n for kw in ["restaurant", "dining", "opentable", "resy"]):
        return "dining"
    if any(kw in n for kw in ["car", "limo", "uber", "lyft", "transfer", "chauffeur"]):
        return "ground"
    return "other"


@router.post("/trips/{trip_id}/files")
async def upload_files(
    trip_id: str,
    files: list[UploadFile] = File(...),
    section: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    if not files:
        raise HTTPException(400, "No files")
    AK_UPLOADS_ROOT.mkdir(parents=True, exist_ok=True)
    trip_dir = AK_UPLOADS_ROOT / trip_id
    trip_dir.mkdir(parents=True, exist_ok=True)

    sanitized_section = section if section in VALID_SECTIONS else None
    created: list[AirKarimFile] = []
    import uuid
    for f in files:
        name = f.filename or "upload"
        suffix = Path(name).suffix
        safe_stem = "".join(c for c in Path(name).stem if c.isalnum() or c in "-_ ")[:60] or "doc"
        stored = f"{uuid.uuid4().hex[:8]}_{safe_stem}{suffix}"
        dest = trip_dir / stored
        content = await f.read()
        if len(content) > 25 * 1024 * 1024:
            raise HTTPException(413, f"File too large: {name}")
        dest.write_bytes(content)
        sec = sanitized_section or _guess_section(name)
        row = AirKarimFile(
            trip_id=trip_id,
            filename=name,
            file_path=str(dest),
            content_type=f.content_type,
            size_bytes=len(content),
            section=sec,
        )
        db.add(row)
        created.append(row)
    db.commit()
    for r in created:
        db.refresh(r)
    return [_file_to_dict(r) for r in created]


@router.get("/trips/{trip_id}/files")
def list_files(trip_id: str, db: Session = Depends(get_db)):
    from sqlalchemy import select
    rows = db.execute(
        select(AirKarimFile)
        .where(AirKarimFile.trip_id == trip_id)
        .order_by(AirKarimFile.uploaded_at.desc())
    ).scalars().all()
    return [_file_to_dict(r) for r in rows]


class UpdateFileRequest(BaseModel):
    section: str


@router.patch("/files/{file_id}")
def update_file(file_id: str, body: UpdateFileRequest, db: Session = Depends(get_db)):
    row = db.get(AirKarimFile, file_id)
    if not row:
        raise HTTPException(404, "File not found")
    if body.section not in VALID_SECTIONS:
        raise HTTPException(400, f"Invalid section. Allowed: {sorted(VALID_SECTIONS)}")
    row.section = body.section
    db.commit()
    db.refresh(row)
    return _file_to_dict(row)


@router.delete("/files/{file_id}", status_code=204)
def delete_file(file_id: str, db: Session = Depends(get_db)):
    row = db.get(AirKarimFile, file_id)
    if row:
        try:
            Path(row.file_path).unlink(missing_ok=True)
        except Exception:
            pass
        db.delete(row)
        db.commit()
    return Response(status_code=204)


@router.get("/files/{file_id}")
def get_file(file_id: str, db: Session = Depends(get_db)):
    from fastapi.responses import FileResponse
    row = db.get(AirKarimFile, file_id)
    if not row:
        raise HTTPException(404, "File not found")
    p = Path(row.file_path)
    if not p.exists():
        raise HTTPException(410, "File is gone from disk")
    return FileResponse(
        str(p),
        media_type=row.content_type or "application/octet-stream",
        filename=row.filename,
    )


# ------------------------------------------------------------------
# Crew briefing — Claude generates a one-page markdown briefing for the
# flight crew / ground team from the full trip JSON. Streams the response.
# ------------------------------------------------------------------
BRIEFING_SYSTEM = """You are AirKarim, drafting a one-page crew briefing for the flight crew and ground team supporting a Gencom executive's trip.

Output format: clean Markdown. Sections in this order (use H2 for each):
1. Principal — name and role (from contacts). If unknown, say "Principal: (see owner)".
2. Trip summary — dates, cities, purpose.
3. Aircraft & tails — operator, tail number, aircraft type, broker contact for each private leg. Skip commercial legs except for a one-line mention.
4. FBO & ground handling — for each private leg, dep and arr FBO: name, phone, address, handler. List ground transport with provider and driver contact.
5. Crew — every crew member listed by leg with role + phone.
6. Hotel — primary hotel name, address, phone, check-in/out times, room type.
7. Schedule — one bullet per meeting/dinner with time, location, attendees count.
8. Catering — per-leg catering preferences exactly as recorded. Note any "use trip default" references.
9. Alternates & contingencies — pre-authorized alternates per leg, customs pre-clearance status.
10. Contacts — all contacts on file (name, role, phone).

Rules:
- Concise. Bullet-heavy. No fluff.
- Quote phone numbers and tail numbers verbatim.
- Do not fabricate missing fields — write "—" or "(not provided)" instead.
- Output ONLY the Markdown body. No preamble like "Here is the briefing…"."""


class BriefingRequest(BaseModel):
    trip: dict


@router.post("/briefing")
def crew_briefing(payload: BriefingRequest):
    system = BRIEFING_SYSTEM + "\n\n## Trip data\n" + _trip_context_summary(payload.trip)

    def gen() -> Iterator[bytes]:
        try:
            with claude_client().messages.stream(
                model=settings.extraction_model,
                max_tokens=3500,
                system=system,
                messages=[{"role": "user", "content": "Draft the briefing now."}],
            ) as stream:
                for text in stream.text_stream:
                    if text:
                        yield text.encode("utf-8")
        except Exception as e:
            yield f"\n\n[ERROR: {e}]".encode("utf-8")

    return StreamingResponse(gen(), media_type="text/markdown; charset=utf-8")


# ------------------------------------------------------------------
# External aviation data — Wikipedia (aircraft image), FlightAware
# (flight status), OpenWeather (forecast). Each gracefully degrades
# when its API key is missing.
# ------------------------------------------------------------------
from services import aviation_data as _avdata


@router.get("/aircraft-image")
async def aircraft_image(q: str):
    """Look up a thumbnail image for an aircraft type string.
    `q` should be whatever the user typed in the Aircraft field, e.g.
    'Boeing 737-800' or 'Gulfstream G650'. Returns null if nothing found."""
    result = await _avdata.aircraft_image(q)
    return result or {"imageUrl": None}


@router.get("/flight-status")
async def flight_status(ident: str, date: str | None = None):
    """Live flight status from FlightAware's AeroAPI. `ident` is the call
    sign (e.g. 'AA2234') or tail number ('N123AB')."""
    return await _avdata.flight_status(ident, date)


@router.get("/weather")
async def airport_weather(airport: str, hours: int = 48):
    """Forecast + slot-risk indicator from OpenWeather for an IATA airport."""
    return await _avdata.weather_for_airport(airport, hours)
