"""
Common schemas
"""
from pydantic import BaseModel
from typing import List, Generic, TypeVar

T = TypeVar('T')


class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated response."""
    items: List[T]
    total: int
    limit: int
    offset: int


class MessageResponse(BaseModel):
    """Simple message response."""
    message: str


class StatusResponse(BaseModel):
    """Status response."""
    status: str
