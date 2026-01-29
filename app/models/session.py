"""
Session model
"""
from sqlalchemy import Column, String, Boolean, Float, DateTime, ForeignKey, Text, Enum as SQLEnum
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class SessionStatus(str, enum.Enum):
    scheduled = "scheduled"
    active = "active"
    closed = "closed"
    cancelled = "cancelled"


class SessionType(str, enum.Enum):
    lecture = "lecture"
    tutorial = "tutorial"
    lab = "lab"
    exam = "exam"


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    course_id = Column(String(36), ForeignKey("courses.id"), nullable=False, index=True)
    instructor_id = Column(String(36), ForeignKey("users.id"), nullable=True)

    name = Column(String(255), nullable=False)
    session_type = Column(String(50), default="lecture")
    description = Column(Text, nullable=True)

    # Scheduling
    scheduled_start = Column(DateTime(timezone=True), nullable=False, index=True)
    scheduled_end = Column(DateTime(timezone=True), nullable=False)
    checkin_opens_at = Column(DateTime(timezone=True), nullable=False, index=True)
    checkin_closes_at = Column(DateTime(timezone=True), nullable=False, index=True)

    status = Column(SQLEnum(SessionStatus), nullable=False, default=SessionStatus.scheduled, index=True)
    actual_start = Column(DateTime(timezone=True), nullable=True)
    actual_end = Column(DateTime(timezone=True), nullable=True)

    # Venue (can override course defaults)
    venue_latitude = Column(Float, nullable=True)
    venue_longitude = Column(Float, nullable=True)
    venue_name = Column(String(255), nullable=True)
    geofence_radius_meters = Column(Float, nullable=True)

    # Security settings
    require_liveness_check = Column(Boolean, default=True)
    require_face_match = Column(Boolean, default=False)
    risk_threshold = Column(Float, nullable=True)

    # QR code
    qr_code_secret = Column(String(64), nullable=True)
    qr_code_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
