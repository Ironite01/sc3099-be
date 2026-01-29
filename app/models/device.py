"""
Device model
"""
from sqlalchemy import Column, String, Boolean, Integer, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
import uuid

from app.core.database import Base


class Device(Base):
    __tablename__ = "devices"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    device_fingerprint = Column(String(64), unique=True, nullable=False, index=True)
    device_name = Column(String(255), nullable=True)
    platform = Column(String(50), nullable=True)
    browser = Column(String(100), nullable=True)
    os_version = Column(String(50), nullable=True)
    app_version = Column(String(50), nullable=True)

    # Cryptographic binding
    public_key = Column(Text, nullable=False)
    public_key_created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    public_key_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Attestation
    attestation_passed = Column(Boolean, default=False)
    last_attestation_at = Column(DateTime(timezone=True), nullable=True)
    attestation_token = Column(Text, nullable=True)

    # Trust
    is_trusted = Column(Boolean, default=False, index=True)
    trust_score = Column(String(20), default="low")
    is_emulator = Column(Boolean, default=False)
    is_rooted_jailbroken = Column(Boolean, default=False)

    # Usage
    first_seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    total_checkins = Column(Integer, default=0)

    # Status
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revocation_reason = Column(Text, nullable=True)
