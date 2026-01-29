"""
Statistics API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session as DBSession
from sqlalchemy import func, and_
from typing import Optional
from datetime import datetime, timedelta

from app.core.database import get_db
from app.core.deps import get_current_user, get_instructor_user
from app.schemas.stats import (
    OverviewStatsResponse,
    OverviewTrends,
    TrendDataPoint,
    SessionStatsResponse,
    CheckInTimeline,
    RiskDistribution,
    StatusBreakdown,
    CourseStatsResponse,
    CourseSessionSummary,
    StudentAttendanceSummary,
    LowAttendanceAlert,
    StudentStatsResponse,
    StudentCourseAttendance,
    RecentCheckIn
)
from app.models.session import Session, SessionStatus
from app.models.checkin import CheckIn, CheckInStatus
from app.models.course import Course
from app.models.user import User
from app.models.enrollment import Enrollment

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/overview", response_model=OverviewStatsResponse)
def get_overview_stats(
    course_id: Optional[str] = Query(None),
    days: int = Query(7, ge=1, le=90),
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Get system-wide statistics. Instructor/admin."""
    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)
    week_start = now - timedelta(days=days)

    # Base query filters
    session_query = db.query(Session)
    checkin_query = db.query(CheckIn)

    if course_id:
        session_query = session_query.filter(Session.course_id == course_id)
        checkin_query = checkin_query.join(Session).filter(Session.course_id == course_id)

    # Total sessions
    total_sessions = session_query.count()

    # Active sessions
    active_sessions = session_query.filter(Session.status == SessionStatus.active).count()

    # Check-ins today
    total_checkins_today = checkin_query.filter(CheckIn.checked_in_at >= today_start).count()

    # Check-ins this week
    total_checkins_week = checkin_query.filter(CheckIn.checked_in_at >= week_start).count()

    # Average attendance rate
    closed_sessions = session_query.filter(Session.status == SessionStatus.closed).all()
    if closed_sessions:
        total_attendance = 0
        for session in closed_sessions:
            enrolled = db.query(Enrollment).filter(
                Enrollment.course_id == session.course_id,
                Enrollment.is_active == True
            ).count()
            checked_in = db.query(CheckIn).filter(CheckIn.session_id == session.id).count()
            if enrolled > 0:
                total_attendance += checked_in / enrolled
        average_attendance_rate = total_attendance / len(closed_sessions) if closed_sessions else 0.0
    else:
        average_attendance_rate = 0.0

    # Flagged pending review
    flagged_pending_review = checkin_query.filter(
        CheckIn.status.in_([CheckInStatus.flagged, CheckInStatus.appealed])
    ).count()

    # Approval rate
    total_checkins = checkin_query.count()
    approved_checkins = checkin_query.filter(CheckIn.status == CheckInStatus.approved).count()
    approval_rate = approved_checkins / total_checkins if total_checkins > 0 else 0.0

    # Average risk score
    avg_risk = db.query(func.avg(CheckIn.risk_score)).scalar()
    average_risk_score = float(avg_risk) if avg_risk else 0.0

    # High risk check-ins today
    high_risk_checkins_today = checkin_query.filter(
        CheckIn.checked_in_at >= today_start,
        CheckIn.risk_score >= 0.5
    ).count()

    # Trends - check-ins by day
    checkins_by_day = []
    attendance_by_day = []

    for i in range(days):
        day_start = today_start - timedelta(days=i)
        day_end = day_start + timedelta(days=1)

        day_checkins = checkin_query.filter(
            and_(CheckIn.checked_in_at >= day_start, CheckIn.checked_in_at < day_end)
        ).count()

        checkins_by_day.append(TrendDataPoint(
            date=day_start.strftime("%Y-%m-%d"),
            count=day_checkins
        ))

        # Calculate attendance rate for the day
        day_sessions = session_query.filter(
            and_(Session.scheduled_start >= day_start, Session.scheduled_start < day_end)
        ).all()

        if day_sessions:
            day_total_attendance = 0
            for session in day_sessions:
                enrolled = db.query(Enrollment).filter(
                    Enrollment.course_id == session.course_id,
                    Enrollment.is_active == True
                ).count()
                checked_in = db.query(CheckIn).filter(CheckIn.session_id == session.id).count()
                if enrolled > 0:
                    day_total_attendance += checked_in / enrolled
            day_attendance_rate = day_total_attendance / len(day_sessions)
        else:
            day_attendance_rate = 0.0

        attendance_by_day.append(TrendDataPoint(
            date=day_start.strftime("%Y-%m-%d"),
            rate=day_attendance_rate
        ))

    return OverviewStatsResponse(
        total_sessions=total_sessions,
        active_sessions=active_sessions,
        total_checkins_today=total_checkins_today,
        total_checkins_week=total_checkins_week,
        average_attendance_rate=average_attendance_rate,
        flagged_pending_review=flagged_pending_review,
        approval_rate=approval_rate,
        average_risk_score=average_risk_score,
        high_risk_checkins_today=high_risk_checkins_today,
        trends=OverviewTrends(
            checkins_by_day=list(reversed(checkins_by_day)),
            attendance_rate_by_day=list(reversed(attendance_by_day))
        )
    )


@router.get("/sessions/{session_id}", response_model=SessionStatsResponse)
def get_session_stats(
    session_id: str,
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Get statistics for a specific session. Instructor/TA for session's course."""
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    course = db.query(Course).filter(Course.id == session.course_id).first()

    # Get enrollments
    total_enrolled = db.query(Enrollment).filter(
        Enrollment.course_id == session.course_id,
        Enrollment.is_active == True
    ).count()

    # Get check-ins
    checkins = db.query(CheckIn).filter(CheckIn.session_id == session_id).all()
    checked_in = len(checkins)

    # Attendance rate
    attendance_rate = checked_in / total_enrolled if total_enrolled > 0 else 0.0

    # Status breakdown
    status_counts = {
        "approved": 0,
        "flagged": 0,
        "rejected": 0,
        "pending": 0
    }
    for checkin in checkins:
        status_counts[checkin.status.value] = status_counts.get(checkin.status.value, 0) + 1

    # Average risk score
    if checkins:
        average_risk_score = sum(c.risk_score for c in checkins) / len(checkins)
    else:
        average_risk_score = 0.0

    # Average distance
    distances = [c.distance_from_venue_meters for c in checkins if c.distance_from_venue_meters is not None]
    average_distance_meters = sum(distances) / len(distances) if distances else 0.0

    # Average check-in time (minutes from session start)
    checkin_times = []
    for checkin in checkins:
        if checkin.checked_in_at and session.scheduled_start:
            delta = (checkin.checked_in_at - session.scheduled_start).total_seconds() / 60
            checkin_times.append(delta)
    average_checkin_time_minutes = sum(checkin_times) / len(checkin_times) if checkin_times else 0.0

    # Risk distribution
    low_risk = sum(1 for c in checkins if c.risk_score < 0.3)
    medium_risk = sum(1 for c in checkins if 0.3 <= c.risk_score < 0.5)
    high_risk = sum(1 for c in checkins if c.risk_score >= 0.5)

    # Check-in timeline (by 5-minute intervals)
    timeline = {}
    for checkin in checkins:
        if checkin.checked_in_at and session.checkin_opens_at:
            minutes = int((checkin.checked_in_at - session.checkin_opens_at).total_seconds() / 60)
            interval = (minutes // 5) * 5  # Round to 5-minute intervals
            timeline[interval] = timeline.get(interval, 0) + 1

    checkin_timeline = [CheckInTimeline(minute=m, count=c) for m, c in sorted(timeline.items())]

    return SessionStatsResponse(
        session_id=session.id,
        session_name=session.name,
        course_code=course.code if course else "Unknown",
        scheduled_start=session.scheduled_start,
        status=session.status.value,
        total_enrolled=total_enrolled,
        checked_in=checked_in,
        attendance_rate=attendance_rate,
        by_status=StatusBreakdown(**status_counts),
        average_risk_score=average_risk_score,
        average_distance_meters=average_distance_meters,
        average_checkin_time_minutes=average_checkin_time_minutes,
        risk_distribution=RiskDistribution(
            low=low_risk,
            medium=medium_risk,
            high=high_risk
        ),
        checkin_timeline=checkin_timeline
    )


@router.get("/courses/{course_id}", response_model=CourseStatsResponse)
def get_course_stats(
    course_id: str,
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Get attendance statistics for a course. Instructor for course or admin."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )

    # Check permissions
    if current_user.role not in ["admin"] and course.instructor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient permissions"
        )

    # Get sessions
    session_query = db.query(Session).filter(Session.course_id == course_id)
    if start_date:
        session_query = session_query.filter(Session.scheduled_start >= start_date)
    if end_date:
        session_query = session_query.filter(Session.scheduled_start <= end_date)

    sessions = session_query.all()
    total_sessions = len(sessions)

    # Get enrollments
    total_enrolled = db.query(Enrollment).filter(
        Enrollment.course_id == course_id,
        Enrollment.is_active == True
    ).count()

    # Calculate overall attendance rate
    total_attendance = 0
    session_summaries = []

    for session in sessions:
        checked_in = db.query(CheckIn).filter(CheckIn.session_id == session.id).count()
        if total_enrolled > 0:
            session_attendance_rate = checked_in / total_enrolled
            total_attendance += session_attendance_rate
        else:
            session_attendance_rate = 0.0

        session_summaries.append(CourseSessionSummary(
            session_id=session.id,
            name=session.name,
            date=session.scheduled_start.strftime("%Y-%m-%d"),
            attendance_rate=session_attendance_rate,
            checked_in=checked_in
        ))

    overall_attendance_rate = total_attendance / total_sessions if total_sessions > 0 else 0.0

    # Student attendance
    enrollments = db.query(Enrollment).filter(
        Enrollment.course_id == course_id,
        Enrollment.is_active == True
    ).all()

    student_attendance_list = []
    low_attendance_alerts = []

    for enrollment in enrollments:
        student = db.query(User).filter(User.id == enrollment.student_id).first()
        if not student:
            continue

        # Count sessions attended
        session_ids = [s.id for s in sessions]
        sessions_attended = db.query(CheckIn).filter(
            CheckIn.student_id == student.id,
            CheckIn.session_id.in_(session_ids)
        ).count()

        student_attendance_rate = sessions_attended / total_sessions if total_sessions > 0 else 0.0

        # Calculate average risk score
        avg_risk = db.query(func.avg(CheckIn.risk_score)).filter(
            CheckIn.student_id == student.id,
            CheckIn.session_id.in_(session_ids)
        ).scalar()
        average_risk_score = float(avg_risk) if avg_risk else 0.0

        student_attendance_list.append(StudentAttendanceSummary(
            student_id=student.id,
            student_name=student.full_name,
            sessions_attended=sessions_attended,
            attendance_rate=student_attendance_rate,
            average_risk_score=average_risk_score
        ))

        # Low attendance alert (below 50%)
        if student_attendance_rate < 0.5:
            low_attendance_alerts.append(LowAttendanceAlert(
                student_id=student.id,
                student_name=student.full_name,
                attendance_rate=student_attendance_rate,
                sessions_missed=total_sessions - sessions_attended
            ))

    return CourseStatsResponse(
        course_id=course.id,
        course_code=course.code,
        course_name=course.name,
        total_sessions=total_sessions,
        total_enrolled=total_enrolled,
        overall_attendance_rate=overall_attendance_rate,
        sessions=session_summaries,
        student_attendance=student_attendance_list,
        low_attendance_alerts=low_attendance_alerts
    )


@router.get("/students/{student_id}", response_model=StudentStatsResponse)
def get_student_stats(
    student_id: str,
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Get attendance statistics for a specific student. Instructor for student's courses or admin."""
    student = db.query(User).filter(User.id == student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found"
        )

    # Get enrollments
    enrollments = db.query(Enrollment).filter(
        Enrollment.student_id == student_id,
        Enrollment.is_active == True
    ).all()

    course_attendance_list = []

    for enrollment in enrollments:
        course = db.query(Course).filter(Course.id == enrollment.course_id).first()
        if not course:
            continue

        # Check permissions
        if current_user.role not in ["admin"] and course.instructor_id != current_user.id:
            continue

        # Get sessions for this course
        sessions = db.query(Session).filter(Session.course_id == course.id).all()
        total_sessions = len(sessions)

        # Count sessions attended
        session_ids = [s.id for s in sessions]
        sessions_attended = db.query(CheckIn).filter(
            CheckIn.student_id == student_id,
            CheckIn.session_id.in_(session_ids)
        ).count()

        attendance_rate = sessions_attended / total_sessions if total_sessions > 0 else 0.0

        # Calculate average risk score
        avg_risk = db.query(func.avg(CheckIn.risk_score)).filter(
            CheckIn.student_id == student_id,
            CheckIn.session_id.in_(session_ids)
        ).scalar()
        average_risk_score = float(avg_risk) if avg_risk else 0.0

        course_attendance_list.append(StudentCourseAttendance(
            course_id=course.id,
            course_code=course.code,
            attendance_rate=attendance_rate,
            sessions_attended=sessions_attended,
            total_sessions=total_sessions,
            average_risk_score=average_risk_score
        ))

    # Get recent check-ins
    recent_checkins = db.query(CheckIn).filter(
        CheckIn.student_id == student_id
    ).order_by(CheckIn.checked_in_at.desc()).limit(10).all()

    recent_checkin_list = []
    for checkin in recent_checkins:
        session = db.query(Session).filter(Session.id == checkin.session_id).first()
        course = db.query(Course).filter(Course.id == session.course_id).first() if session else None

        recent_checkin_list.append(RecentCheckIn(
            session_name=session.name if session else "Unknown",
            course_code=course.code if course else "Unknown",
            checked_in_at=checkin.checked_in_at,
            status=checkin.status.value
        ))

    return StudentStatsResponse(
        student_id=student.id,
        student_name=student.full_name,
        student_email=student.email,
        courses=course_attendance_list,
        recent_checkins=recent_checkin_list
    )
