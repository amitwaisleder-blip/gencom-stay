from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ExportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    property_id: str
    exported_at: datetime
    filename: str
    file_path: str
    scenarios_included: list[str]
    note: Optional[str] = None


class ExportRequest(BaseModel):
    scenarios: list[str]
    note: Optional[str] = None
    filename: Optional[str] = None
