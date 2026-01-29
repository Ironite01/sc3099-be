"""
Admin API endpoints for testing
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.exc import IntegrityError
from typing import List
from pydantic import BaseModel, EmailStr

from app.core.database import get_db
from app.core.deps import get_admin_user
from app.core.security import get_password_hash
from app.schemas.user import UserResponse
from app.models.user import User
from app.models.session import Session, SessionStatus
from app.models.enrollment import Enrollment

router = APIRouter(prefix="/admin", tags=["admin"])


class UserActivateResponse(BaseModel):
    id: str
    email: str
    is_active: bool
    message: str


class BulkUserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str = "student"


class BulkUserCreateRequest(BaseModel):
    users: List[BulkUserCreate]


class BulkUserCreateResponse(BaseModel):
    created: int
    failed: int
    users: List[UserResponse]
    errors: List[dict]


class SessionStatusUpdateRequest(BaseModel):
    status: str


class SessionStatusUpdateResponse(BaseModel):
    id: str
    name: str
    status: str
    message: str


class AdminEnrollmentCreateRequest(BaseModel):
    student_id: str
    course_id: str


class AdminEnrollmentResponse(BaseModel):
    id: str
    student_id: str
    course_id: str
    is_active: bool
    enrolled_at: str


@router.patch("/users/{user_id}/deactivate", response_model=UserActivateResponse)
def deactivate_user(
    user_id: str,
    current_user: User = Depends(get_admin_user),
    db: DBSession = Depends(get_db)
):
    """Deactivate a user account. Admin only."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    user.is_active = False
    db.commit()
    db.refresh(user)

    return UserActivateResponse(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        message="User deactivated successfully"
    )


@router.patch("/users/{user_id}/activate", response_model=UserActivateResponse)
def activate_user(
    user_id: str,
    current_user: User = Depends(get_admin_user),
    db: DBSession = Depends(get_db)
):
    """Reactivate a user account. Admin only."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    user.is_active = True
    db.commit()
    db.refresh(user)

    return UserActivateResponse(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        message="User activated successfully"
    )


@router.post("/users/bulk", response_model=BulkUserCreateResponse)
def bulk_create_users(
    request: BulkUserCreateRequest,
    current_user: User = Depends(get_admin_user),
    db: DBSession = Depends(get_db)
):
    """Bulk create users. Admin only."""
    created_users = []
    errors = []
    created_count = 0
    failed_count = 0

    for user_data in request.users:
        try:
            # Check if user already exists
            existing_user = db.query(User).filter(User.email == user_data.email).first()
            if existing_user:
                errors.append({
                    "email": user_data.email,
                    "error": "Email already registered"
                })
                failed_count += 1
                continue

            # Validate role
            valid_roles = ["student", "instructor", "ta", "admin"]
            if user_data.role not in valid_roles:
                errors.append({
                    "email": user_data.email,
                    "error": f"Invalid role: {user_data.role}"
                })
                failed_count += 1
                continue

            # Create user
            user = User(
                email=user_data.email,
                full_name=user_data.full_name,
                hashed_password=get_password_hash(user_data.password),
                role=user_data.role,
                is_active=True
            )

            db.add(user)
            db.flush()
            created_users.append(UserResponse(
                id=user.id,
                email=user.email,
                full_name=user.full_name,
                role=user.role,
                is_active=user.is_active,
                camera_consent=user.camera_consent,
                geolocation_consent=user.geolocation_consent,
                face_enrolled=user.face_enrolled,
                created_at=user.created_at
            ))
            created_count += 1

        except IntegrityError as e:
            db.rollback()
            errors.append({
                "email": user_data.email,
                "error": "Database constraint violation"
            })
            failed_count += 1
        except Exception as e:
            db.rollback()
            errors.append({
                "email": user_data.email,
                "error": str(e)
            })
            failed_count += 1

    db.commit()

    return BulkUserCreateResponse(
        created=created_count,
        failed=failed_count,
        users=created_users,
        errors=errors
    )


@router.patch("/sessions/{session_id}/status", response_model=SessionStatusUpdateResponse)
def update_session_status(
    session_id: str,
    request: SessionStatusUpdateRequest,
    current_user: User = Depends(get_admin_user),
    db: DBSession = Depends(get_db)
):
    """Update session status. Admin only."""
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    # Validate status
    valid_statuses = ["scheduled", "active", "closed", "cancelled"]
    if request.status not in valid_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
        )

    old_status = session.status.value
    session.status = SessionStatus(request.status)
    db.commit()
    db.refresh(session)

    return SessionStatusUpdateResponse(
        id=session.id,
        name=session.name,
        status=session.status.value,
        message=f"Session status changed from '{old_status}' to '{request.status}'"
    )


@router.post("/enrollments/", response_model=AdminEnrollmentResponse)
def create_admin_enrollment(
    request: AdminEnrollmentCreateRequest,
    current_user: User = Depends(get_admin_user),
    db: DBSession = Depends(get_db)
):
    """Create enrollment as admin (bypasses instructor ownership check). Admin only."""
    from app.models.course import Course

    # Verify student exists
    student = db.query(User).filter(User.id == request.student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found"
        )

    # Verify course exists
    course = db.query(Course).filter(Course.id == request.course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )

    # Check if already enrolled
    existing_enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == request.student_id,
        Enrollment.course_id == request.course_id
    ).first()

    if existing_enrollment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student already enrolled in this course"
        )

    # Create enrollment
    enrollment = Enrollment(
        student_id=request.student_id,
        course_id=request.course_id,
        is_active=True
    )

    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)

    return AdminEnrollmentResponse(
        id=enrollment.id,
        student_id=enrollment.student_id,
        course_id=enrollment.course_id,
        is_active=enrollment.is_active,
        enrolled_at=enrollment.enrolled_at.isoformat()
    )
