from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class SoftCostLine(BaseModel):
    name: str
    pct: Optional[float] = None       # percentage of base
    fixed: Optional[float] = None     # OR a fixed dollar amount
    # Which group this line belongs to — drives computation order and UI placement.
    group: Optional[str] = "soft"     # "soft" | "contingency" | "dev_fee"

    # Basis configuration — how this line's base is built:
    # If basis_divisions is None AND basis_categories is None → all hard divisions.
    # If basis_divisions is a list → include only those hard divisions.
    # If basis_categories is a list → sum items whose line_item / keywords match
    #   any of these canonical scope categories (e.g. "Casegoods", "Softgoods",
    #   "Floor finishes", "Wallcover", "Window Cover").
    basis_divisions: Optional[list[str]] = None
    basis_categories: Optional[list[str]] = None
    # Exclude Deferred Maintenance from the default (all-divisions) basis.
    # Ignored when basis_divisions is an explicit list.
    basis_exclude_dm: Optional[bool] = True
    # Exclude IT / low-voltage + BOH scope items from the default basis. Useful
    # when contingency / dev fee should not apply to back-of-house or tech scope.
    basis_exclude_it_boh: Optional[bool] = False
    # Names of other soft/contingency lines whose amounts stack on top of this
    # line's base (used for Contingency + Developer fee compounding).
    basis_soft_lines: Optional[list[str]] = None

    # Deprecated — kept for backward compat. Maps to basis_exclude_dm=False.
    include_dm: Optional[bool] = None


class ScenarioBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    description: Optional[str] = None
    is_default: bool = False
    soft_cost_pct: float = 0.15
    soft_cost_breakdown: Optional[list[SoftCostLine]] = None
    contingency_pct: float = 0.10
    escalation_pct: float = 0.05
    ffe_pct: float = 0.0
    ose_pct: float = 0.0
    tech_pct: float = 0.0
    other_line_items: Optional[list] = None
    auto_filter: Optional[dict] = None


class ScenarioCreate(ScenarioBase):
    pass


class ScenarioUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: Optional[str] = None
    description: Optional[str] = None
    is_default: Optional[bool] = None
    soft_cost_pct: Optional[float] = None
    soft_cost_breakdown: Optional[list[SoftCostLine]] = None
    contingency_pct: Optional[float] = None
    escalation_pct: Optional[float] = None
    ffe_pct: Optional[float] = None
    ose_pct: Optional[float] = None
    tech_pct: Optional[float] = None
    other_line_items: Optional[list] = None
    auto_filter: Optional[dict] = None


class ScenarioRead(ScenarioBase):
    id: str
    property_id: str
    created_at: datetime


class ScenarioTotals(BaseModel):
    """Computed totals for a scenario, grouped by division."""
    scenario_id: str
    scenario_name: str
    division_subtotals: dict[str, float]
    base_total: float
    soft_costs: float
    contingency: float
    dev_fee: float = 0.0
    escalation: float
    ffe: float
    ose: float
    tech: float
    grand_total: float
    dollars_per_key: float
    dollars_per_gsf: float
    priority_breakdown: dict[str, float]
    # Per-line computed amounts keyed by name, for UI display.
    soft_cost_line_amounts: dict[str, float] = {}


class ScenarioScopeUpdate(BaseModel):
    """Add/remove scope items from a scenario."""
    add_ids: list[str] = []
    remove_ids: list[str] = []
