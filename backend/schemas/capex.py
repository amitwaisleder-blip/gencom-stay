from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


CapexKind = Literal["single", "portfolio", "project"]
DocType = Literal["contract", "agreement", "proposal"]
MatchStatus = Literal["pending", "matched", "manual", "unmatched"]
LineStatus = Literal["approved", "in-progress", "completed", "pending", "bidding", "deferred"]


# ─── Lines ────────────────────────────────────────────────────────────────

class BreakdownItem(BaseModel):
    label: str
    description: Optional[str] = None
    vendor: Optional[str] = None
    qty: Optional[float] = None
    unit: Optional[str] = None
    unit_cost: Optional[float] = None
    total: float = 0.0
    notes: Optional[str] = None


class CapexLineBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: Optional[str] = None
    group: Optional[str] = None
    category: Optional[str] = None
    project_name: Optional[str] = None
    description: Optional[str] = None
    vendor: Optional[str] = None
    original_total_budget: float = 0.0
    forecast_total_budget: float = 0.0
    notes: Optional[str] = None
    sort_order: int = 0
    year_data: Optional[dict] = None
    cashflow: Optional[dict] = None
    breakdown: Optional[list[BreakdownItem]] = None
    status: Optional[LineStatus] = None


class CapexLineCreate(CapexLineBase):
    pass


class CapexLineUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: Optional[str] = None
    group: Optional[str] = None
    category: Optional[str] = None
    project_name: Optional[str] = None
    description: Optional[str] = None
    vendor: Optional[str] = None
    original_total_budget: Optional[float] = None
    forecast_total_budget: Optional[float] = None
    notes: Optional[str] = None
    sort_order: Optional[int] = None
    year_data: Optional[dict] = None
    cashflow: Optional[dict] = None
    breakdown: Optional[list[BreakdownItem]] = None
    status: Optional[LineStatus] = None


class BudgetExtractLine(BaseModel):
    code: Optional[str] = None
    group: Optional[str] = None
    category: Optional[str] = None
    project_name: Optional[str] = None
    description: Optional[str] = None
    vendor: Optional[str] = None
    original_total_budget: float = 0.0
    forecast_total_budget: float = 0.0
    year_data: Optional[dict] = None
    cashflow: Optional[dict] = None
    notes: Optional[str] = None
    breakdown: Optional[list[BreakdownItem]] = None


class BudgetExtractResult(BaseModel):
    lines: list[BudgetExtractLine]
    document_title: Optional[str] = None
    primary_vendor: Optional[str] = None
    notes: Optional[str] = None
    confidence: Optional[str] = None  # "high" | "medium" | "low"
    source_filename: Optional[str] = None
    line_count: int = 0
    # doc_kind: "proposal" (single contractor scope, sub-items rolled up into
    # breakdown), or "aggregated_budget" (owner-side schedule, one line per row).
    doc_kind: Optional[str] = None


class CapexLineRead(CapexLineBase):
    id: str
    hotel_id: str
    created_at: datetime
    updated_at: datetime


# ─── Hotels ───────────────────────────────────────────────────────────────

class CapexHotelBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    image_path: Optional[str] = None
    logo_path: Optional[str] = None
    sort_order: int = 0
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    keys: Optional[int] = None
    year_built: Optional[int] = None
    last_renovation: Optional[int] = None
    current_brand: Optional[str] = None
    current_flag: Optional[str] = None
    property_type: Optional[str] = None
    floors: Optional[int] = None
    notes: Optional[str] = None
    enrichment_confidence: Optional[str] = None


class CapexHotelCreate(CapexHotelBase):
    pass


class CapexHotelUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: Optional[str] = None
    image_path: Optional[str] = None
    logo_path: Optional[str] = None
    sort_order: Optional[int] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    keys: Optional[int] = None
    year_built: Optional[int] = None
    last_renovation: Optional[int] = None
    current_brand: Optional[str] = None
    current_flag: Optional[str] = None
    property_type: Optional[str] = None
    floors: Optional[int] = None
    notes: Optional[str] = None
    enrichment_confidence: Optional[str] = None


class CapexHotelRead(CapexHotelBase):
    id: str
    project_id: str
    line_count: int = 0
    forecast_total: float = 0.0
    spend_to_date: float = 0.0
    created_at: datetime
    updated_at: datetime


class HotelLookupRequest(BaseModel):
    name: str
    city_hint: Optional[str] = None


class HotelLookupResponse(BaseModel):
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    keys: Optional[int] = None
    year_built: Optional[int] = None
    last_renovation: Optional[int] = None
    current_brand: Optional[str] = None
    current_flag: Optional[str] = None
    property_type: Optional[str] = None
    floors: Optional[int] = None
    notes: Optional[str] = None
    confidence: Optional[str] = None  # "high" | "medium" | "low"


# ─── Projects ─────────────────────────────────────────────────────────────

class CapexProjectBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: CapexKind
    name: str
    image_path: Optional[str] = None
    parent_hotel_name: Optional[str] = None
    year_start: int
    year_end: int
    # 1..12 when set; None means "no specific month" (default).
    month_start: Optional[int] = None
    month_end: Optional[int] = None


class CapexProjectCreate(CapexProjectBase):
    # Optional: hotels to create alongside the project (Single / Portfolio /
    # Project all wind up creating one or more CapexHotel rows).
    hotels: list[CapexHotelCreate] = []


class CapexProjectUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: Optional[str] = None
    image_path: Optional[str] = None
    parent_hotel_name: Optional[str] = None
    year_start: Optional[int] = None
    year_end: Optional[int] = None
    month_start: Optional[int] = None
    month_end: Optional[int] = None
    archived: Optional[bool] = None


class CapexProjectRead(CapexProjectBase):
    id: str
    archived: bool
    created_at: datetime
    updated_at: datetime
    hotels: list[CapexHotelRead] = []


class CapexProjectCard(BaseModel):
    """Lightweight view for the home tile grid."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: CapexKind
    name: str
    image_path: Optional[str] = None
    parent_hotel_name: Optional[str] = None
    year_start: int
    year_end: int
    month_start: Optional[int] = None
    month_end: Optional[int] = None
    updated_at: datetime
    forecast_total: float = 0.0
    spend_to_date: float = 0.0
    remaining_current_year: float = 0.0


# ─── Invoices ─────────────────────────────────────────────────────────────

class InvoiceSplit(BaseModel):
    """One slice of an invoice attributed to a specific budget line. Shape
    matches the JSON stored on CapexInvoice.splits."""
    id: Optional[str] = None
    line_id: Optional[str] = None
    amount: float = 0.0
    applied_year: Optional[int] = None
    applied_month: Optional[int] = None
    label: Optional[str] = None
    description: Optional[str] = None
    code: Optional[str] = None  # any code from the invoice that maps to a line


class CapexInvoiceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    line_id: Optional[str] = None
    vendor: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    total_amount: float
    description: Optional[str] = None
    applied_year: Optional[int] = None
    applied_month: Optional[int] = None
    confidence: Optional[float] = None
    match_status: MatchStatus
    date_paid: Optional[str] = None
    payment_notes: Optional[str] = None
    splits: Optional[list[InvoiceSplit]] = None
    original_filename: Optional[str] = None
    file_path: str
    created_at: datetime
    updated_at: datetime


class CapexInvoiceUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    line_id: Optional[str] = None
    vendor: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    total_amount: Optional[float] = None
    description: Optional[str] = None
    applied_year: Optional[int] = None
    applied_month: Optional[int] = None
    match_status: Optional[MatchStatus] = None
    date_paid: Optional[str] = None
    payment_notes: Optional[str] = None
    splits: Optional[list[InvoiceSplit]] = None


class InvoiceMarkPaidRequest(BaseModel):
    date_paid: Optional[str] = None  # ISO YYYY-MM-DD; null to clear (mark unpaid)
    payment_notes: Optional[str] = None


class InvoiceParseLineMatch(BaseModel):
    """One ranked match candidate the AI suggests for an invoice."""
    line_id: str
    confidence: float  # 0..1
    reason: Optional[str] = None


class SuggestedSplit(BaseModel):
    """A Claude-suggested split for the upload review stage. Same fields as
    InvoiceSplit plus the line's match confidence so the UI can flag low-
    confidence assignments for review."""
    amount: float = 0.0
    label: Optional[str] = None
    description: Optional[str] = None
    code: Optional[str] = None
    suggested_line_id: Optional[str] = None
    confidence: Optional[float] = None
    reason: Optional[str] = None


class InvoiceParseResult(BaseModel):
    """What /upload-invoice returns. Saves the file and parsed metadata, leaves
    the user to confirm month + line in a follow-up call to /apply."""
    invoice_id: str  # the row created in capex_invoices, status="pending"
    vendor: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    total_amount: float = 0.0
    description: Optional[str] = None
    suggested_year: Optional[int] = None
    suggested_month: Optional[int] = None
    matches: list[InvoiceParseLineMatch] = []
    best_match: Optional[InvoiceParseLineMatch] = None
    suggested_splits: list[SuggestedSplit] = []
    threshold: float = 0.75
    above_threshold: bool = False
    source_filename: Optional[str] = None
    notes: Optional[str] = None


class InvoiceApplyRequest(BaseModel):
    # Either provide a single line_id (legacy single-line apply) OR provide
    # splits (one row per budget-line allocation). When splits is non-empty,
    # the legacy line_id/applied_year/applied_month/total_amount fields still
    # represent the invoice's primary/aggregate values for display.
    line_id: Optional[str] = None
    applied_year: Optional[int] = None
    applied_month: Optional[int] = None
    splits: Optional[list[InvoiceSplit]] = None
    # Optional user-edited overrides if the parsed metadata was wrong.
    vendor: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    total_amount: Optional[float] = None
    description: Optional[str] = None
    match_status: Optional[MatchStatus] = "matched"


# ─── Documents ────────────────────────────────────────────────────────────

class CapexDocumentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_id: str
    line_id: Optional[str] = None
    doc_type: DocType
    vendor: Optional[str] = None
    amount: Optional[float] = None
    updates_forecast: bool
    file_path: str
    original_filename: Optional[str] = None
    notes: Optional[str] = None
    created_at: datetime


class CapexDocumentUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    line_id: Optional[str] = None
    doc_type: Optional[DocType] = None
    vendor: Optional[str] = None
    amount: Optional[float] = None
    updates_forecast: Optional[bool] = None
    notes: Optional[str] = None


class DocumentParseResult(BaseModel):
    """Returned by the upload endpoint after Claude reads the file. The user
    confirms the doc_type + line + forecast handling in a follow-up apply call.
    The document row is already saved with line_id=null at this stage."""
    document_id: str
    suggested_doc_type: Optional[DocType] = None  # contract / agreement / proposal
    vendor: Optional[str] = None
    amount: Optional[float] = None
    document_date: Optional[str] = None  # ISO YYYY-MM-DD if parseable
    scope_summary: Optional[str] = None
    confidence: Optional[str] = None  # "high" | "medium" | "low"
    notes: Optional[str] = None
    source_filename: Optional[str] = None


ForecastAction = Literal["none", "update", "custom"]


class DocumentApplyRequest(BaseModel):
    """User confirms which line to attach to and how (or whether) to update the
    line's forecast budget. Mirrors the spec's three-way prompt."""
    line_id: str
    doc_type: DocType
    forecast_action: ForecastAction = "none"
    custom_amount: Optional[float] = None  # required when forecast_action == "custom"
    # Optional user overrides if Claude misread something.
    vendor: Optional[str] = None
    amount: Optional[float] = None
    notes: Optional[str] = None
