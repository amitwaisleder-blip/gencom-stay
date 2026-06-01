"""Lunch Menu — Gencom's in-office menu tracker.

Stores a daily lunch menu (list of dish strings per date), aggregates
metrics (what was served, how often, by day-of-week), tracks per-user
favorites, and projects a simple "likely this week" forecast by picking
the most common items historically served on the same weekday."""
from __future__ import annotations

import base64
import csv as _csv
import email as _email
import io
import logging
import math
import re as _re
from collections import Counter, defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from db import get_db
from models.entities import LunchFavorite, LunchMenu
from services.claude_client import ClaudeError, complete_json, pdf_block, text_block


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/lunch-menu", tags=["lunch-menu"])

# User scoping stub — real auth comes with the Microsoft Entra work. For
# now favorites default to the lone internal user.
DEFAULT_USER_EMAIL = "bdennis@gencomgrp.com"


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------
def _normalize_item(s: str) -> str:
    return " ".join(str(s).strip().split()).lower()


def _menu_dict(m: LunchMenu) -> dict:
    return {
        "id": m.id,
        "date": m.date,
        "items": list(m.items or []),
        "source": m.source,
        "notes": m.notes,
    }


# ------------------------------------------------------------------
# Menus CRUD
# ------------------------------------------------------------------
@router.get("/menus")
def list_menus(
    start: Optional[str] = None,
    end: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = select(LunchMenu)
    if start:
        q = q.where(LunchMenu.date >= start)
    if end:
        q = q.where(LunchMenu.date <= end)
    rows = db.execute(q.order_by(LunchMenu.date.asc())).scalars().all()
    return [_menu_dict(r) for r in rows]


class MenuPayload(BaseModel):
    date: str  # YYYY-MM-DD
    items: list[str]
    source: Optional[str] = "manual"
    notes: Optional[str] = None


@router.put("/menus/{ymd}")
def upsert_menu(ymd: str, payload: MenuPayload, db: Session = Depends(get_db)):
    # Validate date shape early so bad routes don't silently upsert.
    try:
        date.fromisoformat(ymd)
    except ValueError:
        raise HTTPException(400, "Date must be YYYY-MM-DD")

    items = [i for i in (payload.items or []) if i and i.strip()]
    existing = db.execute(
        select(LunchMenu).where(LunchMenu.date == ymd)
    ).scalar_one_or_none()
    if existing:
        existing.items = items
        existing.source = payload.source or existing.source
        existing.notes = payload.notes
    else:
        db.add(LunchMenu(
            date=ymd, items=items,
            source=(payload.source or "manual"),
            notes=payload.notes,
        ))
    db.commit()
    row = db.execute(select(LunchMenu).where(LunchMenu.date == ymd)).scalar_one()
    return _menu_dict(row)


@router.delete("/menus/{ymd}", status_code=204)
def delete_menu(ymd: str, db: Session = Depends(get_db)):
    row = db.execute(select(LunchMenu).where(LunchMenu.date == ymd)).scalar_one_or_none()
    if row:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


class BulkImport(BaseModel):
    menus: list[MenuPayload]


@router.post("/menus/bulk")
def bulk_upsert(body: BulkImport, db: Session = Depends(get_db)):
    """Used by the Excel import flow after the user confirms parsed rows."""
    created = 0
    for m in body.menus:
        try:
            date.fromisoformat(m.date)
        except ValueError:
            continue
        items = [i for i in (m.items or []) if i and i.strip()]
        if not items:
            continue
        existing = db.execute(
            select(LunchMenu).where(LunchMenu.date == m.date)
        ).scalar_one_or_none()
        if existing:
            existing.items = items
            existing.source = m.source or existing.source
            existing.notes = m.notes
        else:
            db.add(LunchMenu(
                date=m.date, items=items,
                source=(m.source or "excel"),
                notes=m.notes,
            ))
        created += 1
    db.commit()
    return {"count": created}


# ------------------------------------------------------------------
# PDF import — lets a user upload a scanned / printed menu and have
# Claude turn it into { date → [items] } rows.
# ------------------------------------------------------------------
PDF_LUNCH_SYSTEM = """You are reading an in-office lunch menu document. Return a JSON object with a `menus` array. Each entry:

{
  "date": "YYYY-MM-DD",
  "items": [string, ...]
}

Menu layout — preserve the order items appear on the printed menu. The
downstream app interprets positions like this:
  · items[0] — Main dish
  · items[1] — Side dish
  · items[2] — Side dish
  · items[3] — Soup

SPECIAL DAY RULES (very important):
- If the top/first line of the day is "Deli Day" (any casing, or "Deli
  Bar"), return ONLY ["Deli Day"] for that day. Do NOT include any
  other items even if they appear on the printed menu — Deli Day
  replaces the regular layout.
- If the top/first line of the day is "Chef's Choice" (any casing,
  e.g. "Chefs Choice"), return ONLY ["Chef's Choice"] for that day.
  Do NOT include any other items.

General rules:
- Each `items` entry is ONE dish name. Don't bundle multiple dishes per string.
- Preserve the order from the source document so position-based
  classification works correctly.
- Skip descriptive lines ("Served with roasted vegetables" under a dish) unless clearly a separate dish.
- If a day has no dishes listed (holiday, "no service"), skip the day entirely.
- Use the year the document implies. If missing, assume 2026.
- Trim whitespace and drop dish-level calorie tags or section headers.
- Return ONLY the JSON object."""


@router.post("/import-pdf")
async def import_pdf(
    # Plural form accepts multiple PDFs at once. Singular `file` kept for
    # backward compatibility with existing callers.
    files: list[UploadFile] = File(default_factory=list),
    file: Optional[UploadFile] = File(default=None),
):
    candidates: list[UploadFile] = list(files or [])
    if file is not None and getattr(file, "filename", None):
        candidates.append(file)
    if not candidates:
        raise HTTPException(400, "Upload at least one PDF")

    user_blocks: list[dict] = []
    for up in candidates:
        if not up.filename or not up.filename.lower().endswith(".pdf"):
            raise HTTPException(415, f"Only PDF files are supported (got {up.filename!r})")
        content = await up.read()
        if len(content) > 15 * 1024 * 1024:
            raise HTTPException(413, f"PDF too large: {up.filename}")
        user_blocks.append({
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(content).decode("ascii"),
            },
        })
    user_blocks.append(text_block(
        "Extract menus per the schema. If multiple PDFs are attached they may "
        "cover different weeks — emit all dated menus you find across every "
        "document."
    ))
    try:
        out = complete_json(
            system=PDF_LUNCH_SYSTEM,
            user_content=user_blocks,
            # 32k matches Opus's per-call output ceiling. A weekly menu
            # is ~70-100 output tokens per day; this comfortably covers
            # several months of menus across many PDFs in a single shot.
            max_tokens=32000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))
    menus = out.get("menus") or []
    # Light hygiene so the preview doesn't inherit garbage from the PDF.
    for m in menus:
        m["items"] = [i for i in (m.get("items") or []) if i and str(i).strip()]
    return {"menus": menus}


# ------------------------------------------------------------------
# Metrics — frequency counts, by-day-of-week breakouts, and date range.
# ------------------------------------------------------------------
@router.get("/metrics")
def metrics(db: Session = Depends(get_db)):
    rows = db.execute(select(LunchMenu)).scalars().all()
    if not rows:
        return {
            "menu_count": 0,
            "item_count": 0,
            "unique_items": 0,
            "date_range": None,
            "top_items": [],
            "by_day_of_week": [],
        }

    item_counter: Counter[str] = Counter()
    display_name: dict[str, str] = {}     # normalized → first-seen casing
    by_dow: dict[int, Counter[str]] = defaultdict(Counter)
    dow_served: Counter[int] = Counter()
    min_date = rows[0].date
    max_date = rows[0].date
    total_dish_occurrences = 0

    for m in rows:
        if m.date < min_date: min_date = m.date
        if m.date > max_date: max_date = m.date
        d = date.fromisoformat(m.date)
        dow = d.weekday()  # 0 = Mon
        dow_served[dow] += 1
        for raw in (m.items or []):
            name = str(raw).strip()
            if not name:
                continue
            key = _normalize_item(name)
            display_name.setdefault(key, name)
            item_counter[key] += 1
            by_dow[dow][key] += 1
            total_dish_occurrences += 1

    top_items = [
        {"name": display_name[k], "count": c}
        for k, c in item_counter.most_common(50)
    ]
    dow_labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    by_day = []
    for i in range(7):
        top = [
            {"name": display_name[k], "count": c}
            for k, c in by_dow[i].most_common(5)
        ]
        by_day.append({
            "day": dow_labels[i],
            "day_index": i,
            "menus_served": dow_served.get(i, 0),
            "top_items": top,
        })

    return {
        "menu_count": len(rows),
        "item_count": total_dish_occurrences,
        "unique_items": len(item_counter),
        "date_range": {"start": min_date, "end": max_date},
        "top_items": top_items,
        "by_day_of_week": by_day,
    }


@router.get("/items")
def list_unique_items(db: Session = Depends(get_db)):
    """Full set of dishes ever served, with how many times each appeared.
    Used as the pick-list for favorites."""
    rows = db.execute(select(LunchMenu)).scalars().all()
    counter: Counter[str] = Counter()
    display: dict[str, str] = {}
    for m in rows:
        for raw in (m.items or []):
            name = str(raw).strip()
            if not name:
                continue
            key = _normalize_item(name)
            display.setdefault(key, name)
            counter[key] += 1
    return [
        {"key": k, "name": display[k], "count": counter[k]}
        for k in sorted(counter.keys(), key=lambda x: (-counter[x], x))
    ]


# ------------------------------------------------------------------
# Favorites — top-10 personal ranking
# ------------------------------------------------------------------
MAX_FAVORITES = 10


def _user_favorites_ordered(db: Session, email: str) -> list[LunchFavorite]:
    """Return a user's favorites in display order (rank ASC, NULLs last
    by created_at). Backfills missing ranks so callers never see gaps."""
    rows = db.execute(
        select(LunchFavorite).where(LunchFavorite.user_email == email)
    ).scalars().all()
    rows.sort(key=lambda r: (
        r.rank if r.rank is not None else 10_000,
        r.created_at or datetime.min,
    ))
    dirty = False
    for i, r in enumerate(rows[:MAX_FAVORITES], start=1):
        if r.rank != i:
            r.rank = i
            dirty = True
    # Anything beyond the top-10 cap (legacy data) gets ranks beyond MAX
    # so the UI can decide to drop them; we don't auto-delete.
    for j, r in enumerate(rows[MAX_FAVORITES:], start=MAX_FAVORITES + 1):
        if r.rank != j:
            r.rank = j
            dirty = True
    if dirty:
        db.commit()
    return rows


@router.get("/favorites")
def list_favorites(user: Optional[str] = None, db: Session = Depends(get_db)):
    email = (user or DEFAULT_USER_EMAIL).lower()
    rows = _user_favorites_ordered(db, email)
    return [{"item_key": r.item_key, "rank": r.rank} for r in rows]


class FavoriteToggle(BaseModel):
    item_key: str
    user: Optional[str] = None


@router.post("/favorites/toggle")
def toggle_favorite(body: FavoriteToggle, db: Session = Depends(get_db)):
    """Add a dish to the user's top-10 (appended at the next available
    rank) or remove it (re-sequencing remaining ranks so 1..N stays
    contiguous). Refuses to add when the user is already at MAX_FAVORITES."""
    email = (body.user or DEFAULT_USER_EMAIL).lower()
    key = _normalize_item(body.item_key)
    rows = _user_favorites_ordered(db, email)
    existing = next((r for r in rows if r.item_key == key), None)

    if existing:
        db.delete(existing)
        db.flush()
        # Re-sequence the survivors so ranks stay 1..N with no holes.
        survivors = [r for r in rows if r.id != existing.id]
        for i, r in enumerate(survivors, start=1):
            r.rank = i
        db.commit()
        return {"status": "removed", "item_key": key}

    if len(rows) >= MAX_FAVORITES:
        raise HTTPException(
            409,
            f"You're already at {MAX_FAVORITES} favorites. Remove one before adding another.",
        )
    next_rank = len(rows) + 1
    db.add(LunchFavorite(user_email=email, item_key=key, rank=next_rank))
    db.commit()
    return {"status": "added", "item_key": key, "rank": next_rank}


class FavoriteSetRanks(BaseModel):
    """Replace the caller's entire top-10 with this exact ranked list.
    Used by the tournament picker to commit a fresh ranking in a single
    round-trip after the user finishes the head-to-head bracket."""
    item_keys: list[str]
    user: Optional[str] = None


@router.post("/favorites/set-ranks")
def set_favorite_ranks(body: FavoriteSetRanks, db: Session = Depends(get_db)):
    email = (body.user or DEFAULT_USER_EMAIL).lower()
    # Normalize + dedupe while preserving order, then clamp to MAX_FAVORITES.
    seen: set[str] = set()
    keys: list[str] = []
    for raw in body.item_keys:
        k = _normalize_item(raw)
        if not k or k in seen:
            continue
        seen.add(k)
        keys.append(k)
        if len(keys) >= MAX_FAVORITES:
            break

    # Wipe + reinsert. Simpler than reconciling ranks across the existing
    # rows when the tournament might add brand-new picks and drop old ones
    # in one shot.
    existing = db.execute(
        select(LunchFavorite).where(LunchFavorite.user_email == email)
    ).scalars().all()
    for r in existing:
        db.delete(r)
    db.flush()
    for i, k in enumerate(keys, start=1):
        db.add(LunchFavorite(user_email=email, item_key=k, rank=i))
    db.commit()
    return {"status": "ok", "count": len(keys)}


class FavoriteReorder(BaseModel):
    item_key: str
    direction: str  # "up" | "down"
    user: Optional[str] = None


@router.post("/favorites/reorder")
def reorder_favorite(body: FavoriteReorder, db: Session = Depends(get_db)):
    """Swap one favorite's rank with its neighbour. `direction = "up"`
    moves it toward rank 1; `"down"` moves it toward rank 10."""
    if body.direction not in ("up", "down"):
        raise HTTPException(400, "direction must be 'up' or 'down'")
    email = (body.user or DEFAULT_USER_EMAIL).lower()
    key = _normalize_item(body.item_key)
    rows = _user_favorites_ordered(db, email)
    target = next((r for r in rows if r.item_key == key), None)
    if not target or target.rank is None:
        raise HTTPException(404, "Favorite not found")

    new_rank = target.rank - 1 if body.direction == "up" else target.rank + 1
    if new_rank < 1 or new_rank > min(len(rows), MAX_FAVORITES):
        return {"status": "noop", "item_key": key, "rank": target.rank}

    neighbour = next((r for r in rows if r.rank == new_rank), None)
    if neighbour:
        neighbour.rank = target.rank
    target.rank = new_rank
    db.commit()
    return {"status": "moved", "item_key": key, "rank": target.rank}


# Formula 1 points table — 25/18/15/12/10/8/6/4/2/1 across positions
# 1..10. Used to score the company-wide favorites ranking so a single
# rank-1 pick (25 pts) outweighs ~13 rank-10 throwaways (1 pt each).
# Linear scoring (10/9/8/.../1) under-rewarded passionate #1 picks.
F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]


@router.get("/favorites/company")
def company_favorites(db: Session = Depends(get_db)):
    """Aggregate every user's top-10 into a company-wide ranking using
    the F1 points table (25/18/15/12/10/8/6/4/2/1 by rank). A single
    enthusiastic #1 vote outweighs many #10 throwaways."""
    rows = db.execute(select(LunchFavorite)).scalars().all()
    if not rows:
        return {"items": [], "user_count": 0}

    score: Counter[str] = Counter()
    mark_count: Counter[str] = Counter()
    users: set[str] = set()
    for r in rows:
        users.add(r.user_email)
        mark_count[r.item_key] += 1
        # Unranked legacy rows get the rank-10 score (1 point) — they
        # represent "favorited but never ordered".
        rank = r.rank if r.rank and 1 <= r.rank <= MAX_FAVORITES else MAX_FAVORITES
        score[r.item_key] += F1_POINTS[rank - 1]

    # Pretty display name comes from the latest occurrence in lunch_menus.
    menus = db.execute(select(LunchMenu)).scalars().all()
    display: dict[str, str] = {}
    for m in menus:
        for raw in (m.items or []):
            name = str(raw).strip()
            if not name:
                continue
            display.setdefault(_normalize_item(name), name)

    items = [
        {
            "item_key": k,
            "name": display.get(k, k),
            "score": score[k],
            "marks": mark_count[k],
        }
        for k in score
    ]
    items.sort(key=lambda x: (-x["score"], -x["marks"], x["name"].lower()))
    return {"items": items, "user_count": len(users)}


# ------------------------------------------------------------------
# Prediction — project an entire calendar month of lunches
# ------------------------------------------------------------------
def _parse_month(month: Optional[str]) -> tuple[int, int]:
    """Return (year, month) for `YYYY-MM`, defaulting to the NEXT
    calendar month relative to today (UTC) if not provided."""
    if month:
        try:
            y_s, m_s = month.split("-")
            y, m = int(y_s), int(m_s)
        except Exception:
            raise HTTPException(400, "month must be 'YYYY-MM'")
        if not (1 <= m <= 12) or not (1970 <= y <= 2100):
            raise HTTPException(400, "month out of range")
        return y, m
    today = datetime.now(timezone.utc).date()
    return (today.year, today.month + 1) if today.month < 12 else (today.year + 1, 1)


def _last_day_of_month(year: int, month: int) -> date:
    if month == 12:
        return date(year + 1, 1, 1) - timedelta(days=1)
    return date(year, month + 1, 1) - timedelta(days=1)


# ------------------------------------------------------------------
# Prediction scoring helpers
# ------------------------------------------------------------------
# The naive "top frequency on this weekday" predictor locks onto whichever
# dish leads the count and reports it for every future occurrence — so a
# dish served 4 of the last 9 Thursdays gets predicted for ALL Thursdays.
# Real kitchens rotate; they don't repeat. We refine the raw weekday
# frequency with two dampers:
#
#   1. RECENCY PENALTY — a dish served in the last few days is suppressed
#      because the kitchen just used it and won't repeat it immediately,
#      regardless of weekday alignment.
#   2. GAP MATCH — for dishes with multiple same-weekday appearances we
#      learn the typical inter-appearance interval (e.g. "every 4
#      Thursdays") and boost the dish on the date when the elapsed weeks
#      since its last appearance match that interval. Off-cycle dates
#      get suppressed.
#
# Final score = base_freq × recency_weight × gap_score, clamped to [0, 1].
# Dishes with too little history (< 2 same-weekday appearances) skip the
# gap term entirely and fall back to plain frequency × recency.


def _recency_weight(days_since_any: int) -> float:
    """Suppress dishes the kitchen just served. Anything served in the
    last ~3 weeks is dampened on a piecewise ramp; past ~3 weeks the dish
    is fully eligible again."""
    if days_since_any <= 3:
        return 0.10
    if days_since_any <= 9:
        return 0.40
    if days_since_any <= 20:
        return 0.80
    return 1.00


def _gap_score(
    same_dow_dates: list[date],
    target: date,
) -> tuple[float, Optional[float], Optional[float]]:
    """Score how well the elapsed weeks since this dish's last appearance
    on the target weekday match its typical inter-appearance gap. Returns
    (score, weeks_since_last_dow, mean_gap_weeks). A Gaussian peaked at
    the mean gap with sigma = max(stddev, 1.0) — so on-cycle dates score
    near 1.0 and far-off dates trail toward 0.

    Returns (1.0, None, None) when we don't have ≥ 2 same-weekday samples
    to estimate a gap from; the caller falls back to the base term so
    new/rare dishes aren't penalized for lack of evidence."""
    if len(same_dow_dates) < 2:
        return 1.0, None, None
    gaps_weeks = [
        (same_dow_dates[i] - same_dow_dates[i - 1]).days / 7.0
        for i in range(1, len(same_dow_dates))
    ]
    mean_gap = max(sum(gaps_weeks) / len(gaps_weeks), 1.0)
    last_dow = same_dow_dates[-1]
    weeks_since = (target - last_dow).days / 7.0
    if weeks_since <= 0:
        # Target is at or before the most recent appearance — predicting
        # the past, or the kitchen already served it on this weekday very
        # recently. Heavy suppression.
        return 0.10, weeks_since, mean_gap
    # Wider tolerance when the spread of historical gaps is large.
    if len(gaps_weeks) >= 2:
        var = sum((g - mean_gap) ** 2 for g in gaps_weeks) / len(gaps_weeks)
        sigma = max(var ** 0.5, 1.0)
    else:
        sigma = max(mean_gap * 0.5, 1.0)
    z = (weeks_since - mean_gap) / sigma
    return math.exp(-(z * z)), weeks_since, mean_gap


@router.get("/prediction")
def predict(month: Optional[str] = None, db: Session = Depends(get_db)):
    """Project every weekday in a full calendar month. For each weekday
    in the target month we score every dish ever served on that weekday
    using a base weekday-frequency term, dampened by:
      · recency_weight — suppresses dishes the kitchen just served
      · gap_score      — boosts dishes whose typical inter-appearance
                         interval matches how long it's been since they
                         last showed up on this weekday
    See the helper docstrings above for the math. Each predicted item
    carries supporting stats (served_on_weekday, days_since_any,
    weeks_since_same_dow, typical_gap_weeks) so the UI and the explain
    endpoint can describe WHY a pick rose to the top."""
    target_year, target_month = _parse_month(month)
    first = date(target_year, target_month, 1)
    last = _last_day_of_month(target_year, target_month)

    rows = db.execute(select(LunchMenu)).scalars().all()
    by_dow: dict[int, Counter[str]] = defaultdict(Counter)
    dow_total_menus: Counter[int] = Counter()
    display: dict[str, str] = {}
    appearances: dict[str, list[date]] = defaultdict(list)

    for m in rows:
        try:
            d = date.fromisoformat(m.date)
        except ValueError:
            continue
        dow = d.weekday()
        dow_total_menus[dow] += 1
        for raw in (m.items or []):
            name = str(raw).strip()
            if not name:
                continue
            key = _normalize_item(name)
            display.setdefault(key, name)
            by_dow[dow][key] += 1
            appearances[key].append(d)

    # Sort per-dish appearance lists once so [-1] is always the latest.
    for key in appearances:
        appearances[key].sort()

    projections = []
    cursor = first
    while cursor <= last:
        if cursor.weekday() >= 5:  # skip Sat/Sun
            cursor += timedelta(days=1)
            continue
        dow = cursor.weekday()
        total = dow_total_menus.get(dow, 0)

        scored: list[dict] = []
        for key, count in by_dow[dow].items():
            base = (count / total) if total > 0 else 0.0
            history = appearances[key]
            days_since_any = (cursor - history[-1]).days if history else 9_999
            recency_w = _recency_weight(days_since_any)
            same_dow = [d for d in history if d.weekday() == dow]
            gap_s, weeks_since_dow, mean_gap_w = _gap_score(same_dow, cursor)
            final = base * recency_w * gap_s
            scored.append({
                "name": display[key],
                "score": final,
                "served_on_weekday": count,
                "weekday_total": total,
                "days_since_any": days_since_any,
                "weeks_since_same_dow": weeks_since_dow,
                "typical_gap_weeks": mean_gap_w,
            })
        scored.sort(key=lambda x: -x["score"])
        top = scored[:10]

        conf = "high" if total >= 6 else "medium" if total >= 2 else "low"
        projections.append({
            "date": cursor.isoformat(),
            "day_of_week": cursor.strftime("%a"),
            "predicted_items": top,
            "confidence": conf,
            "weekday_menu_count": total,
        })
        cursor += timedelta(days=1)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "history_menus": len(rows),
        "target_month": f"{target_year:04d}-{target_month:02d}",
        "target_month_label": first.strftime("%B %Y"),
        "target_month_first_day": first.isoformat(),
        "target_month_last_day": last.isoformat(),
        "projections": projections,
    }


# ------------------------------------------------------------------
# Prediction — Claude-generated day-level reasoning
# ------------------------------------------------------------------
class PredictionExplainReq(BaseModel):
    date: str               # YYYY-MM-DD
    items: Optional[list[str]] = None  # optional subset; defaults to the top-k


PREDICTION_EXPLAIN_PROMPT = """You are a lunch-menu analyst explaining one day's forecast.

Given a target date, the day of the week, and a list of candidate dishes with
three signals each — weekday frequency ("served 4 of the last 9 Tuesdays"),
recency ("last seen 17 days ago anywhere on the menu"), and rotation cadence
("typical gap of 4 weeks between Tuesday appearances; 3.8 weeks since last
Tuesday") — explain in 2-3 short sentences WHY those items rose to the top
for THIS specific date. Lean on whichever signal is strongest: a dish that's
exactly on its rotation cadence is a stronger pick than a high-frequency
dish that was just served last week. Avoid generic statements like "this is
a popular dish"; tie the reason to the date.

Return ONLY a JSON object: {"reason": "..."}. No markdown, no preamble."""


@router.post("/prediction/explain")
def explain_prediction(body: PredictionExplainReq, db: Session = Depends(get_db)):
    """Ask Claude to narrate why a specific day is likely to see a specific
    set of dishes, using the weekday frequency stats as anchor evidence."""
    try:
        target = date.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")

    rows = db.execute(select(LunchMenu)).scalars().all()
    by_dow: dict[int, Counter[str]] = defaultdict(Counter)
    dow_total_menus: Counter[int] = Counter()
    display: dict[str, str] = {}
    appearances: dict[str, list[date]] = defaultdict(list)
    same_weekday_menus: list[dict] = []
    for m in rows:
        try:
            d = date.fromisoformat(m.date)
        except ValueError:
            continue
        dow = d.weekday()
        dow_total_menus[dow] += 1
        for raw in (m.items or []):
            name = str(raw).strip()
            if not name:
                continue
            key = _normalize_item(name)
            display.setdefault(key, name)
            by_dow[dow][key] += 1
            appearances[key].append(d)
        if d.weekday() == target.weekday():
            same_weekday_menus.append({"date": m.date, "items": list(m.items or [])})
    for key in appearances:
        appearances[key].sort()

    dow = target.weekday()
    total = dow_total_menus.get(dow, 0)
    candidate_items = body.items
    if not candidate_items:
        candidate_items = [display[k] for k, _ in by_dow[dow].most_common(6)]

    # Per-candidate stat block — frequency, recency, and rotation cadence
    # — so Claude can reason about WHY a dish surfaced for this date
    # rather than relying on raw frequency alone.
    weekday_label = target.strftime("%A")
    stats_lines: list[str] = []
    for name in candidate_items:
        key = _normalize_item(name)
        served = by_dow[dow].get(key, 0)
        history = appearances.get(key, [])
        same_dow = [d for d in history if d.weekday() == dow]
        if history:
            days_since_any = (target - history[-1]).days
            recency_str = (
                f"last seen {days_since_any}d ago" if days_since_any > 0
                else "served on this very date"
            )
        else:
            recency_str = "no history"
        if len(same_dow) >= 2:
            gaps = [(same_dow[i] - same_dow[i - 1]).days / 7.0 for i in range(1, len(same_dow))]
            mean_gap = sum(gaps) / len(gaps)
            weeks_since_dow = (target - same_dow[-1]).days / 7.0
            rotation_str = (
                f"typical gap {mean_gap:.1f}w between {weekday_label}s, "
                f"{weeks_since_dow:.1f}w since last {weekday_label}"
            )
        elif len(same_dow) == 1:
            weeks_since_dow = (target - same_dow[-1]).days / 7.0
            rotation_str = f"only one prior {weekday_label} appearance, {weeks_since_dow:.1f}w ago"
        else:
            rotation_str = f"never served on a {weekday_label} before"
        stats_lines.append(
            f"- {name}: served {served} of {total} historical {weekday_label}s · "
            f"{recency_str} · {rotation_str}"
        )

    history_excerpt: list[str] = []
    for m in sorted(same_weekday_menus, key=lambda x: x["date"], reverse=True)[:8]:
        history_excerpt.append(f"- {m['date']} ({weekday_label}): {', '.join(m['items'])}")

    user_text = (
        f"Target date: {body.date} ({weekday_label})\n"
        f"Total historical {weekday_label}s on record: {total}\n\n"
        f"Candidate dishes and their frequency:\n" + "\n".join(stats_lines) +
        (f"\n\nRecent menus on the same weekday:\n" + "\n".join(history_excerpt) if history_excerpt else "") +
        "\n\nProduce the JSON per the schema."
    )

    try:
        out = complete_json(
            system=PREDICTION_EXPLAIN_PROMPT,
            user_content=[text_block(user_text)],
            max_tokens=800,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))

    reason = (out.get("reason") or "").strip() or "Not enough history to narrate this day yet."
    return {
        "date": body.date,
        "day_of_week": weekday_label,
        "weekday_menu_count": total,
        "candidates": candidate_items,
        "reason": reason,
    }


# ------------------------------------------------------------------
# Predictor v2 — spec'd seven-factor scorer with factor breakdown
# ------------------------------------------------------------------
# The /prediction endpoint above projects a full month using a single
# weekday-frequency × recency × gap heuristic. /forecast (this section)
# implements the richer spec: for each future weekday we score every
# main dish on seven independent factors and return a ranked pick with
# a per-factor breakdown the UI can render as a "score receipt".
#
# The spec assumes a dish catalog with cuisine/protein/complexity/
# rating/seasonal_affinity/dow_affinity columns we don't have yet.
# Until that catalog is built we derive what we can from the menu
# history and use neutral defaults for the rest:
#   · cuisine + protein → keyword classifier on dish name
#   · seasonal_affinity → derived from per-dish history when ≥ 6 samples
#   · dow_affinity      → derived from per-dish history when ≥ 5 samples
#   · last_served_date, times_served_ytd → derived from history
#   · avg_rating, complexity → neutral (3.0 / 3) — produce mid-band
#                              factor scores that won't dominate
# Cold-start safeguard from the spec: dishes with < 3 historical
# servings cap the rating factor at 0.5 raw.
SEASON_MONTHS = {
    "winter": {12, 1, 2},
    "spring": {3, 4, 5},
    "summer": {6, 7, 8},
    "fall":   {9, 10, 11},
}

# Special-day placeholders aren't real dishes; exclude from the catalog.
SPECIAL_DAY_KEYS = {"deli day", "deli bar", "chef's choice", "chefs choice"}

# Protein keywords — checked in this priority order so "turkey burger"
# classifies as turkey (matched first), not beef.
PROTEIN_KEYWORDS: list[tuple[str, list[str]]] = [
    ("shrimp", ["shrimp", "prawn", "scampi", "camarones"]),
    ("fish", ["salmon", "tuna", "cod", "tilapia", "halibut", "mahi", "fish", "trout", "haddock", "pescado"]),
    ("turkey", ["turkey", "pavo"]),
    ("chicken", ["chicken", "poultry", "pollo"]),
    ("pork", ["pork", "ham", "bacon", "sausage", "chorizo", "carnitas", "prosciutto", "puerco", "cerdo", "lechon"]),
    ("beef", ["beef", "steak", "brisket", "meatloaf", "burger", "hamburger", "ribeye", "sirloin", "cheesesteak", "carne", "bourguignon"]),
    ("vegetarian", ["tofu", "eggplant", "falafel", "primavera", "vegetable", "veggie", "mushroom", "lentil", "chickpea"]),
]

CUISINE_KEYWORDS: list[tuple[str, list[str]]] = [
    # latin: Cuban / Puerto Rican / Caribbean dishes are common in this
    # caterer's rotation, so we lump them with mexican under "latin".
    ("latin", ["taco", "burrito", "enchilada", "fajita", "quesadilla", "chimichanga", "nacho", "tostada", "tamale", "mexican", "carnitas", "barbacoa", "ropa vieja", "arroz con", "pollo a la brasa", "masitas", "lechon", "mojo", "platano", "puerco"]),
    ("italian", ["pasta", "lasagna", "spaghetti", "parmigiana", "parmesan", "parm", "alfredo", "marinara", "italian", "ravioli", "fettuccine", "penne", "ziti", "manicotti", "pizza", "calzone", "gnocchi"]),
    ("asian", ["stir fry", "stir-fry", "kung pao", "lo mein", "fried rice", "teriyaki", "orange chicken", "sesame", "asian", "korean", "japanese", "chinese", "thai", "vietnamese", "pad thai", "sushi", "ramen", "udon", "bulgogi", "general tso"]),
    ("indian", ["curry", "tikka", "masala", "biryani", "samosa", "naan", "indian", "vindaloo", "korma"]),
    ("mediterranean", ["gyro", "kebab", "kabob", "hummus", "pita", "mediterranean", "greek", "souvlaki", "tzatziki", "shawarma"]),
    ("american", ["bbq", "barbecue", "mac and cheese", "mac & cheese", "fried chicken", "pot roast", "sloppy joe", "philly", "cheesesteak", "buffalo", "jerk"]),
    ("french", ["bourguignon", "ratatouille", "coq au vin", "cordon bleu", "provencal"]),
]


def _season_for(d: date) -> str:
    for s, months in SEASON_MONTHS.items():
        if d.month in months:
            return s
    return "winter"


_CLASSIFIER_CACHE: dict[int, list[tuple[str, "_re.Pattern[str]"]]] = {}


def _compile_keywords(keywords: list[tuple[str, list[str]]]) -> list[tuple[str, "_re.Pattern[str]"]]:
    """Compile each label's keywords into a single \\b-anchored regex so
    'ham' doesn't match inside 'hamburger'. Cached by id() to avoid
    recompiling on every request."""
    cache_key = id(keywords)
    cached = _CLASSIFIER_CACHE.get(cache_key)
    if cached is not None:
        return cached
    compiled = []
    for label, kws in keywords:
        # Sort by length descending so multi-word keywords ("mac and
        # cheese") get the chance to match before substrings ("mac").
        ordered = sorted(kws, key=len, reverse=True)
        pattern = r"\b(?:" + "|".join(_re.escape(k) for k in ordered) + r")\b"
        compiled.append((label, _re.compile(pattern, _re.IGNORECASE)))
    _CLASSIFIER_CACHE[cache_key] = compiled
    return compiled


def _classify(name: str, keywords: list[tuple[str, list[str]]]) -> Optional[str]:
    for label, pat in _compile_keywords(keywords):
        if pat.search(name):
            return label
    return None


def _build_catalog(rows: list[LunchMenu]) -> dict[str, dict]:
    """Build a per-dish record from the main-dish slot (items[0]) of the
    menu history. Skips Deli Day / Chef's Choice — those are scheduled
    overrides, not catalog entries."""
    catalog: dict[str, dict] = {}
    appearances: dict[str, list[date]] = defaultdict(list)

    for m in rows:
        items = m.items or []
        if not items:
            continue
        main = str(items[0]).strip()
        if not main:
            continue
        key = _normalize_item(main)
        if key in SPECIAL_DAY_KEYS:
            continue
        try:
            d = date.fromisoformat(m.date)
        except ValueError:
            continue
        appearances[key].append(d)
        if key not in catalog:
            catalog[key] = {
                "id": key,
                "name": main,
                "protein": _classify(main, PROTEIN_KEYWORDS),
                "cuisine": _classify(main, CUISINE_KEYWORDS),
                "complexity": 3,        # neutral — no catalog data yet
                "avg_rating": 3.0,      # neutral — no rating data yet
                "times_served_ytd": 0,
                # Slightly-under-neutral defaults so factor scores stay
                # mid-band when we have no signal: season 0.8 → ~7.5pts
                # (under the 10pt "season favorite" reason threshold);
                # dow 0.85 → ~3pts (under the 4pt threshold).
                "seasonal_affinity": {"winter": 0.8, "spring": 0.8, "summer": 0.8, "fall": 0.8},
                "dow_affinity": {1: 0.85, 2: 0.85, 3: 0.85, 4: 0.85, 5: 0.85},
                "last_served_date": None,
            }

    current_year = datetime.now(timezone.utc).year
    for key, dates_list in appearances.items():
        rec = catalog[key]
        sorted_dates = sorted(dates_list)
        rec["last_served_date"] = sorted_dates[-1]
        rec["times_served_ytd"] = sum(1 for d in sorted_dates if d.year == current_year)
        rec["_total_appearances"] = len(sorted_dates)

        # Seasonal affinity: only deviate from the no-data default (0.8)
        # on a strong signal — boost or penalty. Mid-range stays at the
        # default so dishes without real seasonal lean don't mistakenly
        # trigger the "Spring favorite" reason.
        if len(sorted_dates) >= 6:
            season_counts = Counter(_season_for(d) for d in sorted_dates)
            expected = len(sorted_dates) / 4.0
            for s in ["winter", "spring", "summer", "fall"]:
                c = season_counts.get(s, 0)
                if c > expected * 1.4:
                    rec["seasonal_affinity"][s] = 1.3
                elif c < expected * 0.4:
                    rec["seasonal_affinity"][s] = 0.7
                # else: leave at 0.8 (default)

        weekday_dates = [d for d in sorted_dates if d.weekday() < 5]
        if len(weekday_dates) >= 5:
            dow_counts = Counter(d.weekday() + 1 for d in weekday_dates)
            expected_dow = len(weekday_dates) / 5.0
            for dow in range(1, 6):
                c = dow_counts.get(dow, 0)
                if c > expected_dow * 1.5:
                    rec["dow_affinity"][dow] = 1.2
                elif c < expected_dow * 0.4:
                    rec["dow_affinity"][dow] = 0.7
                # else: leave at 0.85 (default)

    return catalog


def _score_dish(dish: dict, ctx: dict) -> dict:
    """Compute the seven-factor weighted score and per-factor breakdown."""
    target_dow = ctx["target_dow"]                  # 1..5
    target_season = ctx["target_season"]
    target_date: date = ctx["target_date"]
    recent_proteins: list[str] = ctx["recent_proteins"]
    recent_cuisines: list[str] = ctx["recent_cuisines"]

    last_served = dish["last_served_date"]
    days_since = (target_date - last_served).days if last_served else 9_999

    # 1. Recency — 0 if just served, ~1.0 once 3 weeks have passed.
    recency_raw = min(days_since / 14.0, 1.5) / 1.5

    # 2. Rating — neutral 3.0 → 0.0 raw. Cold-start: cap at 0.5 when we
    #    don't trust the dish's history yet (< 3 servings).
    rating_raw = (dish["avg_rating"] - 3.0) / 2.0
    if dish.get("_total_appearances", 0) < 3:
        rating_raw = min(rating_raw, 0.5)

    # 3. Season fit
    season_mult = dish["seasonal_affinity"].get(target_season, 0.8)
    season_raw = (season_mult - 0.5) / 0.8

    # 4. Day-of-week fit
    dow_mult = dish["dow_affinity"].get(target_dow, 0.85)
    dow_raw = (dow_mult - 0.7) / 0.5

    # 5. Rotation — penalize protein/cuisine reuse from the previous 2
    #    serving days. Dishes with no classified protein/cuisine can't
    #    trigger the penalty; rotation stays at 1.0 for them.
    rotation_raw = 1.0
    if dish["protein"] and dish["protein"] in recent_proteins:
        rotation_raw -= 0.6
    if dish["cuisine"] and dish["cuisine"] in recent_cuisines:
        rotation_raw -= 0.4
    rotation_raw = max(0.0, rotation_raw)

    # 6. Complexity — staffing dips Mon/Fri so simpler dishes get a nudge.
    if target_dow in (1, 5):
        complexity_raw = (5 - dish["complexity"]) / 4.0
    else:
        complexity_raw = 0.5

    # 7. Novelty — bonus for dishes overdue past ~3 weeks.
    novelty_raw = min(days_since / 21.0, 1.0) if days_since > 0 else 0.0

    factors = [
        ("recency",    recency_raw,    0.30),
        ("rating",     rating_raw,     0.20),
        ("season",     season_raw,     0.20),
        ("dow",        dow_raw,        0.10),
        ("rotation",   rotation_raw,   0.10),
        ("complexity", complexity_raw, 0.05),
        ("novelty",    novelty_raw,    0.05),
    ]
    total = sum(s * w for _, s, w in factors)
    return {
        "total_score": total,
        "days_since": days_since,
        "factor_breakdown": [
            {
                "factor": name,
                "raw_score": round(raw, 3),
                "weight": w,
                "contribution_pts": round(raw * w * 100, 1),
            }
            for name, raw, w in factors
        ],
    }


def _generate_reasons(dish: dict, scoring: dict, ctx: dict) -> list[str]:
    """Plain-language reasons keyed off the spec's contribution thresholds.
    Always returns at least 3 entries — falls back to summarizing the top
    contributing factors when fewer specific reasons fire."""
    pts = {f["factor"]: f["contribution_pts"] for f in scoring["factor_breakdown"]}
    raw = {f["factor"]: f["raw_score"] for f in scoring["factor_breakdown"]}
    target_date: date = ctx["target_date"]
    target_dow: int = ctx["target_dow"]
    target_season: str = ctx["target_season"]
    weekday_name = target_date.strftime("%A")
    season_name = target_season.title()
    days_since = scoring["days_since"]

    out: list[tuple[float, str]] = []

    if pts["recency"] > 8 and days_since < 9_999:
        out.append((pts["recency"], f"Hasn't been on the menu in {days_since} days — overdue for a return."))

    if pts["season"] > 10:
        out.append((pts["season"], f"{season_name} favorite — historically performs best this time of year."))
    elif pts["season"] < 3:
        out.append((1.0, f"Not a typical {season_name} pick, but other factors made it the strongest option."))

    if pts["rating"] > 12:
        out.append((pts["rating"], f"Top-rated dish in the catalog ({dish['avg_rating']}★) — kitchen tends to repeat winners."))

    if pts["dow"] > 4:
        out.append((pts["dow"], f"Common {weekday_name} choice based on past rotations."))

    if raw["rotation"] >= 1.0 and (dish["protein"] or dish["cuisine"]):
        rec_p = ctx.get("recent_proteins", [])
        if len(rec_p) >= 2:
            out.append((pts["rotation"], f"Provides protein and cuisine variety from the previous two days ({rec_p[0]}, {rec_p[1]})."))
        else:
            out.append((pts["rotation"], "Provides protein and cuisine variety from recent days."))
    elif raw["rotation"] < 0.5:
        out.append((0.0, "Note: shares protein with a recent day — flagged as a weaker rotation pick."))

    if pts["complexity"] > 2 and target_dow in (1, 5):
        out.append((pts["complexity"], "Simple prep — fits the lighter Monday/Friday kitchen schedule."))

    if raw["novelty"] > 0.8:
        out.append((pts["novelty"], "Hasn't appeared in over 3 weeks — strong novelty signal."))

    out.sort(key=lambda x: -x[0])
    reasons = [r[1] for r in out]

    # Backfill so the user always gets at least 3 plausible bullets.
    if len(reasons) < 3:
        ranked = sorted(scoring["factor_breakdown"], key=lambda f: -f["contribution_pts"])
        for f in ranked:
            if len(reasons) >= 3:
                break
            blurb = _factor_summary(f, dish, ctx, days_since)
            if blurb and blurb not in reasons:
                reasons.append(blurb)

    return reasons[:5]


def _factor_summary(factor: dict, dish: dict, ctx: dict, days_since: int) -> Optional[str]:
    name = factor["factor"]
    pts = factor["contribution_pts"]
    if name == "recency":
        if days_since >= 9_999:
            return "No prior history of this dish."
        return f"Last seen {days_since} days ago."
    if name == "rotation":
        if factor["raw_score"] >= 1.0:
            return "Different rotation slot from the previous serving days."
        return None
    if name == "season":
        return f"Reasonable fit for {ctx['target_season'].title()}."
    if name == "dow":
        return f"Plausible {ctx['target_date'].strftime('%A')} pick based on weekday history."
    if name == "novelty":
        return "Hasn't been on the menu in a while."
    if name == "complexity":
        return f"Prep complexity rated {dish['complexity']}/5."
    if name == "rating":
        return None  # Neutral rating doesn't deserve a reason line.
    if pts <= 0:
        return None
    return None


def _public_dish(d: dict) -> dict:
    """Strip internal scoring fields before sending to the client."""
    return {
        "id": d["id"],
        "name": d["name"],
        "protein": d["protein"],
        "cuisine": d["cuisine"],
        "complexity": d["complexity"],
        "avg_rating": d["avg_rating"],
        "times_served_ytd": d["times_served_ytd"],
        "last_served_date": d["last_served_date"].isoformat() if d["last_served_date"] else None,
        "seasonal_affinity": d["seasonal_affinity"],
        "dow_affinity": {str(k): v for k, v in d["dow_affinity"].items()},
    }


@router.get("/forecast")
def forecast(
    days_ahead: int = 5,
    start_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Spec'd seven-factor predictor. Returns the next `days_ahead`
    business days, each with a top pick, factor breakdown, plain-language
    reasons, and three runners-up. Predictions roll forward — once a
    dish is picked for day N, its last_served_date is updated and its
    protein/cuisine enter the recent buffer so day N+1 doesn't repeat it."""
    days_ahead = max(1, min(days_ahead, 30))
    try:
        today_d = (
            date.fromisoformat(start_date) if start_date
            else datetime.now(timezone.utc).date()
        )
    except ValueError:
        raise HTTPException(400, "start_date must be YYYY-MM-DD")

    rows = db.execute(select(LunchMenu)).scalars().all()
    catalog = _build_catalog(rows)

    # Index history by date so we can seed the rotation buffer with the
    # last 2 actual serving days before the prediction window AND honor
    # any menus the kitchen has already scheduled in the future.
    history_by_date: dict[date, dict] = {}
    scheduled_main: dict[date, str] = {}
    for m in rows:
        try:
            d = date.fromisoformat(m.date)
        except ValueError:
            continue
        items = m.items or []
        if not items:
            continue
        main = str(items[0]).strip()
        if not main:
            continue
        if d >= today_d:
            scheduled_main[d] = main
        if _normalize_item(main) in SPECIAL_DAY_KEYS:
            continue
        history_by_date[d] = {
            "protein": _classify(main, PROTEIN_KEYWORDS),
            "cuisine": _classify(main, CUISINE_KEYWORDS),
        }

    # Walk back from yesterday until we've collected the 2 most recent
    # serving days. Calendar gaps (weekends, holidays) are skipped so the
    # rotation buffer stays meaningful.
    recent: deque[tuple[Optional[str], Optional[str]]] = deque(maxlen=2)
    walk = today_d - timedelta(days=1)
    days_walked = 0
    while len(recent) < 2 and days_walked < 21:
        rec = history_by_date.get(walk)
        if rec:
            recent.appendleft((rec["protein"], rec["cuisine"]))
        walk -= timedelta(days=1)
        days_walked += 1

    # Anti-repeat guards. Two layers, on top of the recency damper:
    #   1. window_used_keys — every dish that appears in the window
    #      (whether scheduled or predicted) is locked out from being
    #      picked again. Keeps "Chicken Parm" off every Friday in a
    #      multi-week forecast even when scoring would otherwise allow
    #      it back in.
    #   2. MIN_GAP_DAYS — a dish whose last_served_date is within this
    #      many days of the target is excluded from the candidate pool
    #      entirely, so a dish served yesterday can't sneak past the
    #      recency damper just because the catalog is sparse.
    MIN_GAP_DAYS = 5
    window_used_keys: set[str] = {
        _normalize_item(name) for name in scheduled_main.values()
        if _normalize_item(name) not in SPECIAL_DAY_KEYS
    }

    predictions: list[dict] = []
    cursor = today_d
    safety = 0
    while len(predictions) < days_ahead and safety < days_ahead * 3 + 7:
        safety += 1
        if cursor.weekday() >= 5:           # Sat/Sun
            cursor += timedelta(days=1)
            continue

        ctx = {
            "today": today_d,
            "target_date": cursor,
            "target_dow": cursor.weekday() + 1,
            "target_season": _season_for(cursor),
            "days_out": (cursor - today_d).days,
            "recent_proteins": [p for (p, _) in recent if p],
            "recent_cuisines": [c for (_, c) in recent if c],
        }

        # If the kitchen has already committed a menu for this date,
        # surface it as scheduled instead of overwriting with a guess.
        if cursor in scheduled_main:
            main = scheduled_main[cursor]
            key = _normalize_item(main)
            is_special = key in SPECIAL_DAY_KEYS
            cat_entry = catalog.get(key)
            if cat_entry:
                shown = _public_dish(cat_entry)
            else:
                shown = {
                    "id": key,
                    "name": main,
                    "protein": None if is_special else _classify(main, PROTEIN_KEYWORDS),
                    "cuisine": None if is_special else _classify(main, CUISINE_KEYWORDS),
                    "complexity": 3,
                    "avg_rating": 3.0,
                    "times_served_ytd": 0,
                    "last_served_date": None,
                    "seasonal_affinity": {"winter": 0.8, "spring": 0.8, "summer": 0.8, "fall": 0.8},
                    "dow_affinity": {"1": 0.85, "2": 0.85, "3": 0.85, "4": 0.85, "5": 0.85},
                }
            reason = (
                "Special day already on the schedule — no prediction needed."
                if is_special else
                "Already on the schedule — pulled directly from the saved menu."
            )
            predictions.append({
                "date": cursor.isoformat(),
                "dow": ctx["target_dow"],
                "day_of_week": cursor.strftime("%A"),
                "predicted_dish": shown,
                "confidence": 100,
                "reasons": [reason],
                "factor_breakdown": [],
                "runners_up": [],
                "scheduled": True,
            })
            # Roll the scheduled dish into the rotation buffer so the
            # next predicted day still sees it as "just served."
            if not is_special:
                recent.append((
                    _classify(main, PROTEIN_KEYWORDS),
                    _classify(main, CUISINE_KEYWORDS),
                ))
            cursor += timedelta(days=1)
            continue

        if not catalog:
            predictions.append({
                "date": cursor.isoformat(),
                "dow": ctx["target_dow"],
                "day_of_week": cursor.strftime("%A"),
                "predicted_dish": None,
                "confidence": 0,
                "reasons": ["No history yet — import a few weeks of menus to seed the predictor."],
                "factor_breakdown": [],
                "runners_up": [],
                "scheduled": False,
            })
            cursor += timedelta(days=1)
            continue

        scored: list[dict] = []
        for dish in catalog.values():
            if dish["id"] in window_used_keys:
                continue  # already scheduled or already predicted earlier this window
            if dish["last_served_date"] is not None:
                gap = (cursor - dish["last_served_date"]).days
                if gap < MIN_GAP_DAYS:
                    continue
            s = _score_dish(dish, ctx)
            scored.append({"dish": dish, **s})
        scored.sort(key=lambda x: -x["total_score"])

        if not scored:
            # Catalog exhausted by the anti-repeat filters — surface a
            # graceful empty pick rather than crashing.
            predictions.append({
                "date": cursor.isoformat(),
                "dow": ctx["target_dow"],
                "day_of_week": cursor.strftime("%A"),
                "predicted_dish": None,
                "confidence": 0,
                "reasons": ["Catalog exhausted for this window — every viable dish is already scheduled or recently served."],
                "factor_breakdown": [],
                "runners_up": [],
                "scheduled": False,
            })
            cursor += timedelta(days=1)
            continue

        winner = scored[0]
        runners = scored[1:4]
        predictions.append({
            "date": cursor.isoformat(),
            "dow": ctx["target_dow"],
            "day_of_week": cursor.strftime("%A"),
            "predicted_dish": _public_dish(winner["dish"]),
            "confidence": round(min(winner["total_score"], 1.0) * 100, 1),
            "reasons": _generate_reasons(winner["dish"], winner, ctx),
            "factor_breakdown": winner["factor_breakdown"],
            "runners_up": [
                {
                    "dish": _public_dish(r["dish"]),
                    "confidence": round(min(r["total_score"], 1.0) * 100, 1),
                }
                for r in runners
            ],
            "scheduled": False,
        })
        window_used_keys.add(winner["dish"]["id"])

        # Roll the winner forward so day N+1 sees it as just-served.
        win = winner["dish"]
        win["last_served_date"] = cursor
        recent.append((win["protein"], win["cuisine"]))

        cursor += timedelta(days=1)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "today": today_d.isoformat(),
        "days_ahead": days_ahead,
        "history_menus": len(rows),
        "catalog_size": len(catalog),
        "predictions": predictions,
    }


# ------------------------------------------------------------------
# Wipe — drop all menus + favorites. Used from the Edit Data modal's
# reset flow and from the CLI when we want a clean slate.
# ------------------------------------------------------------------
@router.delete("/menus", status_code=200)
def wipe_all_menus(db: Session = Depends(get_db)):
    menu_n = db.query(LunchMenu).delete()
    fav_n = db.query(LunchFavorite).delete()
    db.commit()
    return {"status": "ok", "menus_deleted": menu_n, "favorites_deleted": fav_n}


# ------------------------------------------------------------------
# Outlook email import — drop a .eml / .msg file (or paste the body)
# and optionally include one or more attachments. Everything gets
# funneled to Claude with the same schema as import-pdf.
# ------------------------------------------------------------------
EMAIL_LUNCH_SYSTEM = """You are reading an email (sometimes with attachments) that announces an
in-office lunch menu. Return a JSON object with a `menus` array. Each entry:

{
  "date": "YYYY-MM-DD",
  "items": [string, ...]
}

Menu layout — preserve the order items appear in the source so the
downstream app can classify each line by its menu position:
  · items[0] — Main dish
  · items[1] — Side dish
  · items[2] — Side dish
  · items[3] — Soup

SPECIAL DAY RULES (very important):
- If the top/first line of the day is "Deli Day" (any casing, or "Deli
  Bar"), return ONLY ["Deli Day"] for that day. Do NOT include any
  other items even if they also appear on the menu — Deli Day
  replaces the regular layout.
- If the top/first line of the day is "Chef's Choice" (any casing,
  e.g. "Chefs Choice"), return ONLY ["Chef's Choice"] for that day.
  Do NOT include any other items.

General rules:
- Each `items` entry is ONE dish name. Do NOT bundle multiple dishes into one string.
- Preserve the printed order so position-based classification works correctly.
- Skip descriptive lines ("Served with roasted vegetables") unless they're clearly a separate dish.
- If a day has no dishes listed (holiday, "no service"), skip the day entirely.
- Many caterers send a week-at-a-glance; map each weekday to the correct calendar date using the week/year context in the email.
- If the year isn't specified, assume the current year (2026).
- Trim whitespace and drop calorie tags, section headers, marketing copy, or footer boilerplate.
- Body text, PDF attachments, Excel attachments, and CSV attachments may all contain menu data. Extract from every source.
- Return ONLY the JSON object. No markdown fences."""


def _excel_to_text(data: bytes, filename: str) -> Optional[str]:
    """Dump every cell of every sheet in an .xlsx to tab-separated text so
    Claude can read it without needing an Excel-specific content block."""
    try:
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    except Exception as e:
        logger.warning("openpyxl could not read %s: %s", filename, e)
        return None
    parts: list[str] = [f"=== Excel file: {filename} ==="]
    for sheet in wb.worksheets:
        parts.append(f"--- Sheet: {sheet.title} ---")
        for row in sheet.iter_rows(values_only=True):
            cells = ["" if c is None else str(c) for c in row]
            if any(c.strip() for c in cells):
                parts.append("\t".join(cells))
    return "\n".join(parts) if len(parts) > 1 else None


def _csv_to_text(data: bytes, filename: str) -> str:
    try:
        text = data.decode("utf-8", errors="replace")
    except Exception:
        text = data.decode("latin-1", errors="replace")
    # Normalize — run through csv reader and reflow so inconsistent quoting
    # doesn't confuse Claude.
    reader = _csv.reader(io.StringIO(text))
    lines = ["\t".join(row) for row in reader if any(c.strip() for c in row)]
    return f"=== CSV file: {filename} ===\n" + "\n".join(lines)


def _docx_to_text(data: bytes, filename: str) -> Optional[str]:
    """Pull every paragraph + table cell out of a .docx file as plain text.
    Order is preserved so position-based menu classification (line 1 = main,
    etc.) still works after Claude reads the dump."""
    try:
        from docx import Document  # python-docx, already in requirements
    except ImportError:
        logger.warning("python-docx not installed — cannot parse %s", filename)
        return None
    try:
        doc = Document(io.BytesIO(data))
    except Exception as e:
        logger.warning("python-docx could not read %s: %s", filename, e)
        return None

    parts: list[str] = [f"=== Word document: {filename} ==="]
    # Paragraphs in document order.
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if t:
            parts.append(t)
    # Tables — render each row as tab-separated values so a weekly menu
    # grid in a Word table comes through legibly.
    for tbl in doc.tables:
        parts.append("--- table ---")
        for row in tbl.rows:
            cells = [(c.text or "").strip() for c in row.cells]
            if any(cells):
                parts.append("\t".join(cells))
    return "\n".join(parts) if len(parts) > 1 else None


def _parse_eml(data: bytes) -> tuple[str, list[tuple[str, bytes]]]:
    """Pull the plain-text body + list of (filename, bytes) attachments
    out of an RFC 822 .eml message."""
    msg = _email.message_from_bytes(data)
    body_parts: list[str] = []
    attachments: list[tuple[str, bytes]] = []

    subject = msg.get("Subject") or ""
    sender = msg.get("From") or ""
    sent = msg.get("Date") or ""
    if subject or sender or sent:
        body_parts.append(
            f"Subject: {subject}\nFrom: {sender}\nDate: {sent}\n"
        )

    for part in msg.walk():
        disp = (part.get("Content-Disposition") or "").lower()
        ctype = (part.get_content_type() or "").lower()
        if part.is_multipart():
            continue
        if "attachment" in disp or (part.get_filename() and ctype not in ("text/plain", "text/html")):
            fn = part.get_filename() or "attachment.bin"
            payload = part.get_payload(decode=True) or b""
            if payload:
                attachments.append((fn, payload))
        elif ctype == "text/plain":
            payload = part.get_payload(decode=True) or b""
            try:
                body_parts.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
            except Exception:
                body_parts.append(payload.decode("utf-8", errors="replace"))
        elif ctype == "text/html" and not any("text/plain" in (p.get_content_type() or "") for p in msg.walk()):
            # Fall back to HTML body with tags stripped if no plain text part exists.
            payload = part.get_payload(decode=True) or b""
            try:
                html = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            except Exception:
                html = payload.decode("utf-8", errors="replace")
            import re
            body_parts.append(re.sub(r"<[^>]+>", " ", html))

    return "\n\n".join(b for b in body_parts if b.strip()), attachments


def _parse_msg(data: bytes) -> tuple[str, list[tuple[str, bytes]]]:
    """Pull body + attachments out of an Outlook .msg (OLE) file."""
    try:
        import extract_msg
    except ImportError:
        raise HTTPException(
            501,
            "The .msg format requires the `extract-msg` package. Install it or save the "
            "email as .eml from Outlook (File → Save As → Outlook Message Format → .eml).",
        )
    try:
        m = extract_msg.Message(io.BytesIO(data))
    except Exception as e:
        raise HTTPException(400, f"Could not parse .msg file: {e}")

    header_lines = []
    if m.subject: header_lines.append(f"Subject: {m.subject}")
    if m.sender:  header_lines.append(f"From: {m.sender}")
    if m.date:    header_lines.append(f"Date: {m.date}")
    body_text = (m.body or "").strip()
    body = "\n".join(header_lines) + "\n\n" + body_text

    attachments: list[tuple[str, bytes]] = []
    for att in (m.attachments or []):
        try:
            fn = att.longFilename or att.shortFilename or "attachment.bin"
            blob = att.data
            if blob:
                attachments.append((fn, blob))
        except Exception as e:
            logger.warning("extract-msg attachment skipped: %s", e)
    return body, attachments


def _attachment_to_claude_block(
    filename: str, data: bytes,
) -> Optional[dict]:
    """Turn one attachment into a Claude content block. Returns None for
    types we can't read (caller logs + skips)."""
    low = filename.lower()
    if low.endswith(".pdf"):
        # Claude's PDF block takes a path — write to a temp file via pdf_block.
        # We avoid that disk hop by inlining the base64 ourselves.
        return {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(data).decode("ascii"),
            },
        }
    if low.endswith(".docx"):
        txt = _docx_to_text(data, filename)
        if txt:
            return text_block(txt)
        return None
    if low.endswith(".xlsx"):
        txt = _excel_to_text(data, filename)
        if txt:
            return text_block(txt)
        return None
    if low.endswith((".doc", ".xls")):
        # Legacy binary Office formats — neither python-docx nor openpyxl
        # can parse them. Surface a clear message instead of silently
        # dropping; caller logs the warning into the import response.
        logger.warning(
            "Skipping legacy Office file %s — save as .docx or .xlsx and re-upload.",
            filename,
        )
        return None
    if low.endswith(".csv"):
        return text_block(_csv_to_text(data, filename))
    if low.endswith((".txt", ".log")):
        try:
            return text_block(f"=== Text file: {filename} ===\n" + data.decode("utf-8", errors="replace"))
        except Exception:
            return None
    if low.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
        media = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp",
        }[next(k for k in [".png", ".jpg", ".jpeg", ".gif", ".webp"] if low.endswith(k))]
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media,
                "data": base64.standard_b64encode(data).decode("ascii"),
            },
        }
    # Unknown — skip quietly rather than erroring on, e.g., a signature image.
    logger.info("lunch import: skipping unsupported attachment %s", filename)
    return None


@router.post("/import-email")
async def import_email(
    # Accept the new plural form ("email_files") and the legacy singular
    # ("email_file") so older callers keep working. FastAPI unpacks each
    # multipart field name independently.
    email_files: list[UploadFile] = File(default_factory=list),
    email_file: Optional[UploadFile] = File(default=None),
    body_text: Optional[str] = Form(default=None),
    attachments: list[UploadFile] = File(default_factory=list),
):
    """Parse one or more Outlook emails (.eml / .msg) plus any extra
    attachments and extract menu data. The client can also paste the body
    directly or upload attachments separately if they've already exported
    them from the email client. Every email's attachments (e.g. a PDF or
    XLSX calendar from a caterer) are read alongside the body text in a
    single Claude call, so a week of forwarded menus can be ingested in
    one shot.
    """

    MAX_BYTES = 25 * 1024 * 1024
    content_blocks: list[dict] = []
    combined_bodies: list[str] = []

    if body_text and body_text.strip():
        combined_bodies.append(body_text.strip())

    # Merge the new plural + legacy singular inputs so both calling shapes work.
    all_email_files: list[UploadFile] = list(email_files or [])
    if email_file is not None and getattr(email_file, "filename", None):
        all_email_files.append(email_file)

    for ef in all_email_files:
        if not ef.filename:
            continue
        raw = await ef.read()
        if len(raw) > MAX_BYTES:
            logger.warning("Skipping oversized email file %s", ef.filename)
            continue
        low = ef.filename.lower()
        if low.endswith(".eml"):
            body, atts = _parse_eml(raw)
        elif low.endswith(".msg"):
            body, atts = _parse_msg(raw)
        else:
            # Skip unsupported email files rather than failing the whole batch.
            logger.warning("Skipping non-email file in email_files slot: %s", ef.filename)
            continue
        if body.strip():
            combined_bodies.append(f"[From: {ef.filename}]\n{body.strip()}")
        for (fn, blob) in atts:
            if len(blob) > MAX_BYTES:
                logger.warning("Skipping oversized attachment %s", fn)
                continue
            block = _attachment_to_claude_block(fn, blob)
            if block:
                content_blocks.append(block)

    # Extra attachments uploaded alongside (e.g. the user already had the
    # menu PDF saved separately).
    for up in (attachments or []):
        if not up.filename:
            continue
        raw = await up.read()
        if len(raw) > MAX_BYTES:
            logger.warning("Skipping oversized attachment %s", up.filename)
            continue
        block = _attachment_to_claude_block(up.filename, raw)
        if block:
            content_blocks.append(block)

    if combined_bodies:
        content_blocks.insert(0, text_block(
            "=== Email body / pasted text ===\n\n" + "\n\n---\n\n".join(combined_bodies)
        ))

    if not content_blocks:
        raise HTTPException(400, "Nothing to read — paste the email body or attach at least one file.")

    # Tell Claude what we sent.
    content_blocks.append(text_block(
        "Extract menus per the schema. Combine information from the body text and every "
        "attachment. Multiple emails / attachments in this request may cover different "
        "weeks — emit ALL dated menus you find across the full payload. Return ONLY the "
        "JSON object."
    ))

    try:
        out = complete_json(
            system=EMAIL_LUNCH_SYSTEM,
            user_content=content_blocks,
            # 32k matches Opus's per-call output ceiling. A bundle of
            # several emails + caterer attachments routinely needs more
            # than 8k of JSON output (one day = ~70-100 tokens), so we
            # raise the ceiling rather than truncate mid-object.
            max_tokens=32000,
        )
    except ClaudeError as e:
        raise HTTPException(502, str(e))

    menus = out.get("menus") or []
    for m in menus:
        m["items"] = [i for i in (m.get("items") or []) if i and str(i).strip()]
    return {"menus": menus}


# Silence the unused-import lint while keeping the helpful import.
_ = pdf_block, Path
