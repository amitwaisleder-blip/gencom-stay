"""GenCal — company-wide calendar backend (Phase 1).

Scope of this phase: CRUD on events + employee directory, seed data loading
for the 2026 HSHR holiday schedule and sample parties/milestones/people,
and on-the-fly birthday / anniversary event generation from the directory.

Future phases layer RSVP, admin panel, SSO, .ics export, and notifications
on top of this model. Keep the shape here stable."""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from db import get_db
from models.entities import GenCalEmployee, GenCalEvent
from services.claude_client import ClaudeError, complete_json, text_block


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/gen-cal", tags=["gen-cal"])


VALID_CATEGORIES = {
    "holiday",       # Company holidays (office closed). Locked seed.
    "party",         # Parties and social events.
    "board",         # Quarterly board / IC meetings.
    "property",      # Property milestone dates.
    "birthday",      # Auto-generated from employee directory.
    "anniversary",   # Auto-generated from employee directory.
    "general",       # Training, offsites, all-hands, town halls.
}


# ------------------------------------------------------------------
# Serialization
# ------------------------------------------------------------------
def _event_dict(e: GenCalEvent) -> dict:
    return {
        "id": e.id,
        "title": e.title,
        "category": e.category,
        "start_at": e.start_at.isoformat() if e.start_at else None,
        "end_at": e.end_at.isoformat() if e.end_at else None,
        "all_day": bool(e.all_day),
        "location": e.location,
        "description": e.description,
        "locked": bool(e.locked),
        "extras": e.extras or {},
    }


def _employee_dict(x: GenCalEmployee) -> dict:
    return {
        "id": x.id, "name": x.name, "email": x.email,
        "department": x.department, "birthday": x.birthday,
        "hire_date": x.hire_date, "active": bool(x.active),
    }


# ------------------------------------------------------------------
# Event CRUD + listing with auto-generated birthdays / anniversaries
# ------------------------------------------------------------------
@router.get("/events")
def list_events(
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Return every stored event overlapping the window, plus synthetic
    birthday / work-anniversary events rendered for each year in the window.

    `start` and `end` accept ISO dates or datetimes. If either is missing we
    default to a generous +/- 180-day window so the calendar has something to
    render immediately."""
    sdt = _parse_iso(start) or _now() - timedelta(days=180)
    edt = _parse_iso(end) or _now() + timedelta(days=365)

    stored = db.execute(
        select(GenCalEvent)
        .where(GenCalEvent.end_at >= sdt)
        .where(GenCalEvent.start_at <= edt)
        .order_by(GenCalEvent.start_at.asc())
    ).scalars().all()

    out = [_event_dict(e) for e in stored]

    # Synthesize one event per employee per year in range for each of
    # birthday and hire-date anniversary. These are not persisted.
    employees = db.execute(
        select(GenCalEmployee).where(GenCalEmployee.active == True)
    ).scalars().all()
    out.extend(_synth_people_events(employees, sdt.date(), edt.date()))

    return out


def _synth_people_events(
    employees: list[GenCalEmployee], start: date, end: date,
) -> list[dict]:
    results: list[dict] = []
    for emp in employees:
        bday = _parse_ymd(emp.birthday)
        hire = _parse_ymd(emp.hire_date)
        for year in range(start.year, end.year + 1):
            if bday:
                try:
                    occ = date(year, bday.month, bday.day)
                except ValueError:
                    # Leap-day birthday in non-leap year — fall back to Feb 28.
                    occ = date(year, 2, 28)
                if start <= occ <= end:
                    results.append(_synth_event(
                        id_=f"birthday-{emp.id}-{year}",
                        title=f"{emp.name}'s birthday",
                        category="birthday",
                        on=occ,
                        description=f"{emp.name} ({emp.department or 'Gencom'})",
                    ))
            if hire and year > hire.year:
                years_count = year - hire.year
                try:
                    occ = date(year, hire.month, hire.day)
                except ValueError:
                    occ = date(year, 2, 28)
                if start <= occ <= end:
                    results.append(_synth_event(
                        id_=f"anniversary-{emp.id}-{year}",
                        title=f"{emp.name} — {years_count} year{'s' if years_count != 1 else ''}",
                        category="anniversary",
                        on=occ,
                        description=f"Work anniversary. {emp.name} joined Gencom on {hire.isoformat()}.",
                    ))
    return results


def _synth_event(*, id_: str, title: str, category: str, on: date, description: str) -> dict:
    start_dt = datetime(on.year, on.month, on.day, 0, 0, 0, tzinfo=timezone.utc)
    end_dt = start_dt + timedelta(hours=23, minutes=59)
    return {
        "id": id_,
        "title": title,
        "category": category,
        "start_at": start_dt.isoformat(),
        "end_at": end_dt.isoformat(),
        "all_day": True,
        "location": None,
        "description": description,
        "locked": True,
        "extras": {"auto_generated": True},
    }


class EventPayload(BaseModel):
    title: str
    category: str
    start_at: str  # ISO
    end_at: str
    all_day: bool = False
    location: Optional[str] = None
    description: Optional[str] = None
    extras: Optional[dict] = None


@router.post("/events")
def create_event(payload: EventPayload, db: Session = Depends(get_db)):
    if payload.category not in VALID_CATEGORIES:
        raise HTTPException(400, f"Invalid category. Allowed: {sorted(VALID_CATEGORIES)}")
    start = _parse_iso(payload.start_at)
    end = _parse_iso(payload.end_at)
    if not start or not end:
        raise HTTPException(400, "start_at and end_at must be ISO datetimes")
    e = GenCalEvent(
        title=payload.title, category=payload.category,
        start_at=start, end_at=end, all_day=payload.all_day,
        location=payload.location, description=payload.description,
        locked=False, extras=payload.extras,
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    return _event_dict(e)


@router.put("/events/{event_id}")
def update_event(event_id: str, payload: EventPayload, db: Session = Depends(get_db)):
    e = db.get(GenCalEvent, event_id)
    if not e:
        raise HTTPException(404, "Event not found")
    if e.locked:
        raise HTTPException(403, "This event is locked and cannot be edited.")
    if payload.category not in VALID_CATEGORIES:
        raise HTTPException(400, f"Invalid category. Allowed: {sorted(VALID_CATEGORIES)}")
    start = _parse_iso(payload.start_at); end = _parse_iso(payload.end_at)
    if not start or not end:
        raise HTTPException(400, "start_at and end_at must be ISO datetimes")
    e.title = payload.title; e.category = payload.category
    e.start_at = start; e.end_at = end; e.all_day = payload.all_day
    e.location = payload.location; e.description = payload.description
    e.extras = payload.extras
    db.commit(); db.refresh(e)
    return _event_dict(e)


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: str, db: Session = Depends(get_db)):
    e = db.get(GenCalEvent, event_id)
    if e:
        if e.locked:
            raise HTTPException(403, "This event is locked and cannot be deleted.")
        db.delete(e); db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------
# Employee directory
# ------------------------------------------------------------------
class EmployeePayload(BaseModel):
    name: str
    email: str
    department: Optional[str] = None
    birthday: Optional[str] = None   # YYYY-MM-DD
    hire_date: Optional[str] = None  # YYYY-MM-DD
    active: bool = True


@router.get("/employees")
def list_employees(db: Session = Depends(get_db)):
    rows = db.execute(
        select(GenCalEmployee).order_by(GenCalEmployee.name.asc())
    ).scalars().all()
    return [_employee_dict(r) for r in rows]


@router.post("/employees")
def create_employee(payload: EmployeePayload, db: Session = Depends(get_db)):
    r = GenCalEmployee(**payload.model_dump())
    db.add(r); db.commit(); db.refresh(r)
    return _employee_dict(r)


@router.put("/employees/{employee_id}")
def update_employee(employee_id: str, payload: EmployeePayload, db: Session = Depends(get_db)):
    r = db.get(GenCalEmployee, employee_id)
    if not r:
        raise HTTPException(404, "Employee not found")
    for k, v in payload.model_dump().items():
        setattr(r, k, v)
    db.commit(); db.refresh(r)
    return _employee_dict(r)


@router.delete("/employees/{employee_id}", status_code=204)
def delete_employee(employee_id: str, db: Session = Depends(get_db)):
    r = db.get(GenCalEmployee, employee_id)
    if r:
        db.delete(r); db.commit()
    return Response(status_code=204)


# ------------------------------------------------------------------
# Seed — one-shot loader for the 2026 HSHR holidays plus sample
# parties / milestones / employees. Idempotent: existing locked
# holidays are not duplicated.
# ------------------------------------------------------------------
HSHR_2026 = [
    ("2026-01-01", "New Year's Day"),
    ("2026-01-02", "New Year's (observed)"),
    ("2026-01-19", "Martin Luther King Jr Day"),
    ("2026-02-16", "President's Day"),
    ("2026-05-25", "Memorial Day"),
    ("2026-06-19", "Juneteenth"),
    ("2026-07-03", "Independence Day (observed)"),
    ("2026-09-07", "Labor Day"),
    ("2026-11-26", "Thanksgiving Day"),
    ("2026-11-27", "Thanksgiving (day after)"),
    ("2026-12-24", "Christmas Eve"),
    ("2026-12-25", "Christmas Day"),
    ("2026-12-31", "New Year's Eve"),
    ("2027-01-01", "New Year's Day"),
]

SAMPLE_PARTIES = [
    {
        "title": "Gencom Summer Outing",
        "on": "2026-06-20",
        "start_time": "15:00",
        "end_time": "22:00",
        "location": "Soho Beach House, Miami Beach",
        "description": "Annual team outing on the beach. Family friendly.",
        "extras": {
            "dress_code": "Resort casual",
            "host_contact": "Office Management",
            "rsvp_required": True,
            "plus_ones_allowed": True,
            "max_plus_ones": 2,
            "dietary_collection": True,
        },
    },
    {
        "title": "Gencom Holiday Party",
        "on": "2026-12-11",
        "start_time": "19:00",
        "end_time": "23:00",
        "location": "The Standard Spa, Miami Beach",
        "description": "Year-end celebration. Cocktail attire.",
        "extras": {
            "dress_code": "Cocktail",
            "host_contact": "HR",
            "rsvp_required": True,
            "plus_ones_allowed": True,
            "max_plus_ones": 1,
            "dietary_collection": True,
        },
    },
    {
        "title": "Q3 All-Hands",
        "on": "2026-07-15",
        "start_time": "10:00",
        "end_time": "12:00",
        "location": "Gencom HQ — Boardroom + Teams",
        "description": "Quarterly update from leadership, followed by department breakouts.",
        "extras": {"rsvp_required": False},
    },
]

SAMPLE_BOARD = [
    ("Q1 Investment Committee", "2026-03-12", "09:00", "12:00", "Gencom NY — 410 Park Ave, 22F"),
    ("Q2 Investment Committee", "2026-06-11", "09:00", "12:00", "Gencom NY — 410 Park Ave, 22F"),
    ("Q3 Investment Committee", "2026-09-10", "09:00", "12:00", "Gencom NY — 410 Park Ave, 22F"),
    ("Q4 Investment Committee", "2026-12-10", "09:00", "12:00", "Gencom NY — 410 Park Ave, 22F"),
]

SAMPLE_PROPERTY_MILESTONES = [
    {
        "title": "RCCP Central Park — Floor 22 post-tension remediation complete",
        "on": "2026-05-15",
        "location": "50 Central Park South, New York, NY",
        "description": "Projected completion of PT cable remediation on floors 18-22.",
        "extras": {"property": "RCCP Central Park", "brand": "Ritz-Carlton", "milestone_type": "Renovation milestone"},
    },
    {
        "title": "Ritz-Carlton New Orleans — 5-year anniversary (ownership)",
        "on": "2026-08-01",
        "location": "921 Canal Street, New Orleans, LA",
        "description": "5 years of Gencom ownership.",
        "extras": {"property": "RCNO", "brand": "Ritz-Carlton", "milestone_type": "Acquisition anniversary"},
    },
    {
        "title": "Mama Shelter LA — soft opening",
        "on": "2026-10-03",
        "location": "6500 Selma Ave, Los Angeles, CA",
        "description": "Soft opening for friends, family, and VIPs.",
        "extras": {"property": "Mama Shelter LA", "brand": "Mama Shelter", "milestone_type": "Opening"},
    },
]

SAMPLE_EMPLOYEES = [
    ("Ben Dennis", "bdennis@gencomgrp.com", "Development", "1991-05-18", "2022-08-15"),
    ("Karim Alibhai", "karim@gencomgrp.com", "Executive", "1960-11-04", "1988-01-01"),
    ("Patrick Imbardelli", "pimbardelli@gencomgrp.com", "Executive", "1965-04-22", "2015-06-01"),
    ("Priscilla Martinez", "pmartinez@gencomgrp.com", "HR", "1988-03-11", "2019-02-04"),
    ("Andrew Kim", "akim@gencomgrp.com", "Acquisitions", "1993-07-02", "2021-09-07"),
    ("Sofia Alonso", "salonso@gencomgrp.com", "Asset Management", "1985-12-19", "2017-11-13"),
    ("Jared Greene", "jgreene@gencomgrp.com", "Finance", "1990-09-30", "2020-04-27"),
    ("Laura Fitzpatrick", "lfitzpatrick@gencomgrp.com", "Legal", "1982-01-25", "2018-05-21"),
]


@router.post("/seed")
def seed(db: Session = Depends(get_db)):
    """Idempotent seed — safe to call on every startup. Tracks dedup via
    event ID for holidays (so running twice doesn't duplicate them)."""
    created = {"holidays": 0, "parties": 0, "board": 0, "property": 0, "employees": 0}

    # 1. Holidays — locked seed events. ID is deterministic so reruns are no-ops.
    for ymd, label in HSHR_2026:
        hid = f"hshr-{ymd}"
        if db.get(GenCalEvent, hid):
            continue
        dt = datetime.fromisoformat(ymd).replace(tzinfo=timezone.utc)
        db.add(GenCalEvent(
            id=hid,
            title=label,
            category="holiday",
            start_at=dt,
            end_at=dt + timedelta(hours=23, minutes=59),
            all_day=True,
            description="Office Closed",
            locked=True,
            extras={"seed": "hshr_2026"},
        ))
        created["holidays"] += 1

    # 2. Sample parties.
    for p in SAMPLE_PARTIES:
        pid = f"sample-party-{p['on']}"
        if db.get(GenCalEvent, pid):
            continue
        start = datetime.fromisoformat(f"{p['on']}T{p['start_time']}:00").replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(f"{p['on']}T{p['end_time']}:00").replace(tzinfo=timezone.utc)
        db.add(GenCalEvent(
            id=pid, title=p["title"], category="party",
            start_at=start, end_at=end, all_day=False,
            location=p["location"], description=p["description"],
            locked=False, extras=p.get("extras") or {},
        ))
        created["parties"] += 1

    # 3. Board / IC meetings.
    for title, ymd, st, et, loc in SAMPLE_BOARD:
        bid = f"sample-board-{ymd}"
        if db.get(GenCalEvent, bid):
            continue
        start = datetime.fromisoformat(f"{ymd}T{st}:00").replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(f"{ymd}T{et}:00").replace(tzinfo=timezone.utc)
        db.add(GenCalEvent(
            id=bid, title=title, category="board",
            start_at=start, end_at=end, all_day=False,
            location=loc, description="Investment committee deck pre-read one week prior.",
            locked=False, extras={"seed": "sample"},
        ))
        created["board"] += 1

    # 4. Property milestones.
    for m in SAMPLE_PROPERTY_MILESTONES:
        mid = f"sample-property-{m['on']}"
        if db.get(GenCalEvent, mid):
            continue
        dt = datetime.fromisoformat(f"{m['on']}T12:00:00").replace(tzinfo=timezone.utc)
        db.add(GenCalEvent(
            id=mid, title=m["title"], category="property",
            start_at=dt, end_at=dt + timedelta(hours=1), all_day=False,
            location=m.get("location"), description=m.get("description"),
            locked=False, extras=m.get("extras") or {},
        ))
        created["property"] += 1

    # 5. Employees.
    for name, email, dept, bday, hire in SAMPLE_EMPLOYEES:
        exists = db.execute(
            select(GenCalEmployee).where(GenCalEmployee.email == email)
        ).scalar_one_or_none()
        if exists:
            continue
        db.add(GenCalEmployee(
            name=name, email=email, department=dept,
            birthday=bday, hire_date=hire, active=True,
        ))
        created["employees"] += 1

    db.commit()
    return {"status": "ok", "created": created}


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    t = s.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(t)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_ymd(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except Exception:
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ------------------------------------------------------------------
# PDF import — Claude reads a calendar/event PDF and returns event drafts
# the frontend previews before committing. Excel import stays client-side
# (xlsx package) since the shape is trivial.
# ------------------------------------------------------------------
PDF_IMPORT_SYSTEM = """You are reading a document that lists events on specific dates. Return a JSON object with an `events` array. Each event shape:

{
  "title": string,
  "category": "holiday" | "party" | "board" | "property" | "general",
  "start_at": ISO 8601 datetime (UTC),
  "end_at": ISO 8601 datetime (UTC),
  "all_day": boolean,
  "location": string | null,
  "description": string | null
}

Rules:
- Pick the category that best matches each event's nature.
- Use `all_day: true` when the document doesn't give explicit start/end times.
- If dates have no year, assume the year that puts the event in the future relative to 2026.
- Only include events that are clearly specified. Skip anything ambiguous.
- Return ONLY the JSON object."""


@router.post("/events/import-pdf")
async def import_events_from_pdf(file: UploadFile = File(...)):
    import base64
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(415, "Only PDF files are supported here")
    content = await file.read()
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(413, "PDF too large")

    user_blocks: list[dict] = [
        {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(content).decode("ascii"),
            },
        },
        text_block("Extract events from this document per the schema."),
    ]
    try:
        out = complete_json(
            system=PDF_IMPORT_SYSTEM,
            user_content=user_blocks,
            max_tokens=4000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))

    events = out.get("events") or []
    # Normalize any category Claude emits that isn't in our vocab.
    for e in events:
        if e.get("category") not in VALID_CATEGORIES:
            e["category"] = "general"
        e.setdefault("all_day", False)
        e.setdefault("location", None)
        e.setdefault("description", None)
    return {"events": events}
