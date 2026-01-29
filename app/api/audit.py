"""
Audit log API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session as DBSession
from typing import Optional
from datetime import datetime
import json

from app.core.database import get_db
from app.core.deps import get_admin_user
from app.schemas.audit import AuditLogResponse
from app.schemas.common import PaginatedResponse
from app.models.audit_log import AuditLog
from app.models.user import User

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("/", response_model=PaginatedResponse[AuditLogResponse])
def get_audit_logs(
    user_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    resource_id: Optional[str] = Query(None),
    success: Optional[bool] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_admin_user),
    db: DBSession = Depends(get_db)
):
    """Get audit logs with comprehensive filtering. Admin only."""
    query = db.query(AuditLog)

    # Apply filters
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if action:
        query = query.filter(AuditLog.action == action)
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    if resource_id:
        query = query.filter(AuditLog.resource_id == resource_id)
    if success is not None:
        query = query.filter(AuditLog.success == success)
    if start_date:
        query = query.filter(AuditLog.timestamp >= start_date)
    if end_date:
        query = query.filter(AuditLog.timestamp <= end_date)

    # Get total count
    total = query.count()

    # Apply pagination and order
    audit_logs = query.order_by(AuditLog.timestamp.desc()).limit(limit).offset(offset).all()

    # Enrich with user emails
    audit_responses = []
    for log in audit_logs:
        user_email = None
        if log.user_id:
            user = db.query(User).filter(User.id == log.user_id).first()
            if user:
                user_email = user.email

        # Parse details if JSON string
        details = None
        if log.details:
            try:
                details = json.loads(log.details)
            except:
                details = {"raw": log.details}

        audit_responses.append(AuditLogResponse(
            id=log.id,
            user_id=log.user_id,
            user_email=user_email,
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            ip_address=log.ip_address,
            user_agent=log.user_agent,
            device_id=log.device_id,
            details=details,
            success=log.success,
            timestamp=log.timestamp
        ))

    return {
        "items": audit_responses,
        "total": total,
        "limit": limit,
        "offset": offset
    }
