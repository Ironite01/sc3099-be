"""
Audit Log model
"""
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True, index=True)

    action = Column(String(100), nullable=False, index=True)
    resource_type = Column(String(50), nullable=True, index=True)
    resource_id = Column(String(36), nullable=True, index=True)

    ip_address = Column(String(45), nullable=True, index=True)
    user_agent = Column(String(500), nullable=True)
    device_id = Column(String(36), nullable=True)

    details = Column(Text, nullable=True)  # JSON
    success = Column(Boolean, default=True)

    # Immutable timestamp (no updated_at!)
    timestamp = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
