"""
Enrollment management API endpoints
"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.exc import IntegrityError
from typing import Optional, List

from app.core.database import get_db
from app.core.deps import get_current_user, get_instructor_user
from app.core.security import get_password_hash
from app.schemas.enrollment import (
    EnrollmentCreateRequest,
    BulkEnrollmentRequest,
    BulkEnrollmentResponse,
    EnrollmentResponse,
    CourseEnrollmentResponse
)
from app.models.enrollment import Enrollment
from app.models.course import Course
from app.models.user import User

router = APIRouter(prefix="/enrollments", tags=["enrollments"])


@router.get("/my-enrollments", response_model=List[EnrollmentResponse])
def get_my_enrollments(
    current_user: User = Depends(get_current_user),
    db: DBSession = Depends(get_db)
):
    """Get current student's course enrollments."""
    enrollments = db.query(Enrollment).filter(
        Enrollment.student_id == current_user.id,
        Enrollment.is_active == True
    ).all()

    enrollment_responses = []
    for enrollment in enrollments:
        course = db.query(Course).filter(Course.id == enrollment.course_id).first()
        instructor = db.query(User).filter(User.id == course.instructor_id).first() if course and course.instructor_id else None

        enrollment_responses.append(EnrollmentResponse(
            id=enrollment.id,
            student_id=enrollment.student_id,
            course_id=enrollment.course_id,
            course_code=course.code if course else None,
            course_name=course.name if course else None,
            semester=course.semester if course else None,
            instructor_name=instructor.full_name if instructor else None,
            enrolled_at=enrollment.enrolled_at,
            is_active=enrollment.is_active
        ))

    return enrollment_responses


@router.get("/course/{course_id}", response_model=CourseEnrollmentResponse)
def get_course_enrollments(
    course_id: str,
    is_active: Optional[bool] = Query(True),
    search: Optional[str] = Query(None),
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Get all students enrolled in a course. Instructor/TA for course."""
    # Verify course exists
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Course not found"
        )

    # Check permissions
    if current_user.role not in ["admin"] and course.instructor_id != current_user.id:
        # Check if user is a TA for the course (simplified check)
        if current_user.role != "ta":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )

    # Get enrollments
    query = db.query(Enrollment).filter(Enrollment.course_id == course_id)

    if is_active is not None:
        query = query.filter(Enrollment.is_active == is_active)

    enrollments = query.all()

    # Enrich with student data
    student_responses = []
    for enrollment in enrollments:
        student = db.query(User).filter(User.id == enrollment.student_id).first()
        if not student:
            continue

        # Apply search filter
        if search:
            if search.lower() not in student.full_name.lower() and search.lower() not in student.email.lower():
                continue

        student_responses.append(EnrollmentResponse(
            id=enrollment.id,
            student_id=enrollment.student_id,
            student_email=student.email,
            student_name=student.full_name,
            course_id=enrollment.course_id,
            enrolled_at=enrollment.enrolled_at,
            is_active=enrollment.is_active,
            face_enrolled=student.face_enrolled
        ))

    return CourseEnrollmentResponse(
        course_id=course.id,
        course_code=course.code,
        total_enrolled=len(student_responses),
        students=student_responses
    )


@router.post("/", response_model=EnrollmentResponse, status_code=status.HTTP_201_CREATED)
def create_enrollment(
    request: EnrollmentCreateRequest,
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Enroll a student in a course. Instructor for course or admin."""
    # Verify course exists
    course = db.query(Course).filter(Course.id == request.course_id).first()
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

    # Verify student exists
    student = db.query(User).filter(User.id == request.student_id).first()
    if not student:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Student not found"
        )

    # Check if already enrolled
    existing_enrollment = db.query(Enrollment).filter(
        Enrollment.student_id == request.student_id,
        Enrollment.course_id == request.course_id
    ).first()

    if existing_enrollment:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student already enrolled"
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

    return EnrollmentResponse(
        id=enrollment.id,
        student_id=enrollment.student_id,
        student_email=student.email,
        student_name=student.full_name,
        course_id=enrollment.course_id,
        course_code=course.code,
        course_name=course.name,
        enrolled_at=enrollment.enrolled_at,
        is_active=enrollment.is_active,
        face_enrolled=student.face_enrolled
    )


@router.post("/bulk", response_model=BulkEnrollmentResponse)
def bulk_enroll(
    request: BulkEnrollmentRequest,
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Bulk enroll students by email. Instructor for course or admin."""
    # Verify course exists
    course = db.query(Course).filter(Course.id == request.course_id).first()
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

    enrolled_count = 0
    already_enrolled_count = 0
    not_found_count = 0
    created_count = 0
    details = []

    for email in request.student_emails:
        # Find student by email
        student = db.query(User).filter(User.email == email).first()

        if not student:
            if request.create_accounts:
                # Create new student account
                try:
                    student = User(
                        email=email,
                        full_name=email.split('@')[0],  # Use email prefix as name
                        hashed_password=get_password_hash("changeme123"),  # Default password
                        role="student",
                        is_active=True
                    )
                    db.add(student)
                    db.flush()
                    created_count += 1
                except Exception as e:
                    details.append({"email": email, "status": "error", "message": str(e)})
                    continue
            else:
                not_found_count += 1
                details.append({"email": email, "status": "not_found"})
                continue

        # Check if already enrolled
        existing_enrollment = db.query(Enrollment).filter(
            Enrollment.student_id == student.id,
            Enrollment.course_id == request.course_id
        ).first()

        if existing_enrollment:
            already_enrolled_count += 1
            details.append({"email": email, "status": "already_enrolled"})
            continue

        # Create enrollment
        try:
            enrollment = Enrollment(
                student_id=student.id,
                course_id=request.course_id,
                is_active=True
            )
            db.add(enrollment)
            enrolled_count += 1
            details.append({"email": email, "status": "enrolled"})
        except IntegrityError:
            db.rollback()
            already_enrolled_count += 1
            details.append({"email": email, "status": "already_enrolled"})

    db.commit()

    return BulkEnrollmentResponse(
        enrolled=enrolled_count,
        already_enrolled=already_enrolled_count,
        not_found=not_found_count,
        created=created_count,
        details=details
    )


@router.delete("/{enrollment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_enrollment(
    enrollment_id: str,
    current_user: User = Depends(get_instructor_user),
    db: DBSession = Depends(get_db)
):
    """Remove an enrollment. Instructor for course or admin."""
    enrollment = db.query(Enrollment).filter(Enrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Enrollment not found"
        )

    # Verify course
    course = db.query(Course).filter(Course.id == enrollment.course_id).first()
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

    db.delete(enrollment)
    db.commit()
