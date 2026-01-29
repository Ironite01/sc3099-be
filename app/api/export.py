"""
Export API endpoints (CSV/JSON)
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session as DBSession
from typing import Optional
from datetime import datetime
import csv
import io
import json

from app.core.database import get_db
from app.core.deps import get_current_user, get_instructor_user
from app.models.session import Session
from app.models.checkin import CheckIn
from app.models.course import Course
from app.models.user import User

router = APIRouter(prefix="/export", tags=["export"])


@router.get("/attendance/{course_id}")
def export_attendance(
    course_id: str,
    format: str = Query("csv", regex="^(csv|json)$"),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Export attendance data for a course. Instructor for course."""
    # Verify course exists
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )

    # Check permissions
    if current_user.role != "admin" and course.instructor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )

    # Get sessions for this course
    session_query = db.query(Session).filter(Session.course_id == course_id)
    if start_date:
        session_query = session_query.filter(Session.scheduled_start >= start_date)
    if end_date:
        session_query = session_query.filter(Session.scheduled_start <= end_date)

    sessions = session_query.all()
    session_ids = [s.id for s in sessions]

    # Get check-ins
    checkins = db.query(CheckIn).filter(CheckIn.session_id.in_(session_ids)).all()

    # Build data
    data = []
    for checkin in checkins:
        student = db.query(User).filter(User.id == checkin.student_id).first()
        session = db.query(Session).filter(Session.id == checkin.session_id).first()

        data.append({
            "student_id": checkin.student_id,
            "student_name": student.full_name if student else "Unknown",
            "student_email": student.email if student else "Unknown",
            "session_date": session.scheduled_start.strftime("%Y-%m-%d") if session else "",
            "session_name": session.name if session else "Unknown",
            "status": checkin.status.value,
            "checked_in_at": checkin.checked_in_at.isoformat(),
            "risk_score": checkin.risk_score
        })

    if format == "csv":
        # Generate CSV
        output = io.StringIO()
        if data:
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)

        # Return as streaming response
        response = StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=attendance_{course.code}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
            }
        )
        return response

    elif format == "json":
        # Return JSON
        return data


@router.get("/session/{session_id}")
def export_session(
    session_id: str,
    format: str = Query("csv", regex="^(csv|json)$"),
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Export check-in data for a session. Instructor for session."""
    # Verify session exists
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    # Check permissions
    if current_user.role != "admin" and session.instructor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )

    # Get check-ins
    checkins = db.query(CheckIn).filter(CheckIn.session_id == session_id).all()

    # Build data
    data = []
    for checkin in checkins:
        student = db.query(User).filter(User.id == checkin.student_id).first()

        data.append({
            "student_id": checkin.student_id,
            "student_name": student.full_name if student else "Unknown",
            "student_email": student.email if student else "Unknown",
            "status": checkin.status.value,
            "checked_in_at": checkin.checked_in_at.isoformat(),
            "latitude": checkin.latitude,
            "longitude": checkin.longitude,
            "distance_from_venue_meters": checkin.distance_from_venue_meters,
            "risk_score": checkin.risk_score,
            "liveness_passed": checkin.liveness_passed,
            "liveness_score": checkin.liveness_score,
            "face_match_passed": checkin.face_match_passed,
            "face_match_score": checkin.face_match_score
        })

    if format == "csv":
        # Generate CSV
        output = io.StringIO()
        if data:
            writer = csv.DictWriter(output, fieldnames=data[0].keys())
            writer.writeheader()
            writer.writerows(data)

        # Return as streaming response
        course = db.query(Course).filter(Course.id == session.course_id).first()
        response = StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=session_{session.name.replace(' ', '_')}_{datetime.utcnow().strftime('%Y%m%d')}.csv"
            }
        )
        return response

    elif format == "json":
        # Return JSON
        return data
