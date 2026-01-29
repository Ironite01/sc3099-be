"""
Enrollment schemas
"""
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime


class EnrollmentCreateRequest(BaseModel):
    student_id: str
    course_id: str


class BulkEnrollmentRequest(BaseModel):
    course_id: str
    student_emails: List[EmailStr]
    create_accounts: bool = False


class BulkEnrollmentResponse(BaseModel):
    enrolled: int
    already_enrolled: int
    not_found: int
    created: int
    details: List[dict]


class EnrollmentResponse(BaseModel):
    id: str
    student_id: str
    student_email: Optional[str] = None
    student_name: Optional[str] = None
    course_id: str
    course_code: Optional[str] = None
    course_name: Optional[str] = None
    semester: Optional[str] = None
    instructor_name: Optional[str] = None
    enrolled_at: datetime
    is_active: bool
    face_enrolled: Optional[bool] = None

    class Config:
        from_attributes = True


class CourseEnrollmentResponse(BaseModel):
    course_id: str
    course_code: str
    total_enrolled: int
    students: List[EnrollmentResponse]
