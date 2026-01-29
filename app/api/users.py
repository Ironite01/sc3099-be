"""
User management API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import Optional
import httpx

from app.core.database import get_db
from app.core.deps import get_current_user, get_admin_user
from app.core.config import settings
from app.schemas.user import UserResponse, UserUpdateRequest, FaceEnrollRequest, FaceEnrollResponse
from app.schemas.common import PaginatedResponse
from app.models.user import User

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserResponse)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    """Get current user information."""
    return current_user


@router.put("/me", response_model=UserResponse)
def update_current_user(
    request: UserUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current user profile."""
    if request.full_name is not None:
        current_user.full_name = request.full_name
    if request.camera_consent is not None:
        current_user.camera_consent = request.camera_consent
    if request.geolocation_consent is not None:
        current_user.geolocation_consent = request.geolocation_consent

    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/", response_model=PaginatedResponse[UserResponse])
def list_users(
    role: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(50, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """List all users with pagination and filters. Admin only."""
    query = db.query(User)

    # Apply filters
    if role:
        query = query.filter(User.role == role)
    if is_active is not None:
        query = query.filter(User.is_active == is_active)
    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            (User.full_name.ilike(search_pattern)) | (User.email.ilike(search_pattern))
        )

    # Get total count
    total = query.count()

    # Apply pagination
    users = query.order_by(User.created_at.desc()).limit(limit).offset(offset).all()

    return {
        "items": users,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/{user_id}", response_model=UserResponse)
def get_user(
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get specific user details. Admin or instructor for enrolled students."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Check permissions
    if current_user.role != "admin":
        # For instructors, they can view students enrolled in their courses
        if current_user.role == "instructor":
            from app.models.enrollment import Enrollment
            from app.models.course import Course

            # Check if the user is a student enrolled in any of the instructor's courses
            enrollment = db.query(Enrollment).join(Course).filter(
                Enrollment.student_id == user_id,
                Course.instructor_id == current_user.id
            ).first()

            if not enrollment:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Insufficient permissions"
                )
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )

    return user


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: str,
    request: dict,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Update user details. Admin only."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Update allowed fields
    if "role" in request:
        if request["role"] not in ["student", "instructor", "ta", "admin"]:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid role"
            )
        user.role = request["role"]

    if "is_active" in request:
        user.is_active = request["is_active"]

    db.commit()
    db.refresh(user)
    return user


@router.post("/me/face/enroll", response_model=FaceEnrollResponse)
async def enroll_face(
    request: FaceEnrollRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Enroll the current user's face for identity verification."""
    # Check camera consent
    if not current_user.camera_consent:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Camera consent not given"
        )

    # Call face recognition service
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{settings.FACE_SERVICE_URL}/face/enroll",
                json={
                    "user_id": current_user.id,
                    "image": request.image,
                    "camera_consent": current_user.camera_consent
                }
            )

            if response.status_code == 400:
                error_data = response.json()
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=error_data.get("detail", "No face detected")
                )

            if response.status_code != 201:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Face recognition service unavailable"
                )

            result = response.json()

            # Update user with face enrollment data
            if result.get("enrollment_successful"):
                current_user.face_embedding_hash = result.get("face_template_hash")
                current_user.face_enrolled = True
                db.commit()

                return {
                    "success": True,
                    "message": "Face enrolled successfully",
                    "face_enrolled": True,
                    "quality_score": result.get("quality_score", 0.0)
                }
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Face enrollment failed"
                )

    except httpx.RequestError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Face recognition service unavailable"
        )
