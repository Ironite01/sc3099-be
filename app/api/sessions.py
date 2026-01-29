"""
Session management API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import func, and_
from typing import Optional, List
from datetime import datetime, timedelta

from app.core.database import get_db
from app.core.deps import get_current_user, get_instructor_user
from app.schemas.session import SessionCreateRequest, SessionUpdateRequest, SessionResponse, SessionListResponse
from app.schemas.common import PaginatedResponse
from app.models.session import Session, SessionStatus
from app.models.course import Course
from app.models.user import User
from app.models.enrollment import Enrollment
from app.models.checkin import CheckIn

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("/", response_model=PaginatedResponse[SessionListResponse])
def list_sessions(
    status_filter: Optional[str] = Query(None, alias="status"),
    course_id: Optional[str] = Query(None),
    instructor_id: Optional[str] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    limit: int = Query(50, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """List all sessions with filters. Instructor/admin only."""
    query = db.query(Session)

    # Apply filters
    if status_filter:
        query = query.filter(Session.status == status_filter)
    if course_id:
        query = query.filter(Session.course_id == course_id)
    if instructor_id:
        query = query.filter(Session.instructor_id == instructor_id)
    if start_date:
        query = query.filter(Session.scheduled_start >= start_date)
    if end_date:
        query = query.filter(Session.scheduled_start <= end_date)

    # Get total count
    total = query.count()

    # Apply pagination
    sessions = query.order_by(Session.scheduled_start.desc()).limit(limit).offset(offset).all()

    # Enrich sessions with course info and counts
    session_responses = []
    for session in sessions:
        course = db.query(Course).filter(Course.id == session.course_id).first()

        # Get enrollment count
        total_enrolled = db.query(Enrollment).filter(
            Enrollment.course_id == session.course_id,
            Enrollment.is_active == True
        ).count()

        # Get checked-in count
        checked_in_count = db.query(CheckIn).filter(
            CheckIn.session_id == session.id
        ).count()

        session_responses.append(SessionListResponse(
            id=session.id,
            course_id=session.course_id,
            course_code=course.code if course else None,
            course_name=course.name if course else None,
            instructor_id=session.instructor_id,
            name=session.name,
            session_type=session.session_type,
            status=session.status.value,
            scheduled_start=session.scheduled_start,
            scheduled_end=session.scheduled_end,
            checkin_opens_at=session.checkin_opens_at,
            checkin_closes_at=session.checkin_closes_at,
            venue_name=session.venue_name,
            total_enrolled=total_enrolled,
            checked_in_count=checked_in_count
        ))

    return {
        "items": session_responses,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/active", response_model=List[SessionListResponse])
def list_active_sessions(db: DBSession = Depends(get_db)):
    """List all currently active check-in sessions. Public endpoint."""
    now = datetime.utcnow()

    sessions = db.query(Session).filter(
        Session.status == SessionStatus.active,
        Session.checkin_opens_at <= now,
        Session.checkin_closes_at >= now
    ).all()

    session_responses = []
    for session in sessions:
        course = db.query(Course).filter(Course.id == session.course_id).first()

        session_responses.append(SessionListResponse(
            id=session.id,
            course_id=session.course_id,
            course_code=course.code if course else None,
            course_name=course.name if course else None,
            instructor_id=session.instructor_id,
            name=session.name,
            session_type=session.session_type,
            status=session.status.value,
            scheduled_start=session.scheduled_start,
            scheduled_end=session.scheduled_end,
            checkin_opens_at=session.checkin_opens_at,
            checkin_closes_at=session.checkin_closes_at,
            venue_name=session.venue_name
        ))

    return session_responses


@router.get("/my-sessions", response_model=List[SessionListResponse])
def list_my_sessions(
    status_filter: Optional[str] = Query(None, alias="status"),
    upcoming: Optional[bool] = Query(False),
    limit: int = Query(50, le=100),
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """List sessions for courses the current user is enrolled in or teaches."""
    if current_user.role in ["instructor", "admin"]:
        # Get sessions for courses the user teaches
        query = db.query(Session).filter(Session.instructor_id == current_user.id)
    else:
        # Get sessions for courses the user is enrolled in
        enrolled_course_ids = db.query(Enrollment.course_id).filter(
            Enrollment.student_id == current_user.id,
            Enrollment.is_active == True
        ).all()
        enrolled_course_ids = [course_id[0] for course_id in enrolled_course_ids]

        query = db.query(Session).filter(Session.course_id.in_(enrolled_course_ids))

    # Apply filters
    if status_filter:
        query = query.filter(Session.status == status_filter)
    if upcoming:
        query = query.filter(Session.scheduled_start >= datetime.utcnow())

    # Apply limit
    sessions = query.order_by(Session.scheduled_start.desc()).limit(limit).all()

    # Enrich sessions
    session_responses = []
    for session in sessions:
        course = db.query(Course).filter(Course.id == session.course_id).first()

        total_enrolled = db.query(Enrollment).filter(
            Enrollment.course_id == session.course_id,
            Enrollment.is_active == True
        ).count()

        checked_in_count = db.query(CheckIn).filter(
            CheckIn.session_id == session.id
        ).count()

        session_responses.append(SessionListResponse(
            id=session.id,
            course_id=session.course_id,
            course_code=course.code if course else None,
            course_name=course.name if course else None,
            instructor_id=session.instructor_id,
            name=session.name,
            session_type=session.session_type,
            status=session.status.value,
            scheduled_start=session.scheduled_start,
            scheduled_end=session.scheduled_end,
            checkin_opens_at=session.checkin_opens_at,
            checkin_closes_at=session.checkin_closes_at,
            venue_name=session.venue_name,
            total_enrolled=total_enrolled,
            checked_in_count=checked_in_count
        ))

    return session_responses


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Get session details."""
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    course = db.query(Course).filter(Course.id == session.course_id).first()

    # Get counts
    total_enrolled = db.query(Enrollment).filter(
        Enrollment.course_id == session.course_id,
        Enrollment.is_active == True
    ).count()

    checked_in_count = db.query(CheckIn).filter(
        CheckIn.session_id == session.id
    ).count()

    return SessionResponse(
        id=session.id,
        course_id=session.course_id,
        course_code=course.code if course else None,
        course_name=course.name if course else None,
        instructor_id=session.instructor_id,
        name=session.name,
        session_type=session.session_type,
        description=session.description,
        status=session.status.value,
        scheduled_start=session.scheduled_start,
        scheduled_end=session.scheduled_end,
        checkin_opens_at=session.checkin_opens_at,
        checkin_closes_at=session.checkin_closes_at,
        venue_latitude=session.venue_latitude,
        venue_longitude=session.venue_longitude,
        venue_name=session.venue_name,
        geofence_radius_meters=session.geofence_radius_meters,
        require_liveness_check=session.require_liveness_check,
        require_face_match=session.require_face_match,
        risk_threshold=session.risk_threshold,
        total_enrolled=total_enrolled,
        checked_in_count=checked_in_count,
        created_at=session.created_at
    )


@router.post("/", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def create_session(
    request: SessionCreateRequest,
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Create a new session. Instructor only."""
    # Verify course exists
    course = db.query(Course).filter(Course.id == request.course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )

    # Check if user is the instructor for this course
    if current_user.role != "admin" and course.instructor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must be the instructor for this course"
        )

    # Validate dates
    if request.scheduled_end <= request.scheduled_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="scheduled_end must be after scheduled_start"
        )

    # Set default check-in times if not provided
    checkin_opens_at = request.checkin_opens_at or (request.scheduled_start - timedelta(minutes=15))
    checkin_closes_at = request.checkin_closes_at or (request.scheduled_start + timedelta(minutes=30))

    if checkin_closes_at <= checkin_opens_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="checkin_closes_at must be after checkin_opens_at"
        )

    # Create session
    session = Session(
        course_id=request.course_id,
        instructor_id=current_user.id,
        name=request.name,
        session_type=request.session_type,
        description=request.description,
        scheduled_start=request.scheduled_start,
        scheduled_end=request.scheduled_end,
        checkin_opens_at=checkin_opens_at,
        checkin_closes_at=checkin_closes_at,
        venue_latitude=request.venue_latitude or course.venue_latitude,
        venue_longitude=request.venue_longitude or course.venue_longitude,
        venue_name=request.venue_name or course.venue_name,
        geofence_radius_meters=request.geofence_radius_meters or course.geofence_radius_meters,
        require_liveness_check=request.require_liveness_check,
        require_face_match=request.require_face_match,
        risk_threshold=request.risk_threshold or course.risk_threshold,
        status=SessionStatus.scheduled
    )

    db.add(session)
    db.commit()
    db.refresh(session)

    return SessionResponse(
        id=session.id,
        course_id=session.course_id,
        course_code=course.code,
        course_name=course.name,
        instructor_id=session.instructor_id,
        name=session.name,
        session_type=session.session_type,
        description=session.description,
        status=session.status.value,
        scheduled_start=session.scheduled_start,
        scheduled_end=session.scheduled_end,
        checkin_opens_at=session.checkin_opens_at,
        checkin_closes_at=session.checkin_closes_at,
        venue_latitude=session.venue_latitude,
        venue_longitude=session.venue_longitude,
        venue_name=session.venue_name,
        geofence_radius_meters=session.geofence_radius_meters,
        require_liveness_check=session.require_liveness_check,
        require_face_match=session.require_face_match,
        risk_threshold=session.risk_threshold,
        created_at=session.created_at
    )


@router.patch("/{session_id}", response_model=SessionResponse)
def update_session(
    session_id: str,
    request: SessionUpdateRequest,
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Update a session. Instructor only, must be session owner."""
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    # Check if user is the instructor for this session
    if current_user.role != "admin" and session.instructor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )

    # Update fields
    if request.name is not None:
        session.name = request.name
    if request.description is not None:
        session.description = request.description
    if request.status is not None:
        session.status = SessionStatus(request.status)
    if request.scheduled_start is not None:
        session.scheduled_start = request.scheduled_start
    if request.scheduled_end is not None:
        session.scheduled_end = request.scheduled_end
    if request.checkin_opens_at is not None:
        session.checkin_opens_at = request.checkin_opens_at
    if request.checkin_closes_at is not None:
        session.checkin_closes_at = request.checkin_closes_at
    if request.venue_latitude is not None:
        session.venue_latitude = request.venue_latitude
    if request.venue_longitude is not None:
        session.venue_longitude = request.venue_longitude
    if request.venue_name is not None:
        session.venue_name = request.venue_name
    if request.geofence_radius_meters is not None:
        session.geofence_radius_meters = request.geofence_radius_meters
    if request.require_liveness_check is not None:
        session.require_liveness_check = request.require_liveness_check
    if request.require_face_match is not None:
        session.require_face_match = request.require_face_match
    if request.risk_threshold is not None:
        session.risk_threshold = request.risk_threshold

    db.commit()
    db.refresh(session)

    course = db.query(Course).filter(Course.id == session.course_id).first()

    return SessionResponse(
        id=session.id,
        course_id=session.course_id,
        course_code=course.code if course else None,
        course_name=course.name if course else None,
        instructor_id=session.instructor_id,
        name=session.name,
        session_type=session.session_type,
        description=session.description,
        status=session.status.value,
        scheduled_start=session.scheduled_start,
        scheduled_end=session.scheduled_end,
        checkin_opens_at=session.checkin_opens_at,
        checkin_closes_at=session.checkin_closes_at,
        venue_latitude=session.venue_latitude,
        venue_longitude=session.venue_longitude,
        venue_name=session.venue_name,
        geofence_radius_meters=session.geofence_radius_meters,
        require_liveness_check=session.require_liveness_check,
        require_face_match=session.require_face_match,
        risk_threshold=session.risk_threshold,
        created_at=session.created_at
    )


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: str,
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Delete a session. Instructor only, must be session owner."""
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    # Check if user is the instructor for this session
    if current_user.role != "admin" and session.instructor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )

    # Only scheduled sessions can be deleted
    if session.status != SessionStatus.scheduled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only scheduled sessions can be deleted"
        )

    db.delete(session)
    db.commit()
