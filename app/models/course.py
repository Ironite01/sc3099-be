"""
Course model
"""
from sqlalchemy import Column, String, Boolean, Float, DateTime, Text, ForeignKey
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class Course(Base):
    __tablename__ = "courses"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    code = Column(String(20), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    semester = Column(String(20), nullable=False, index=True)
    instructor_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)

    # Default venue settings
    venue_latitude = Column(Float, nullable=True)
    venue_longitude = Column(Float, nullable=True)
    venue_name = Column(String(255), nullable=True)
    geofence_radius_meters = Column(Float, default=100.0)

    # Security settings
    require_face_recognition = Column(Boolean, default=False)
    require_device_binding = Column(Boolean, default=True)
    risk_threshold = Column(Float, default=0.5)

    # Timestamps
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
