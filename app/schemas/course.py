"""
Course schemas
"""
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class CourseCreateRequest(BaseModel):
    code: str
    name: str
    semester: str
    instructor_id: str
    description: Optional[str] = None
    venue_name: Optional[str] = None
    venue_latitude: Optional[float] = None
    venue_longitude: Optional[float] = None
    geofence_radius_meters: float = 100.0
    risk_threshold: float = 0.5


class CourseUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    venue_name: Optional[str] = None
    venue_latitude: Optional[float] = None
    venue_longitude: Optional[float] = None
    geofence_radius_meters: Optional[float] = None
    risk_threshold: Optional[float] = None
    is_active: Optional[bool] = None


class CourseResponse(BaseModel):
    id: str
    code: str
    name: str
    semester: str
    description: Optional[str] = None
    instructor_id: Optional[str] = None
    instructor_name: Optional[str] = None
    venue_name: Optional[str] = None
    venue_latitude: Optional[float] = None
    venue_longitude: Optional[float] = None
    geofence_radius_meters: float
    risk_threshold: float
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
