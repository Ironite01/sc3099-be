"""
Check-in API endpoints with risk assessment integration
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.exc import IntegrityError
from typing import Optional, List
from datetime import datetime, timedelta
import httpx
import json
import math

from app.core.database import get_db
from app.core.deps import get_current_user, get_instructor_user
from app.core.config import settings
from app.schemas.checkin import (
    CheckInCreateRequest,
    CheckInAppealRequest,
    CheckInReviewRequest,
    CheckInResponse,
    CheckInListResponse,
    MyCheckInResponse
)
from app.schemas.common import PaginatedResponse
from app.models.checkin import CheckIn, CheckInStatus
from app.models.session import Session, SessionStatus
from app.models.course import Course
from app.models.user import User
from app.models.enrollment import Enrollment
from app.models.device import Device

router = APIRouter(prefix="/checkins", tags=["checkins"])


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two coordinates in meters using Haversine formula."""
    R = 6371000  # Earth's radius in meters

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


@router.post("/", response_model=CheckInResponse, status_code=status.HTTP_201_CREATED)
async def create_checkin(
    request: CheckInCreateRequest,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Student check-in to a session."""
    # Verify session exists
    session = db.query(Session).filter(Session.id == request.session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    # Check session status
    if session.status != SessionStatus.active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session not active"
        )

    # Check check-in window
    now = datetime.utcnow()
    if now < session.checkin_opens_at or now > session.checkin_closes_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Check-in window closed"
        )

    # Verify student is enrolled
    enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == current_user.id,
        Enrollment.course_id == session.course_id,
        Enrollment.is_active == True
    ).first()

    if not enrollment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not enrolled in this course"
        )

    # Check if already checked in
    existing_checkin = db.query(CheckIn).filter(
        CheckIn.session_id == request.session_id,
        CheckIn.student_id == current_user.id
    ).first()

    if existing_checkin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already checked in"
        )

    # Calculate distance from venue
    distance_from_venue = None
    if request.latitude and request.longitude and session.venue_latitude and session.venue_longitude:
        distance_from_venue = calculate_distance(
            request.latitude,
            request.longitude,
            session.venue_latitude,
            session.venue_longitude
        )

    # Initialize risk assessment variables
    risk_score = 0.0
    risk_factors = []
    liveness_passed = None
    liveness_score = None
    face_match_passed = None
    face_match_score = None

    # Get or create device
    device = None
    if request.device_fingerprint:
        device = db.query(Device).filter(
            Device.device_fingerprint == request.device_fingerprint
        ).first()

    # Call face recognition service for risk assessment
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Check liveness if required and image provided
            if session.require_liveness_check and request.liveness_challenge_response:
                liveness_response = await client.post(
                    f"{settings.FACE_SERVICE_URL}/liveness/check",
                    json={
                        "challenge_response": request.liveness_challenge_response,
                        "challenge_type": "passive"
                    }
                )
                if liveness_response.status_code == 200:
                    liveness_data = liveness_response.json()
                    liveness_passed = liveness_data.get("liveness_passed", False)
                    liveness_score = liveness_data.get("liveness_score", 0.0)

            # Check face match if required
            if session.require_face_match and request.liveness_challenge_response and current_user.face_enrolled:
                face_response = await client.post(
                    f"{settings.FACE_SERVICE_URL}/face/verify",
                    json={
                        "image": request.liveness_challenge_response,
                        "reference_template_hash": current_user.face_embedding_hash
                    }
                )
                if face_response.status_code == 200:
                    face_data = face_response.json()
                    face_match_passed = face_data.get("match_passed", False)
                    face_match_score = face_data.get("match_score", 0.0)

            # Call risk assessment
            risk_response = await client.post(
                f"{settings.FACE_SERVICE_URL}/risk/assess",
                json={
                    "liveness_score": liveness_score or 1.0,
                    "face_match_score": face_match_score or 1.0,
                    "device_signature": request.device_fingerprint,
                    "geolocation": {
                        "latitude": request.latitude,
                        "longitude": request.longitude,
                        "accuracy": request.location_accuracy_meters
                    } if request.latitude and request.longitude else None
                }
            )

            if risk_response.status_code == 200:
                risk_data = risk_response.json()
                risk_score = risk_data.get("risk_score", 0.0)

                # Build risk factors from signal breakdown
                signal_breakdown = risk_data.get("signal_breakdown", {})
                for signal_type, weight in signal_breakdown.items():
                    if weight > 0.1:  # Only include significant factors
                        risk_factors.append({
                            "type": signal_type,
                            "weight": weight
                        })

    except httpx.RequestError:
        # If face service is unavailable, continue with basic risk assessment
        pass

    # Geofence check - reject if too far
    geofence_radius = session.geofence_radius_meters or 100.0
    if distance_from_venue and distance_from_venue > (geofence_radius * 2):
        risk_factors.append({
            "type": "geo_out_of_bounds",
            "severity": "critical",
            "weight": 1.0
        })
        risk_score = max(risk_score, 0.9)

    # Liveness check - reject if failed
    if session.require_liveness_check and liveness_passed is False:
        risk_factors.append({
            "type": "liveness_failed",
            "severity": "critical",
            "weight": 1.0
        })
        risk_score = max(risk_score, 0.9)

    # Determine check-in status based on risk score
    threshold = session.risk_threshold or settings.RISK_SCORE_THRESHOLD

    if liveness_passed is False or (distance_from_venue and distance_from_venue > (geofence_radius * 2)):
        checkin_status = CheckInStatus.rejected
    elif risk_score >= threshold:
        checkin_status = CheckInStatus.flagged
    else:
        checkin_status = CheckInStatus.approved

    # Create check-in
    checkin = CheckIn(
        session_id=request.session_id,
        student_id=current_user.id,
        device_id=device.id if device else None,
        status=checkin_status,
        latitude=request.latitude,
        longitude=request.longitude,
        location_accuracy_meters=request.location_accuracy_meters,
        distance_from_venue_meters=distance_from_venue,
        liveness_passed=liveness_passed,
        liveness_score=liveness_score,
        face_match_passed=face_match_passed,
        face_match_score=face_match_score,
        risk_score=risk_score,
        risk_factors=json.dumps(risk_factors) if risk_factors else None,
        qr_code_verified=bool(request.qr_code)
    )

    db.add(checkin)
    db.commit()
    db.refresh(checkin)

    # Parse risk factors back to list
    parsed_risk_factors = json.loads(checkin.risk_factors) if checkin.risk_factors else []

    return CheckInResponse(
        id=checkin.id,
        session_id=checkin.session_id,
        student_id=checkin.student_id,
        status=checkin.status.value,
        checked_in_at=checkin.checked_in_at,
        latitude=checkin.latitude,
        longitude=checkin.longitude,
        distance_from_venue_meters=checkin.distance_from_venue_meters,
        liveness_passed=checkin.liveness_passed,
        liveness_score=checkin.liveness_score,
        risk_score=checkin.risk_score,
        risk_factors=parsed_risk_factors
    )


@router.get("/", response_model=PaginatedResponse[CheckInListResponse])
def list_checkins(
    session_id: Optional[str] = Query(None),
    course_id: Optional[str] = Query(None),
    student_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    min_risk_score: Optional[float] = Query(None),
    max_risk_score: Optional[float] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    limit: int = Query(50, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """List all check-ins with filters. Instructor/admin only."""
    query = db.query(CheckIn)

    # Apply filters
    if session_id:
        query = query.filter(CheckIn.session_id == session_id)
    if student_id:
        query = query.filter(CheckIn.student_id == student_id)
    if status_filter:
        query = query.filter(CheckIn.status == status_filter)
    if min_risk_score is not None:
        query = query.filter(CheckIn.risk_score >= min_risk_score)
    if max_risk_score is not None:
        query = query.filter(CheckIn.risk_score <= max_risk_score)
    if start_date:
        query = query.filter(CheckIn.checked_in_at >= start_date)
    if end_date:
        query = query.filter(CheckIn.checked_in_at <= end_date)

    # Filter by course if specified
    if course_id:
        session_ids = db.query(Session.id).filter(Session.course_id == course_id).all()
        session_ids = [sid[0] for sid in session_ids]
        query = query.filter(CheckIn.session_id.in_(session_ids))

    # Get total count
    total = query.count()

    # Apply pagination
    checkins = query.order_by(CheckIn.checked_in_at.desc()).limit(limit).offset(offset).all()

    # Enrich check-ins
    checkin_responses = []
    for checkin in checkins:
        session = db.query(Session).filter(Session.id == checkin.session_id).first()
        student = db.query(User).filter(User.id == checkin.student_id).first()

        checkin_responses.append(CheckInListResponse(
            id=checkin.id,
            session_id=checkin.session_id,
            session_name=session.name if session else None,
            student_id=checkin.student_id,
            student_name=student.full_name if student else None,
            student_email=student.email if student else None,
            status=checkin.status.value,
            checked_in_at=checkin.checked_in_at,
            distance_from_venue_meters=checkin.distance_from_venue_meters,
            risk_score=checkin.risk_score,
            liveness_passed=checkin.liveness_passed
        ))

    return {
        "items": checkin_responses,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/my-checkins", response_model=List[MyCheckInResponse])
def get_my_checkins(
    course_id: Optional[str] = Query(None),
    limit: int = Query(50, le=100),
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Get current student's check-in history."""
    query = db.query(CheckIn).filter(CheckIn.student_id == current_user.id)

    # Filter by course if specified
    if course_id:
        session_ids = db.query(Session.id).filter(Session.course_id == course_id).all()
        session_ids = [sid[0] for sid in session_ids]
        query = query.filter(CheckIn.session_id.in_(session_ids))

    checkins = query.order_by(CheckIn.checked_in_at.desc()).limit(limit).all()

    # Enrich check-ins
    checkin_responses = []
    for checkin in checkins:
        session = db.query(Session).filter(Session.id == checkin.session_id).first()
        course = db.query(Course).filter(Course.id == session.course_id).first() if session else None

        checkin_responses.append(MyCheckInResponse(
            id=checkin.id,
            session_id=checkin.session_id,
            session_name=session.name if session else "Unknown",
            course_code=course.code if course else "Unknown",
            status=checkin.status.value,
            checked_in_at=checkin.checked_in_at,
            risk_score=checkin.risk_score
        ))

    return checkin_responses


@router.get("/session/{session_id}", response_model=List[CheckInResponse])
def get_session_checkins(
    session_id: str,
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Get all check-ins for a session. Instructor/TA."""
    # Verify session exists
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    # Get check-ins
    checkins = db.query(CheckIn).filter(CheckIn.session_id == session_id).all()

    # Enrich check-ins
    checkin_responses = []
    for checkin in checkins:
        student = db.query(User).filter(User.id == checkin.student_id).first()
        device = db.query(Device).filter(Device.id == checkin.device_id).first() if checkin.device_id else None

        parsed_risk_factors = json.loads(checkin.risk_factors) if checkin.risk_factors else []

        checkin_responses.append(CheckInResponse(
            id=checkin.id,
            session_id=checkin.session_id,
            student_id=checkin.student_id,
            student_name=student.full_name if student else None,
            student_email=student.email if student else None,
            device_id=checkin.device_id,
            status=checkin.status.value,
            checked_in_at=checkin.checked_in_at,
            latitude=checkin.latitude,
            longitude=checkin.longitude,
            distance_from_venue_meters=checkin.distance_from_venue_meters,
            liveness_passed=checkin.liveness_passed,
            liveness_score=checkin.liveness_score,
            face_match_passed=checkin.face_match_passed,
            face_match_score=checkin.face_match_score,
            risk_score=checkin.risk_score,
            risk_factors=parsed_risk_factors,
            device_trusted=device.is_trusted if device else None
        ))

    return checkin_responses


@router.get("/flagged", response_model=List[CheckInResponse])
def get_flagged_checkins(
    course_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    limit: int = Query(50, le=100),
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Get check-ins requiring review (flagged or appealed). Instructor/TA."""
    query = db.query(CheckIn).filter(
        CheckIn.status.in_([CheckInStatus.flagged, CheckInStatus.appealed])
    )

    # Apply filters
    if session_id:
        query = query.filter(CheckIn.session_id == session_id)
    elif course_id:
        session_ids = db.query(Session.id).filter(Session.course_id == course_id).all()
        session_ids = [sid[0] for sid in session_ids]
        query = query.filter(CheckIn.session_id.in_(session_ids))

    checkins = query.order_by(CheckIn.checked_in_at.desc()).limit(limit).all()

    # Enrich check-ins
    checkin_responses = []
    for checkin in checkins:
        session = db.query(Session).filter(Session.id == checkin.session_id).first()
        student = db.query(User).filter(User.id == checkin.student_id).first()

        parsed_risk_factors = json.loads(checkin.risk_factors) if checkin.risk_factors else []

        checkin_responses.append(CheckInResponse(
            id=checkin.id,
            session_id=checkin.session_id,
            session_name=session.name if session else None,
            student_id=checkin.student_id,
            student_name=student.full_name if student else None,
            status=checkin.status.value,
            checked_in_at=checkin.checked_in_at,
            risk_score=checkin.risk_score,
            risk_factors=parsed_risk_factors,
            appeal_reason=checkin.appeal_reason,
            appealed_at=checkin.appealed_at
        ))

    return checkin_responses


@router.get("/{checkin_id}", response_model=CheckInResponse)
def get_checkin(
    checkin_id: str,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Get specific check-in details."""
    checkin = db.query(CheckIn).filter(CheckIn.id == checkin_id).first()
    if not checkin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Check-in not found"
        )

    # Check permissions - owner student, or instructor/TA for session
    if current_user.role not in ["admin", "instructor", "ta"] and checkin.student_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )

    student = db.query(User).filter(User.id == checkin.student_id).first()
    parsed_risk_factors = json.loads(checkin.risk_factors) if checkin.risk_factors else []

    return CheckInResponse(
        id=checkin.id,
        session_id=checkin.session_id,
        student_id=checkin.student_id,
        student_name=student.full_name if student else None,
        student_email=student.email if student else None,
        status=checkin.status.value,
        checked_in_at=checkin.checked_in_at,
        latitude=checkin.latitude,
        longitude=checkin.longitude,
        distance_from_venue_meters=checkin.distance_from_venue_meters,
        liveness_passed=checkin.liveness_passed,
        liveness_score=checkin.liveness_score,
        face_match_passed=checkin.face_match_passed,
        face_match_score=checkin.face_match_score,
        risk_score=checkin.risk_score,
        risk_factors=parsed_risk_factors,
        appeal_reason=checkin.appeal_reason,
        appealed_at=checkin.appealed_at,
        reviewed_by_id=checkin.reviewed_by_id,
        reviewed_at=checkin.reviewed_at,
        review_notes=checkin.review_notes
    )


@router.post("/{checkin_id}/appeal", response_model=CheckInResponse)
def appeal_checkin(
    checkin_id: str,
    request: CheckInAppealRequest,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Appeal a rejected/flagged check-in. Student, must be owner."""
    checkin = db.query(CheckIn).filter(CheckIn.id == checkin_id).first()
    if not checkin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Check-in not found"
        )

    # Check ownership
    if checkin.student_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )

    # Check if can appeal
    if checkin.status not in [CheckInStatus.rejected, CheckInStatus.flagged]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Can only appeal rejected or flagged check-ins"
        )

    # Check if already appealed
    if checkin.appeal_reason:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Check-in already appealed"
        )

    # Check appeal window (7 days)
    if datetime.utcnow() - checkin.checked_in_at > timedelta(days=7):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Appeal window has closed"
        )

    # Update check-in
    checkin.status = CheckInStatus.appealed
    checkin.appeal_reason = request.appeal_reason
    checkin.appealed_at = datetime.utcnow()

    db.commit()
    db.refresh(checkin)

    parsed_risk_factors = json.loads(checkin.risk_factors) if checkin.risk_factors else []

    return CheckInResponse(
        id=checkin.id,
        session_id=checkin.session_id,
        student_id=checkin.student_id,
        status=checkin.status.value,
        checked_in_at=checkin.checked_in_at,
        risk_score=checkin.risk_score,
        risk_factors=parsed_risk_factors,
        appeal_reason=checkin.appeal_reason,
        appealed_at=checkin.appealed_at
    )


@router.post("/{checkin_id}/review", response_model=CheckInResponse)
def review_checkin(
    checkin_id: str,
    request: CheckInReviewRequest,
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Review a flagged/appealed check-in. Instructor/TA for the session's course."""
    checkin = db.query(CheckIn).filter(CheckIn.id == checkin_id).first()
    if not checkin:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Check-in not found"
        )

    # Verify session and course
    session = db.query(Session).filter(Session.id == checkin.session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    # Check permissions
    if current_user.role != "admin":
        course = db.query(Course).filter(Course.id == session.course_id).first()
        if not course or course.instructor_id != current_user.id:
            # Could also check if user is TA for course
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )

    # Validate status
    if request.status not in ["approved", "rejected"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Status must be approved or rejected"
        )

    # Update check-in
    checkin.status = CheckInStatus.approved if request.status == "approved" else CheckInStatus.rejected
    checkin.reviewed_by_id = current_user.id
    checkin.reviewed_at = datetime.utcnow()
    checkin.review_notes = request.review_notes

    db.commit()
    db.refresh(checkin)

    parsed_risk_factors = json.loads(checkin.risk_factors) if checkin.risk_factors else []

    return CheckInResponse(
        id=checkin.id,
        session_id=checkin.session_id,
        student_id=checkin.student_id,
        status=checkin.status.value,
        checked_in_at=checkin.checked_in_at,
        risk_score=checkin.risk_score,
        risk_factors=parsed_risk_factors,
        reviewed_by_id=checkin.reviewed_by_id,
        reviewed_at=checkin.reviewed_at,
        review_notes=checkin.review_notes
    )
