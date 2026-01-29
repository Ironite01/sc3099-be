"""
Session schemas
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class SessionCreateRequest(BaseModel):
    course_id: str
    name: str
    session_type: str = "lecture"
    description: Optional[str] = None
    scheduled_start: datetime
    scheduled_end: datetime
    checkin_opens_at: Optional[datetime] = None
    checkin_closes_at: Optional[datetime] = None
    venue_latitude: Optional[float] = None
    venue_longitude: Optional[float] = None
    venue_name: Optional[str] = None
    geofence_radius_meters: Optional[float] = None
    require_liveness_check: bool = True
    require_face_match: bool = False
    risk_threshold: Optional[float] = None


class SessionUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    checkin_opens_at: Optional[datetime] = None
    checkin_closes_at: Optional[datetime] = None
    venue_latitude: Optional[float] = None
    venue_longitude: Optional[float] = None
    venue_name: Optional[str] = None
    geofence_radius_meters: Optional[float] = None
    require_liveness_check: Optional[bool] = None
    require_face_match: Optional[bool] = None
    risk_threshold: Optional[float] = None


class SessionResponse(BaseModel):
    id: str
    course_id: str
    course_code: Optional[str] = None
    course_name: Optional[str] = None
    instructor_id: Optional[str] = None
    name: str
    session_type: str
    description: Optional[str] = None
    status: str
    scheduled_start: datetime
    scheduled_end: datetime
    checkin_opens_at: datetime
    checkin_closes_at: datetime
    venue_latitude: Optional[float] = None
    venue_longitude: Optional[float] = None
    venue_name: Optional[str] = None
    geofence_radius_meters: Optional[float] = None
    require_liveness_check: bool
    require_face_match: bool
    risk_threshold: Optional[float] = None
    total_enrolled: Optional[int] = None
    checked_in_count: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class SessionListResponse(BaseModel):
    id: str
    course_id: str
    course_code: Optional[str] = None
    course_name: Optional[str] = None
    instructor_id: Optional[str] = None
    name: str
    session_type: str
    status: str
    scheduled_start: datetime
    scheduled_end: datetime
    checkin_opens_at: datetime
    checkin_closes_at: datetime
    venue_name: Optional[str] = None
    total_enrolled: Optional[int] = None
    checked_in_count: Optional[int] = None

    class Config:
        from_attributes = True
