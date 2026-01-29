"""
Enrollment model
"""
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class Enrollment(Base):
    __tablename__ = "enrollments"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    student_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(String(36), ForeignKey("courses.id"), nullable=False, index=True)
    is_active = Column(Boolean, nullable=False, default=True)

    # Timestamps
    enrolled_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    dropped_at = Column(DateTime(timezone=True), nullable=True)

    # Unique constraint: one enrollment per student per course
    __table_args__ = (
        UniqueConstraint('student_id', 'course_id', name='uq_student_course'),
    )
