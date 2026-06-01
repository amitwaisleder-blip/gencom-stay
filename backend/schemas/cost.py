from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class CostItemBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    item_name: str
    unit: str
    brand_tier: str
    suggested_cost: float
    historical_range_low: Optional[float] = None
    historical_range_high: Optional[float] = None
    source: str = "user_seeded"
    notes: Optional[str] = None
    archived: bool = False


class CostItemCreate(CostItemBase):
    pass


class CostItemUpdate(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    item_name: Optional[str] = None
    unit: Optional[str] = None
    brand_tier: Optional[str] = None
    suggested_cost: Optional[float] = None
    notes: Optional[str] = None
    archived: Optional[bool] = None


class CostItemRead(CostItemBase):
    id: str
    last_used_at: Optional[datetime] = None
    last_used_property_id: Optional[str] = None
    # Name of the property the cost last came from — shown on the Actual
    # Projects tab so users can see where the number originated.
    last_used_property_name: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CostMatchResult(BaseModel):
    """Result of cost matching for a scope item."""
    cost_db_item_id: Optional[str] = None
    suggested_cost: Optional[float] = None
    match_type: str  # exact, fuzzy, cross_tier, ai_fallback, none
    confidence: str  # high, medium, low
    matched_item_name: Optional[str] = None
    explanation: Optional[str] = None
