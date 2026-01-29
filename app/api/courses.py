"""
Course management API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import Optional

from app.core.database import get_db
from app.core.deps import get_current_user, get_admin_user, get_instructor_user
from app.schemas.course import CourseCreateRequest, CourseUpdateRequest, CourseResponse
from app.schemas.common import PaginatedResponse
from app.models.course import Course
from app.models.user import User

router = APIRouter(prefix="/courses", tags=["courses"])


@router.get("/", response_model=PaginatedResponse[CourseResponse])
def list_courses(
    is_active: Optional[bool] = Query(True),
    semester: Optional[str] = Query(None),
    instructor_id: Optional[str] = Query(None),
    limit: int = Query(50, le=100),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List courses with optional filters."""
    query = db.query(Course)

    # Apply filters
    if is_active is not None:
        query = query.filter(Course.is_active == is_active)
    if semester:
        query = query.filter(Course.semester == semester)
    if instructor_id:
        # Only admin can filter by instructor_id
        if current_user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )
        query = query.filter(Course.instructor_id == instructor_id)

    # Get total count
    total = query.count()

    # Apply pagination
    courses = query.order_by(Course.created_at.desc()).limit(limit).offset(offset).all()

    # Enrich with instructor names
    course_responses = []
    for course in courses:
        course_dict = {
            "id": course.id,
            "code": course.code,
            "name": course.name,
            "semester": course.semester,
            "description": course.description,
            "instructor_id": course.instructor_id,
            "venue_name": course.venue_name,
            "venue_latitude": course.venue_latitude,
            "venue_longitude": course.venue_longitude,
            "geofence_radius_meters": course.geofence_radius_meters,
            "risk_threshold": course.risk_threshold,
            "is_active": course.is_active,
            "created_at": course.created_at
        }

        # Get instructor name if applicable
        if course.instructor_id:
            instructor = db.query(User).filter(User.id == course.instructor_id).first()
            if instructor:
                course_dict["instructor_name"] = instructor.full_name

        course_responses.append(course_dict)

    return {
        "items": course_responses,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(
    course_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get course details."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )

    # Get instructor name
    instructor_name = None
    if course.instructor_id:
        instructor = db.query(User).filter(User.id == course.instructor_id).first()
        if instructor:
            instructor_name = instructor.full_name

    return CourseResponse(
        id=course.id,
        code=course.code,
        name=course.name,
        semester=course.semester,
        description=course.description,
        instructor_id=course.instructor_id,
        instructor_name=instructor_name,
        venue_name=course.venue_name,
        venue_latitude=course.venue_latitude,
        venue_longitude=course.venue_longitude,
        geofence_radius_meters=course.geofence_radius_meters,
        risk_threshold=course.risk_threshold,
        is_active=course.is_active,
        created_at=course.created_at
    )


@router.post("/", response_model=CourseResponse, status_code=status.HTTP_201_CREATED)
def create_course(
    request: CourseCreateRequest,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Create a new course. Admin only."""
    # Check if course code already exists
    existing_course = db.query(Course).filter(Course.code == request.code).first()
    if existing_course:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Course code already exists"
        )

    # Verify instructor exists
    instructor = db.query(User).filter(User.id == request.instructor_id).first()
    if not instructor:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Instructor not found"
        )

    # Create course
    course = Course(
        code=request.code,
        name=request.name,
        semester=request.semester,
        description=request.description,
        instructor_id=request.instructor_id,
        venue_name=request.venue_name,
        venue_latitude=request.venue_latitude,
        venue_longitude=request.venue_longitude,
        geofence_radius_meters=request.geofence_radius_meters,
        risk_threshold=request.risk_threshold
    )

    db.add(course)
    db.commit()
    db.refresh(course)

    return CourseResponse(
        id=course.id,
        code=course.code,
        name=course.name,
        semester=course.semester,
        description=course.description,
        instructor_id=course.instructor_id,
        instructor_name=instructor.full_name,
        venue_name=course.venue_name,
        venue_latitude=course.venue_latitude,
        venue_longitude=course.venue_longitude,
        geofence_radius_meters=course.geofence_radius_meters,
        risk_threshold=course.risk_threshold,
        is_active=course.is_active,
        created_at=course.created_at
    )


@router.put("/{course_id}", response_model=CourseResponse)
def update_course(
    course_id: str,
    request: CourseUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update a course. Admin or course instructor."""
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

    # Update fields
    if request.name is not None:
        course.name = request.name
    if request.description is not None:
        course.description = request.description
    if request.venue_name is not None:
        course.venue_name = request.venue_name
    if request.venue_latitude is not None:
        course.venue_latitude = request.venue_latitude
    if request.venue_longitude is not None:
        course.venue_longitude = request.venue_longitude
    if request.geofence_radius_meters is not None:
        course.geofence_radius_meters = request.geofence_radius_meters
    if request.risk_threshold is not None:
        course.risk_threshold = request.risk_threshold
    if request.is_active is not None:
        course.is_active = request.is_active

    db.commit()
    db.refresh(course)

    # Get instructor name
    instructor_name = None
    if course.instructor_id:
        instructor = db.query(User).filter(User.id == course.instructor_id).first()
        if instructor:
            instructor_name = instructor.full_name

    return CourseResponse(
        id=course.id,
        code=course.code,
        name=course.name,
        semester=course.semester,
        description=course.description,
        instructor_id=course.instructor_id,
        instructor_name=instructor_name,
        venue_name=course.venue_name,
        venue_latitude=course.venue_latitude,
        venue_longitude=course.venue_longitude,
        geofence_radius_meters=course.geofence_radius_meters,
        risk_threshold=course.risk_threshold,
        is_active=course.is_active,
        created_at=course.created_at
    )


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    course_id: str,
    current_user: User = Depends(get_admin_user),
    db: Session = Depends(get_db)
):
    """Soft-delete a course (sets is_active=false). Admin only."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )

    course.is_active = False
    db.commit()
