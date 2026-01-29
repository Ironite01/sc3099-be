"""
Check-in schemas
"""
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime


class CheckInCreateRequest(BaseModel):
    session_id: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_accuracy_meters: Optional[float] = None
    device_fingerprint: Optional[str] = None
    liveness_challenge_response: Optional[str] = None
    qr_code: Optional[str] = None


class CheckInAppealRequest(BaseModel):
    appeal_reason: str


class CheckInReviewRequest(BaseModel):
    status: str
    review_notes: Optional[str] = None


class RiskFactorResponse(BaseModel):
    type: str
    severity: Optional[str] = None
    weight: float


class CheckInResponse(BaseModel):
    id: str
    session_id: str
    session_name: Optional[str] = None
    course_code: Optional[str] = None
    student_id: str
    student_name: Optional[str] = None
    student_email: Optional[str] = None
    device_id: Optional[str] = None
    status: str
    checked_in_at: datetime
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_accuracy_meters: Optional[float] = None
    distance_from_venue_meters: Optional[float] = None
    liveness_passed: Optional[bool] = None
    liveness_score: Optional[float] = None
    liveness_challenge_type: Optional[str] = None
    face_match_passed: Optional[bool] = None
    face_match_score: Optional[float] = None
    risk_score: float
    risk_factors: Optional[List[Dict[str, Any]]] = None
    qr_code_verified: bool = False
    device_trusted: Optional[bool] = None
    appeal_reason: Optional[str] = None
    appealed_at: Optional[datetime] = None
    reviewed_by_id: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_notes: Optional[str] = None

    class Config:
        from_attributes = True


class CheckInListResponse(BaseModel):
    id: str
    session_id: str
    session_name: Optional[str] = None
    student_id: str
    student_name: Optional[str] = None
    student_email: Optional[str] = None
    status: str
    checked_in_at: datetime
    distance_from_venue_meters: Optional[float] = None
    risk_score: float
    liveness_passed: Optional[bool] = None

    class Config:
        from_attributes = True


class MyCheckInResponse(BaseModel):
    id: str
    session_id: str
    session_name: str
    course_code: str
    status: str
    checked_in_at: datetime
    risk_score: float

    class Config:
        from_attributes = True
