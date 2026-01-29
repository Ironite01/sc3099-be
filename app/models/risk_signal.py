"""
Risk Signal model
"""
from sqlalchemy import Column, String, Float, DateTime, ForeignKey, Text, Enum as SQLEnum
from sqlalchemy.sql import func
import uuid
import enum

from app.core.database import Base


class SignalType(str, enum.Enum):
    # Geo
    geo_out_of_bounds = "geo_out_of_bounds"
    impossible_travel = "impossible_travel"
    geo_accuracy_low = "geo_accuracy_low"

    # Network
    vpn_detected = "vpn_detected"
    proxy_detected = "proxy_detected"
    tor_detected = "tor_detected"
    suspicious_ip = "suspicious_ip"

    # Device
    device_unknown = "device_unknown"
    device_emulator = "device_emulator"
    device_rooted = "device_rooted"
    attestation_failed = "attestation_failed"

    # Behavioral
    rapid_succession = "rapid_succession"
    unusual_time = "unusual_time"
    pattern_anomaly = "pattern_anomaly"

    # Liveness
    liveness_failed = "liveness_failed"
    liveness_low_confidence = "liveness_low_confidence"
    deepfake_suspected = "deepfake_suspected"
    replay_suspected = "replay_suspected"

    # Face
    face_match_failed = "face_match_failed"
    face_match_low_confidence = "face_match_low_confidence"


class SignalSeverity(str, enum.Enum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class RiskSignal(Base):
    __tablename__ = "risk_signals"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    checkin_id = Column(String(36), ForeignKey("checkins.id"), nullable=False, index=True)

    signal_type = Column(SQLEnum(SignalType), nullable=False, index=True)
    severity = Column(SQLEnum(SignalSeverity), nullable=False, index=True)
    confidence = Column(Float, nullable=False, default=1.0)
    details = Column(Text, nullable=True)  # JSON
    weight = Column(Float, nullable=False, default=0.1)

    detected_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
