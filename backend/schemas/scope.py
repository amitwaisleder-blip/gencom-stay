from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ScopeItemBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    division: str
    sub_area: Optional[str] = None
    line_item: str
    description: Optional[str] = None
    quantity: float = 0
    unit: str = "each"
    suggested_unit_cost: Optional[float] = None
    override_unit_cost: Optional[float] = None
    source: str = "manual"
    source_document_id: Optional[str] = None
    source_page: Optional[int] = None
    source_excerpt: Optional[str] = None
    priority: str = "na"
    confidence: str = "medium"
    notes: Optional[str] = None
    included_in_budget: bool = True
    cost_db_item_id: Optional[str] = None
    multiplier_basis: Optional[str] = None  # "keys", "floors", or None


class ScopeItemCreate(ScopeItemBase):
    pass


class ScopeItemUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    division: Optional[str] = None
    sub_area: Optional[str] = None
    line_item: Optional[str] = None
    description: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    suggested_unit_cost: Optional[float] = None
    override_unit_cost: Optional[float] = None
    priority: Optional[str] = None
    confidence: Optional[str] = None
    notes: Optional[str] = None
    included_in_budget: Optional[bool] = None
    cost_db_item_id: Optional[str] = None
    multiplier_basis: Optional[str] = None


class ScopeItemRead(ScopeItemBase):
    id: str
    property_id: str
    effective_unit_cost: float
    effective_quantity: float
    line_total: float
    deleted: bool
    created_at: datetime
    updated_at: datetime
