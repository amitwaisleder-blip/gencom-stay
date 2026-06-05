from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict


class PropertyBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    current_brand: Optional[str] = None
    current_flag: Optional[str] = None
    target_brand: Optional[str] = None
    target_flag: Optional[str] = None
    target_brand_tier: Optional[str] = None
    property_type: Optional[str] = None
    year_built: Optional[int] = None
    year_last_renovated: Optional[int] = None
    keys: Optional[int] = None
    guestroom_mix: Optional[dict] = None
    thumbnail_path: Optional[str] = None
    deal_notes: Optional[str] = None

    floors: Optional[int] = None
    towers: Optional[int] = None
    total_gsf: Optional[int] = None
    envelope_notes: Optional[str] = None
    roof_type: Optional[str] = None
    roof_age: Optional[int] = None
    passenger_elevators: Optional[int] = None
    service_elevators: Optional[int] = None
    elevator_modernization_status: Optional[str] = None

    fb_outlets: Optional[list] = None
    meeting_space_json: Optional[dict] = None
    pools_json: Optional[dict] = None
    spa_treatment_rooms: Optional[int] = None
    fitness_sqft: Optional[int] = None
    parking_type: Optional[str] = None
    parking_spaces: Optional[int] = None

    mep_json: Optional[dict] = None
    sprinklered: Optional[bool] = None
    fire_alarm_age: Optional[int] = None
    fl_recert_status: Optional[str] = None

    documents_available: Optional[dict] = None
    matterport_url: Optional[str] = None
    walk_dates: Optional[list] = None
    walk_attendees: Optional[list] = None

    field_provenance: Optional[dict] = None
    soft_costs_synced: Optional[bool] = True
    intake_answers: Optional[dict] = None


class PropertyCreate(PropertyBase):
    pass


class PropertyUpdate(PropertyBase):
    archived: Optional[bool] = None


class PropertyRead(PropertyBase):
    id: str
    created_at: datetime
    updated_at: datetime
    archived: bool


class PropertyCardRead(BaseModel):
    """Slim shape for Dashboard grid."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: Optional[str]
    current_brand: Optional[str]
    current_flag: Optional[str]
    target_brand: Optional[str]
    target_flag: Optional[str]
    address: Optional[str] = None
    city: Optional[str]
    state: Optional[str]
    keys: Optional[int]
    year_built: Optional[int] = None
    thumbnail_path: Optional[str]
    updated_at: datetime
    archived: bool
    default_scenario_total: float = 0.0
    dollars_per_key: float = 0.0
    # The three Summary-page subtotals — so the Dashboard card can show the
    # same breakdown the Summary shows. hard = base (all scope items),
    # soft = soft_costs + contingency + escalation + ffe + ose + tech + dev_fee,
    # grand = hard + soft. All three match Summary exactly.
    hard_total: float = 0.0
    soft_total: float = 0.0
    grand_total: float = 0.0
    # Grand totals for each of the three default scenarios. These are what the
    # Summary page shows side-by-side at the top.
    required_total: float = 0.0
    required_recommended_total: float = 0.0
    full_scope_total: float = 0.0
    setup_complete: bool = False
