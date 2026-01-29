"""
Dependency injection for FastAPI
"""
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import User

security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> User:
    """Get current authenticated user from JWT token."""
    token = credentials.credentials
    print(f"DEBUG: Received token: {token[:50] if token else 'None'}...")
    payload = decode_token(token)
    print(f"DEBUG: Decoded payload: {payload}")

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials - token decode failed"
        )

    user_id: str = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials"
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account disabled"
        )

    return user


def require_role(required_roles: list):
    """Dependency to check if user has required role."""
    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in required_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )
        return current_user
    return role_checker


# Role-based dependencies
def get_admin_user(current_user: User = Depends(get_current_user)) -> User:
    """Get current user if they are an admin."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user


def get_instructor_user(current_user: User = Depends(get_current_user)) -> User:
    """Get current user if they are an instructor or admin."""
    if current_user.role not in ["instructor", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Instructor access required"
        )
    return current_user


def get_student_user(current_user: User = Depends(get_current_user)) -> User:
    """Get current user if they are a student."""
    if current_user.role != "student":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Student access required"
        )
    return current_user
