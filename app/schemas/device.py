"""
Device schemas
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class DeviceRegisterRequest(BaseModel):
    device_fingerprint: str
    device_name: Optional[str] = None
    platform: Optional[str] = None
    public_key: str


class DeviceUpdateRequest(BaseModel):
    device_name: Optional[str] = None
    is_trusted: Optional[bool] = None
    is_active: Optional[bool] = None


class DeviceResponse(BaseModel):
    id: str
    device_fingerprint: str
    device_name: Optional[str] = None
    platform: Optional[str] = None
    is_trusted: bool
    trust_score: str
    is_active: bool
    first_seen_at: datetime
    last_seen_at: Optional[datetime] = None
    total_checkins: int = 0

    class Config:
        from_attributes = True
