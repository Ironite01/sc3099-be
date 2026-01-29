"""
Device management API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.exc import IntegrityError
from typing import List

from app.core.database import get_db
from app.core.deps import get_current_user, get_admin_user
from app.schemas.device import DeviceRegisterRequest, DeviceUpdateRequest, DeviceResponse
from app.models.device import Device
from app.models.user import User

router = APIRouter(prefix="/devices", tags=["devices"])


@router.post("/register", response_model=DeviceResponse, status_code=status.HTTP_201_CREATED)
def register_device(
    request: DeviceRegisterRequest,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Register a new device."""
    # Check if device fingerprint already exists
    existing_device = db.query(Device).filter(
        Device.device_fingerprint == request.device_fingerprint
    ).first()

    if existing_device:
        # Update last_seen_at
        existing_device.last_seen_at = db.func.now()
        db.commit()
        db.refresh(existing_device)
        return existing_device

    # Create new device
    device = Device(
        user_id=current_user.id,
        device_fingerprint=request.device_fingerprint,
        device_name=request.device_name,
        platform=request.platform,
        public_key=request.public_key,
        is_trusted=False,
        trust_score="low",
        is_active=True
    )

    try:
        db.add(device)
        db.commit()
        db.refresh(device)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Device fingerprint already exists"
        )

    return device


@router.get("/my-devices", response_model=List[DeviceResponse])
def get_my_devices(
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """List current user's registered devices."""
    devices = db.query(Device).filter(
        Device.user_id == current_user.id
    ).order_by(Device.last_seen_at.desc()).all()

    return devices


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(
    device_id: str,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Remove a device. Owner or admin."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found"
        )

    # Check permissions
    if current_user.role != "admin" and device.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )

    db.delete(device)
    db.commit()


@router.patch("/{device_id}", response_model=DeviceResponse)
def update_device(
    device_id: str,
    request: DeviceUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Update device properties. Owner for name, admin for trust."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found"
        )

    # Check permissions
    is_owner = device.user_id == current_user.id
    is_admin = current_user.role == "admin"

    if not is_owner and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )

    # Update fields based on permissions
    if request.device_name is not None and is_owner:
        device.device_name = request.device_name

    if request.is_trusted is not None and is_admin:
        device.is_trusted = request.is_trusted
        # Update trust score based on is_trusted
        if request.is_trusted:
            device.trust_score = "high"
        else:
            device.trust_score = "low"

    if request.is_active is not None:
        if is_owner or is_admin:
            device.is_active = request.is_active

    db.commit()
    db.refresh(device)

    return device
