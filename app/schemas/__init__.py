"""
Schemas for request/response models
"""
from app.schemas.common import PaginatedResponse, MessageResponse, StatusResponse
from app.schemas.user import (
    UserRegisterRequest,
    UserLoginRequest,
    TokenResponse,
    RefreshTokenRequest,
    UserResponse,
    UserUpdateRequest,
    FaceEnrollRequest,
    FaceEnrollResponse
)
from app.schemas.course import (
    CourseCreateRequest,
    CourseUpdateRequest,
    CourseResponse
)
from app.schemas.session import (
    SessionCreateRequest,
    SessionUpdateRequest,
    SessionResponse,
    SessionListResponse
)
from app.schemas.enrollment import (
    EnrollmentCreateRequest,
    BulkEnrollmentRequest,
    BulkEnrollmentResponse,
    EnrollmentResponse,
    CourseEnrollmentResponse
)
from app.schemas.checkin import (
    CheckInCreateRequest,
    CheckInAppealRequest,
    CheckInReviewRequest,
    CheckInResponse,
    CheckInListResponse,
    MyCheckInResponse
)
from app.schemas.device import (
    DeviceRegisterRequest,
    DeviceUpdateRequest,
    DeviceResponse
)
from app.schemas.stats import (
    OverviewStatsResponse,
    SessionStatsResponse,
    CourseStatsResponse,
    StudentStatsResponse
)
from app.schemas.audit import AuditLogResponse

__all__ = [
    # Common
    "PaginatedResponse",
    "MessageResponse",
    "StatusResponse",
    # User
    "UserRegisterRequest",
    "UserLoginRequest",
    "TokenResponse",
    "RefreshTokenRequest",
    "UserResponse",
    "UserUpdateRequest",
    "FaceEnrollRequest",
    "FaceEnrollResponse",
    # Course
    "CourseCreateRequest",
    "CourseUpdateRequest",
    "CourseResponse",
    # Session
    "SessionCreateRequest",
    "SessionUpdateRequest",
    "SessionResponse",
    "SessionListResponse",
    # Enrollment
    "EnrollmentCreateRequest",
    "BulkEnrollmentRequest",
    "BulkEnrollmentResponse",
    "EnrollmentResponse",
    "CourseEnrollmentResponse",
    # CheckIn
    "CheckInCreateRequest",
    "CheckInAppealRequest",
    "CheckInReviewRequest",
    "CheckInResponse",
    "CheckInListResponse",
    "MyCheckInResponse",
    # Device
    "DeviceRegisterRequest",
    "DeviceUpdateRequest",
    "DeviceResponse",
    # Stats
    "OverviewStatsResponse",
    "SessionStatsResponse",
    "CourseStatsResponse",
    "StudentStatsResponse",
    # Audit
    "AuditLogResponse"
]
