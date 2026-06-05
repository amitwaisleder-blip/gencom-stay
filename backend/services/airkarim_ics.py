"""Render an AirKarim trip (stored as the client-side Trip JSON blob) into
an RFC 5545 iCalendar document. Designed to be polled by Outlook via the
"Add calendar from internet" subscription feature — Outlook refreshes the
feed on its own schedule (typically every few hours) and applies any
changes based on stable UIDs and the SEQUENCE counter.

One VEVENT per:
  - flight (DTSTART=depart, DTEND=arrive)
  - meeting (DTSTART=startAt, DTEND=endAt)
  - dining (DTSTART=time, DTEND=time+90min)
  - ground (DTSTART=time, DTEND=time+60min)
  - lodging check-in and lodging check-out (short events at those times)

Times are stored as ISO strings with offsets on the client; we normalize
everything to UTC in the ICS output because that's the most reliable form
to ship to Outlook without embedding VTIMEZONE blocks.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable


# ------------------------------------------------------------------
# Formatting helpers
# ------------------------------------------------------------------
def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    # Python's fromisoformat accepts trailing "Z" only in 3.11+.
    s = iso.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _escape(s: str | None) -> str:
    if not s:
        return ""
    # RFC 5545: escape \ , ; and newlines
    return (
        s.replace("\\", "\\\\")
         .replace("\n", "\\n")
         .replace(",", "\\,")
         .replace(";", "\\;")
    )


def _fold(line: str) -> str:
    """RFC 5545 line folding — no content line > 75 octets."""
    if len(line) <= 75:
        return line
    out = [line[:75]]
    i = 75
    while i < len(line):
        out.append(" " + line[i:i + 74])
        i += 74
    return "\r\n".join(out)


def _prop(name: str, value: str) -> str:
    return _fold(f"{name}:{value}")


# ------------------------------------------------------------------
# Event builders
# ------------------------------------------------------------------
def _event(
    *,
    uid: str,
    summary: str,
    dtstart: datetime,
    dtend: datetime,
    dtstamp: datetime,
    sequence: int,
    location: str | None = None,
    description: str | None = None,
) -> list[str]:
    lines: list[str] = [
        "BEGIN:VEVENT",
        _prop("UID", uid),
        _prop("DTSTAMP", _fmt(dtstamp)),
        _prop("DTSTART", _fmt(dtstart)),
        _prop("DTEND", _fmt(dtend)),
        _prop("SEQUENCE", str(sequence)),
        _prop("SUMMARY", _escape(summary)),
    ]
    if location:
        lines.append(_prop("LOCATION", _escape(location)))
    if description:
        lines.append(_prop("DESCRIPTION", _escape(description)))
    lines.append("END:VEVENT")
    return lines


def _flight_event(trip_id: str, f: dict, dtstamp: datetime, sequence: int) -> list[str] | None:
    start = _parse(f.get("departAt"))
    end = _parse(f.get("arriveAt"))
    if not start or not end:
        return None
    airline = f.get("airline") or ""
    num = f.get("flightNumber") or ""
    dep = f.get("departAirport") or ""
    arr = f.get("arriveAirport") or ""
    summary = f"✈ {airline} {num} · {dep} → {arr}".strip()

    parts: list[str] = []
    if f.get("aircraftType"):
        parts.append(f"Aircraft: {f['aircraftType']}")
    if f.get("departTerminal") or f.get("departGate"):
        parts.append(f"Depart: T{f.get('departTerminal','')} Gate {f.get('departGate','')}")
    if f.get("arriveTerminal") or f.get("arriveGate"):
        parts.append(f"Arrive: T{f.get('arriveTerminal','')} Gate {f.get('arriveGate','')}")
    if f.get("seat"):
        parts.append(f"Seat: {f['seat']}{' · ' + f['cabin'] if f.get('cabin') else ''}")
    if f.get("confirmation"):
        parts.append(f"Confirmation: {f['confirmation']}")
    if f.get("notes"):
        parts.append(f["notes"])
    description = "\n".join(parts) if parts else None

    return _event(
        uid=f"airkarim-{trip_id}-flight-{f.get('id')}@gencom",
        summary=summary,
        dtstart=start, dtend=end,
        dtstamp=dtstamp, sequence=sequence,
        location=f"{dep} → {arr}",
        description=description,
    )


def _meeting_event(trip_id: str, m: dict, dtstamp: datetime, sequence: int) -> list[str] | None:
    start = _parse(m.get("startAt"))
    end = _parse(m.get("endAt"))
    if not start or not end:
        return None
    location = m.get("location") or ""
    if m.get("address"):
        location = f"{location} — {m['address']}" if location else m["address"]

    attendees = m.get("attendees") or []
    parts: list[str] = []
    if m.get("agenda"):
        parts.append(m["agenda"])
    if attendees:
        parts.append("Attendees:")
        for a in attendees:
            label = a.get("name", "")
            if a.get("company"):
                label += f" ({a['company']})"
            if a.get("title"):
                label += f" — {a['title']}"
            parts.append(f"  • {label}")
    if m.get("materials"):
        parts.append(f"Materials: {m['materials']}")
    if m.get("notes"):
        parts.append(m["notes"])
    description = "\n".join(parts) if parts else None

    return _event(
        uid=f"airkarim-{trip_id}-meeting-{m.get('id')}@gencom",
        summary=f"◉ {m.get('title') or 'Meeting'}",
        dtstart=start, dtend=end,
        dtstamp=dtstamp, sequence=sequence,
        location=location or None,
        description=description,
    )


def _dining_event(trip_id: str, d: dict, dtstamp: datetime, sequence: int) -> list[str] | None:
    start = _parse(d.get("time"))
    if not start:
        return None
    end = start + timedelta(minutes=90)
    location = d.get("address") or None

    parts: list[str] = []
    if d.get("partySize"):
        parts.append(f"Party of {d['partySize']}")
    if d.get("reservation"):
        parts.append(f"Reservation: {d['reservation']}")
    if d.get("dressCode"):
        parts.append(f"Dress code: {d['dressCode']}")
    if d.get("notes"):
        parts.append(d["notes"])
    description = "\n".join(parts) if parts else None

    return _event(
        uid=f"airkarim-{trip_id}-dining-{d.get('id')}@gencom",
        summary=f"🍽 {d.get('restaurant') or 'Dinner'}",
        dtstart=start, dtend=end,
        dtstamp=dtstamp, sequence=sequence,
        location=location, description=description,
    )


def _ground_event(trip_id: str, g: dict, dtstamp: datetime, sequence: int) -> list[str] | None:
    start = _parse(g.get("time"))
    if not start:
        return None
    end = start + timedelta(minutes=60)
    kind = g.get("transportKind") or "Ground"
    provider = g.get("provider") or ""
    summary = f"🚗 {kind.title()}{' · ' + provider if provider else ''}"

    parts: list[str] = []
    if g.get("pickup"):
        parts.append(f"Pickup: {g['pickup']}")
    if g.get("dropoff"):
        parts.append(f"Drop-off: {g['dropoff']}")
    if g.get("driverContact"):
        parts.append(f"Driver: {g['driverContact']}")
    if g.get("confirmation"):
        parts.append(f"Confirmation: {g['confirmation']}")
    if g.get("notes"):
        parts.append(g["notes"])
    description = "\n".join(parts) if parts else None

    return _event(
        uid=f"airkarim-{trip_id}-ground-{g.get('id')}@gencom",
        summary=summary,
        dtstart=start, dtend=end,
        dtstamp=dtstamp, sequence=sequence,
        location=g.get("pickup") or None,
        description=description,
    )


def _lodging_events(trip_id: str, l: dict, dtstamp: datetime, sequence: int) -> list[list[str]]:
    out: list[list[str]] = []
    ci = _parse(l.get("checkInAt"))
    co = _parse(l.get("checkOutAt"))
    hotel = l.get("hotel") or "Hotel"
    addr = l.get("address") or None
    phone = l.get("phone")

    common_parts: list[str] = []
    if l.get("roomType"):
        common_parts.append(f"Room: {l['roomType']}")
    if l.get("confirmation"):
        common_parts.append(f"Confirmation: {l['confirmation']}")
    if phone:
        common_parts.append(f"Phone: {phone}")
    if l.get("notes"):
        common_parts.append(l["notes"])
    desc = "\n".join(common_parts) if common_parts else None

    if ci:
        out.append(_event(
            uid=f"airkarim-{trip_id}-lodging-ci-{l.get('id')}@gencom",
            summary=f"⌂ Check-in · {hotel}",
            dtstart=ci, dtend=ci + timedelta(minutes=30),
            dtstamp=dtstamp, sequence=sequence,
            location=addr, description=desc,
        ))
    if co:
        out.append(_event(
            uid=f"airkarim-{trip_id}-lodging-co-{l.get('id')}@gencom",
            summary=f"⌂ Check-out · {hotel}",
            dtstart=co, dtend=co + timedelta(minutes=30),
            dtstamp=dtstamp, sequence=sequence,
            location=addr, description=desc,
        ))
    return out


# ------------------------------------------------------------------
# Public API
# ------------------------------------------------------------------
def trip_to_ics(trip_id: str, trip: dict, sequence: int) -> str:
    now = datetime.now(timezone.utc)
    title = trip.get("title") or "AirKarim trip"

    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Gencom//AirKarim//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        _prop("X-WR-CALNAME", _escape(f"AirKarim — {title}")),
        _prop("X-WR-CALDESC", _escape("Synced from AirKarim")),
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
        "X-PUBLISHED-TTL:PT1H",
    ]

    events: list[list[str]] = []
    for f in trip.get("flights") or []:
        ev = _flight_event(trip_id, f, now, sequence)
        if ev: events.append(ev)
    for m in trip.get("meetings") or []:
        ev = _meeting_event(trip_id, m, now, sequence)
        if ev: events.append(ev)
    for d in trip.get("dining") or []:
        ev = _dining_event(trip_id, d, now, sequence)
        if ev: events.append(ev)
    for g in trip.get("ground") or []:
        ev = _ground_event(trip_id, g, now, sequence)
        if ev: events.append(ev)
    for l in trip.get("lodging") or []:
        events.extend(_lodging_events(trip_id, l, now, sequence))

    for ev in events:
        lines.extend(ev)

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
