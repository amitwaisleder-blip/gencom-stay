"""
SQLAlchemy models for the 6 core entities: Property, Document, ScopeItem,
CostDatabaseItem, Scenario, Export. See spec Section 3.

Flat provenance columns (value_source, value_source_page, confidence, ai_extracted)
are used on the Property table rather than JSON blobs — simpler to query and
matches the recommendation in Appendix A.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, JSON, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


scenario_scope_items = Table(
    "scenario_scope_items",
    Base.metadata,
    Column("scenario_id", String, ForeignKey("scenarios.id", ondelete="CASCADE"), primary_key=True),
    Column("scope_item_id", String, ForeignKey("scope_items.id", ondelete="CASCADE"), primary_key=True),
)


class Property(Base):
    __tablename__ = "properties"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)

    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    current_brand: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    current_flag: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    target_brand: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    target_flag: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    target_brand_tier: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    property_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    year_built: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    year_last_renovated: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    keys: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    guestroom_mix: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    thumbnail_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    deal_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    floors: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    towers: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_gsf: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    envelope_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    roof_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    roof_age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    passenger_elevators: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    service_elevators: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    elevator_modernization_status: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    fb_outlets: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    meeting_space_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    pools_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    spa_treatment_rooms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fitness_sqft: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    parking_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    parking_spaces: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    mep_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    sprinklered: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    fire_alarm_age: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fl_recert_status: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    documents_available: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    matterport_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    walk_dates: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    walk_attendees: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)

    # Field-level provenance stored as JSON: {"keys": {"source":"om","source_page":3,
    # "source_excerpt":"...","confidence":"high","ai_extracted":true,"edited_by_user":false}}
    field_provenance: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    # When true (default), edits to any scenario's soft_cost_breakdown are
    # mirrored to every sibling scenario. Toggled on the Budget Summary page.
    soft_costs_synced: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")

    # Answers to the 50-question intake questionnaire. Shape:
    #   { "q1": {"value": "...", "see_pip": false}, "q2": {...}, ... }
    # Empty / missing entries mean the user skipped the question.
    intake_answers: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    documents = relationship("Document", back_populates="property", cascade="all, delete-orphan")
    scope_items = relationship("ScopeItem", back_populates="property", cascade="all, delete-orphan")
    scenarios = relationship("Scenario", back_populates="property", cascade="all, delete-orphan")
    exports = relationship("Export", back_populates="property", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    property_id: Mapped[str] = mapped_column(String, ForeignKey("properties.id", ondelete="CASCADE"))
    filename: Mapped[str] = mapped_column(String)
    file_path: Mapped[str] = mapped_column(String)
    document_type: Mapped[str] = mapped_column(String)  # pip, om, brochure, walk_notes, walk_photo, other
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    extraction_status: Mapped[str] = mapped_column(String, default="pending")  # pending, running, complete, failed
    extraction_ran_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    extraction_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    property = relationship("Property", back_populates="documents")


class ScopeItem(Base):
    __tablename__ = "scope_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    property_id: Mapped[str] = mapped_column(String, ForeignKey("properties.id", ondelete="CASCADE"))
    division: Mapped[str] = mapped_column(String)
    # Sub-category within a division — e.g. under COMMON AREA: "Lobby",
    # "Pre-function", "Meeting Rooms", "Valet". Nullable; when empty the item
    # renders in a "(unassigned)" sub-group.
    sub_area: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    line_item: Mapped[str] = mapped_column(String)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    quantity: Mapped[float] = mapped_column(Float, default=0)
    unit: Mapped[str] = mapped_column(String, default="each")  # each, sf, lf, rooms, floors, ls, allowance

    suggested_unit_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    override_unit_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    source: Mapped[str] = mapped_column(String, default="manual")  # pip, walk_notes, om, manual
    source_document_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("documents.id"), nullable=True)
    source_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_excerpt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    priority: Mapped[str] = mapped_column(String, default="na")  # required, recommended, optional, na
    confidence: Mapped[str] = mapped_column(String, default="medium")  # high, medium, low
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    included_in_budget: Mapped[bool] = mapped_column(Boolean, default=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)  # soft-delete for AI-extracted rows

    # When set, line_total is (quantity * unit_cost * basis_value) where
    # basis_value comes from the property. Values:
    #   "keys"              — total guestroom keys
    #   "floors"            — floors count
    #   "keys_pct"          — (keys / 100); quantity is interpreted as a percentage
    #   "doubles"           — count of double_queen + double_double rooms
    #   "suites"            — count of all suite types (junior/1br/2br/signature)
    #   "kings_only"        — count of king rooms only
    #   "double_double_only"— count of double_double rooms only
    #   "non_suite"         — count of standard (king + double_queen + double_double) rooms
    multiplier_basis: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    cost_db_item_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("cost_db_items.id"), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    property = relationship("Property", back_populates="scope_items")
    scenarios = relationship("Scenario", secondary=scenario_scope_items, back_populates="scope_items")

    def effective_unit_cost(self) -> float:
        if self.override_unit_cost is not None:
            return self.override_unit_cost
        return self.suggested_unit_cost or 0.0

    def _basis_value(self) -> float:
        if not self.multiplier_basis or not self.property:
            return 1.0
        prop = self.property
        if self.multiplier_basis == "keys":
            return float(prop.keys or 0)
        if self.multiplier_basis == "floors":
            return float(prop.floors or 0)
        if self.multiplier_basis == "keys_pct":
            return float(prop.keys or 0) / 100.0
        mix = prop.guestroom_mix or {}
        if self.multiplier_basis == "doubles":
            return float((mix.get("double_queen") or 0) + (mix.get("double_double") or 0))
        if self.multiplier_basis == "suites":
            return float(
                (mix.get("junior_suite") or 0)
                + (mix.get("suite_1br") or 0)
                + (mix.get("suite_2br") or 0)
                + (mix.get("signature_suite") or 0)
            )
        if self.multiplier_basis == "kings_only":
            return float(mix.get("king") or 0)
        if self.multiplier_basis == "double_double_only":
            return float(mix.get("double_double") or 0)
        if self.multiplier_basis == "non_suite":
            return float(
                (mix.get("king") or 0)
                + (mix.get("double_queen") or 0)
                + (mix.get("double_double") or 0)
            )
        return 1.0

    def effective_quantity(self) -> float:
        return (self.quantity or 0) * self._basis_value()

    def line_total(self) -> float:
        return self.effective_quantity() * self.effective_unit_cost()


class CostDatabaseItem(Base):
    __tablename__ = "cost_db_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    item_name: Mapped[str] = mapped_column(String, index=True)
    unit: Mapped[str] = mapped_column(String)
    brand_tier: Mapped[str] = mapped_column(String, index=True)  # luxury, upper_upscale, upscale
    suggested_cost: Mapped[float] = mapped_column(Float)

    historical_range_low: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    historical_range_high: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_used_property_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("properties.id"), nullable=True)

    source: Mapped[str] = mapped_column(String, default="user_seeded")  # actual_project, benchmark, ai_estimate, user_seeded
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    region: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # v2; ignored in v1 matching

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class CostHistory(Base):
    __tablename__ = "cost_history"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    cost_db_item_id: Mapped[str] = mapped_column(String, ForeignKey("cost_db_items.id", ondelete="CASCADE"))
    value: Mapped[float] = mapped_column(Float)
    property_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("properties.id"), nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=_now)


class Scenario(Base):
    __tablename__ = "scenarios"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    property_id: Mapped[str] = mapped_column(String, ForeignKey("properties.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)

    soft_cost_pct: Mapped[float] = mapped_column(Float, default=0.15)
    # Optional granular breakdown of soft costs as list[{name, pct}]. When set,
    # soft_cost_pct is recomputed as sum(breakdown).
    soft_cost_breakdown: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    contingency_pct: Mapped[float] = mapped_column(Float, default=0.10)
    escalation_pct: Mapped[float] = mapped_column(Float, default=0.05)
    ffe_pct: Mapped[float] = mapped_column(Float, default=0.0)
    ose_pct: Mapped[float] = mapped_column(Float, default=0.0)
    tech_pct: Mapped[float] = mapped_column(Float, default=0.0)
    other_line_items: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)

    # Filter spec for auto-populating scope membership: e.g. {"priority_in": ["required"]}
    auto_filter: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    property = relationship("Property", back_populates="scenarios")
    scope_items = relationship("ScopeItem", secondary=scenario_scope_items, back_populates="scenarios")


class Export(Base):
    __tablename__ = "exports"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    property_id: Mapped[str] = mapped_column(String, ForeignKey("properties.id", ondelete="CASCADE"))
    exported_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    filename: Mapped[str] = mapped_column(String)
    file_path: Mapped[str] = mapped_column(String)
    scenarios_included: Mapped[list] = mapped_column(JSON)
    note: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    property = relationship("Property", back_populates="exports")


class DmCostItem(Base):
    """Deferred-maintenance unit costs, harvested from proposals, budgets,
    and estimates uploaded by the user. Independent of the main cost DB —
    this table stores real line items from specific past projects (contractor,
    date, city, hotel), so the user can reference comparable scope/cost later."""
    __tablename__ = "dm_cost_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    # Scope & classification
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    subcategory: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    scope: Mapped[str] = mapped_column(Text)  # description of the work
    unit: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Cost — either unit cost (with qty) or lump-sum total; store both when known.
    cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    unit_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Context
    contractor: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    estimate_date: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # ISO date string
    year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    hotel_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Provenance — the file this row was extracted from, so the user can
    # verify the source later.
    source_filename: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_file_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    source_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_excerpt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ai_extracted: Mapped[bool] = mapped_column(Boolean, default=False)



class AirKarimTrip(Base):
    """Mirror of a single AirKarim trip stored server-side so Outlook can
    subscribe to a stable ICS URL and pick up changes automatically. The
    trip shape is the full client-side Trip JSON — we don't normalize it
    into columns because it's only read as a whole for ICS generation."""

    __tablename__ = "airkarim_trips"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    # Monotonically increasing counter, written to ICS SEQUENCE so Outlook
    # knows to supersede prior events with the same UID.
    sequence: Mapped[int] = mapped_column(Integer, default=0)


class AirKarimFile(Base):
    """Uploaded document attached to an AirKarim trip — boarding passes,
    hotel confirmations, meeting decks, etc. Files live on disk under
    data/uploads/airkarim/<trip_id>/, this row holds metadata."""

    __tablename__ = "airkarim_files"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    trip_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Which editor tab this file belongs to. Free-form string so we can
    # extend ("flights" | "lodging" | "meetings" | "dining" | "ground" | "other").
    section: Mapped[str] = mapped_column(String, default="other")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class GencomStayProperty(Base):
    """Server-side copy of a Gencom Stay portfolio property. The `data` JSON
    mirrors the frontend `Property` type — we don't normalize into columns
    because rate tables / blackout ranges / notes are only read as a whole."""

    __tablename__ = "gencom_stay_properties"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class GencomStayImage(Base):
    """Hero image uploaded for a portfolio property. Files live under
    data/uploads/gencom-stay/<property_id>/."""

    __tablename__ = "gencom_stay_images"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    property_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    content_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class GenCalEvent(Base):
    """A single calendar event in GenCal (the company-wide calendar).
    Covers every category: holidays (locked seed), parties, board meetings,
    property milestones, birthdays/anniversaries (auto-generated), and
    general events. Category-specific fields live in the JSON `extras`
    column so the schema can evolve without migrations."""

    __tablename__ = "gen_cal_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    title: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, nullable=False, index=True)
    start_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    location: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # HSHR holidays and system-generated events are locked from editing.
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    # Per-category extension data (dress code, property name, dietary toggle,
    # RSVP config, etc). Keeps future categories schema-clean.
    extras: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class GenCalEmployee(Base):
    """Lightweight employee directory for GenCal birthday + work-anniversary
    auto-events. Not auth — just a calendar data source."""

    __tablename__ = "gen_cal_employees"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    department: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Stored as ISO date strings (YYYY-MM-DD) so leap-day math is trivial.
    birthday: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    hire_date: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


class LunchMenu(Base):
    """A single day's lunch menu. `items` is a flat list of dish names the
    day was served — we normalize to dish strings so metrics / favorites can
    roll up simply. Source tracks how the row was created so an ops user
    can tell a manually-entered menu from an uploaded one."""

    __tablename__ = "lunch_menus"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    # YYYY-MM-DD string — trivially sortable, easy to uniquely key per day.
    date: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    # List[str] of dish names. Stored as JSON so metrics can sum frequencies
    # without parsing CSV on every request.
    items: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    source: Mapped[str] = mapped_column(String, default="manual")  # manual | excel | pdf
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class LunchFavorite(Base):
    """Per-user favorite marker for a specific lunch item. User is keyed by
    email until real SSO is wired."""

    __tablename__ = "lunch_favorites"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    user_email: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # Lower-cased normalized item name so "Grilled Chicken" and
    # "grilled chicken" are the same favorite.
    item_key: Mapped[str] = mapped_column(String, nullable=False, index=True)
    # 1..10 personal preference rank. Lower number = higher in the user's
    # top-10 list. Nullable for legacy rows; toggle endpoint backfills.
    rank: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)


# ─── Capex Tracker ─────────────────────────────────────────────────────────
# Single Hotel / Portfolio / Project — unified data model. A "project" here is
# the top-level Capex Tracker entity, not the Budget Generator's Property. A
# Single Hotel is just a CapexProject(kind="single") with one CapexHotel row.
# A Portfolio has many. A Project (capital P, the discrete-scope kind) has one
# CapexHotel attached to a parent_hotel_name string.

class CapexProject(Base):
    __tablename__ = "capex_projects"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String, nullable=False)  # "single" | "portfolio" | "project"
    name: Mapped[str] = mapped_column(String, nullable=False)
    image_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # For kind="project" only — name of the parent hotel the discrete project belongs to.
    parent_hotel_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    year_start: Mapped[int] = mapped_column(Integer, nullable=False)
    year_end: Mapped[int] = mapped_column(Integer, nullable=False)
    # Optional month granularity. 1..12. NULL means "no specific month set"
    # — UI falls back to using just the year. Added after initial schema so
    # both columns are nullable and the migration is purely additive.
    month_start: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    month_end: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)

    hotels = relationship("CapexHotel", back_populates="project", cascade="all, delete-orphan")
    invoices = relationship("CapexInvoice", back_populates="project", cascade="all, delete-orphan")
    documents = relationship("CapexDocument", back_populates="project", cascade="all, delete-orphan")


class CapexHotel(Base):
    __tablename__ = "capex_hotels"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String, ForeignKey("capex_projects.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String, nullable=False)
    image_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    # Brand / chain logo (separate from image_path which is the property photo).
    logo_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # Property details — populated via AI-fill on the wizard or manual edit.
    address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    keys: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    year_built: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_renovation: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    current_brand: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    current_flag: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    property_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    floors: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Confidence string from the AI-fill lookup ("high" | "medium" | "low") so
    # the UI can flag low-confidence rows for the user to verify.
    enrichment_confidence: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    project = relationship("CapexProject", back_populates="hotels")
    lines = relationship("CapexLine", back_populates="hotel", cascade="all, delete-orphan")


class CapexLine(Base):
    __tablename__ = "capex_lines"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    hotel_id: Mapped[str] = mapped_column(String, ForeignKey("capex_hotels.id", ondelete="CASCADE"))
    code: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    group: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    project_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    vendor: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    original_total_budget: Mapped[float] = mapped_column(Float, default=0.0)
    forecast_total_budget: Mapped[float] = mapped_column(Float, default=0.0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Per-year forecast/spend snapshot. Shape: { "2025": {"forecast": 0, "spend": 0}, ... }
    # spend is a denormalized cache rebuilt from invoices on apply.
    year_data: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # Monthly cashflow per year — shape: { "2025": { "1": 0, "2": 5000, ..., "12": 0 }, ... }
    # Each value is the dollar spend recorded for that month. When present this
    # is the source of truth for line spend; the year totals on year_data are
    # treated as a fallback (older lines with no monthly granularity).
    cashflow: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # Cost breakdown for proposal-style sources: a contractor's proposal that
    # itemizes machine room work, controllers, cab refurb, etc. all rolls up
    # into one budget line, with the sub-items kept here for drill-down.
    # Shape: [{ "label": str, "description": str?, "vendor": str?,
    #           "qty": float?, "unit": str?, "unit_cost": float?,
    #           "total": float, "notes": str? }, ...]
    breakdown: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    # Workflow status for the line: approved | in-progress | completed |
    # pending | bidding | deferred. Nullable — existing lines default to no
    # explicit status.
    status: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    hotel = relationship("CapexHotel", back_populates="lines")


class CapexInvoice(Base):
    __tablename__ = "capex_invoices"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String, ForeignKey("capex_projects.id", ondelete="CASCADE"))
    line_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("capex_lines.id", ondelete="SET NULL"), nullable=True)
    vendor: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    invoice_number: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    invoice_date: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # ISO date as string for simplicity
    total_amount: Mapped[float] = mapped_column(Float, default=0.0)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    applied_year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    applied_month: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # 1-12
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)  # 0..1 from Claude
    match_status: Mapped[str] = mapped_column(String, default="pending")  # pending, matched, manual, unmatched
    # Payment status — when date_paid is set, the invoice is "Paid"; otherwise
    # "Unpaid". Mirrors the IF formula in the Gencom Invoice Template.
    date_paid: Mapped[Optional[str]] = mapped_column(String, nullable=True)  # ISO date as string for simplicity
    payment_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    original_filename: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    parsed_json: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    # Multi-line splits — when the same vendor's invoice covers work across
    # multiple budget lines (e.g. structural + MEP), splits attribute portions
    # of the total to different lines/months. Shape:
    #   [{ id, line_id, amount, applied_year, applied_month, label, description, code }]
    # When splits is non-empty, the invoice's spend rolls up per-split rather
    # than via the legacy line_id/applied_year/applied_month/total_amount path.
    splits: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    project = relationship("CapexProject", back_populates="invoices")


class CapexDocument(Base):
    __tablename__ = "capex_documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(String, ForeignKey("capex_projects.id", ondelete="CASCADE"))
    line_id: Mapped[Optional[str]] = mapped_column(String, ForeignKey("capex_lines.id", ondelete="SET NULL"), nullable=True)
    doc_type: Mapped[str] = mapped_column(String, nullable=False)  # contract, agreement, proposal
    vendor: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    updates_forecast: Mapped[bool] = mapped_column(Boolean, default=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    original_filename: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    project = relationship("CapexProject", back_populates="documents")


class CapexFilenamePattern(Base):
    """User's actual chosen filename when they Save-As'd a parsed document.
    We log every save and feed the most recent ~10 of the same kind back to
    Claude as exemplars so the next suggestion follows the user's evolving
    naming convention (e.g. project-code-first vs property-first vs
    vendor-first). Storing only the final string + a JSON snapshot of the
    parse metadata keeps this independent of any specific kind's schema."""

    __tablename__ = "capex_filename_patterns"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    # invoice | contract | budget
    kind: Mapped[str] = mapped_column(String, index=True, nullable=False)
    chosen_filename: Mapped[str] = mapped_column(String, nullable=False)
    parsed_metadata: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
