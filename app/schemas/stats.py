"""
Statistics schemas
"""
from pydantic import BaseModel
from typing import List, Dict, Optional
from datetime import datetime


class TrendDataPoint(BaseModel):
    date: str
    count: Optional[int] = None
    rate: Optional[float] = None


class OverviewTrends(BaseModel):
    checkins_by_day: List[TrendDataPoint]
    attendance_rate_by_day: List[TrendDataPoint]


class OverviewStatsResponse(BaseModel):
    total_sessions: int
    active_sessions: int
    total_checkins_today: int
    total_checkins_week: int
    average_attendance_rate: float
    flagged_pending_review: int
    approval_rate: float
    average_risk_score: float
    high_risk_checkins_today: int
    trends: OverviewTrends


class CheckInTimeline(BaseModel):
    minute: int
    count: int


class RiskDistribution(BaseModel):
    low: int
    medium: int
    high: int


class StatusBreakdown(BaseModel):
    approved: int
    flagged: int
    rejected: int
    pending: int


class SessionStatsResponse(BaseModel):
    session_id: str
    session_name: str
    course_code: str
    scheduled_start: datetime
    status: str
    total_enrolled: int
    checked_in: int
    attendance_rate: float
    by_status: StatusBreakdown
    average_risk_score: float
    average_distance_meters: float
    average_checkin_time_minutes: float
    risk_distribution: RiskDistribution
    checkin_timeline: List[CheckInTimeline]


class CourseSessionSummary(BaseModel):
    session_id: str
    name: str
    date: str
    attendance_rate: float
    checked_in: int


class StudentAttendanceSummary(BaseModel):
    student_id: str
    student_name: str
    sessions_attended: int
    attendance_rate: float
    average_risk_score: float


class LowAttendanceAlert(BaseModel):
    student_id: str
    student_name: str
    attendance_rate: float
    sessions_missed: int


class CourseStatsResponse(BaseModel):
    course_id: str
    course_code: str
    course_name: str
    total_sessions: int
    total_enrolled: int
    overall_attendance_rate: float
    sessions: List[CourseSessionSummary]
    student_attendance: List[StudentAttendanceSummary]
    low_attendance_alerts: List[LowAttendanceAlert]


class StudentCourseAttendance(BaseModel):
    course_id: str
    course_code: str
    attendance_rate: float
    sessions_attended: int
    total_sessions: int
    average_risk_score: float


class RecentCheckIn(BaseModel):
    session_name: str
    course_code: str
    checked_in_at: datetime
    status: str


class StudentStatsResponse(BaseModel):
    student_id: str
    student_name: str
    student_email: str
    courses: List[StudentCourseAttendance]
    recent_checkins: List[RecentCheckIn]
