"""
SAIV Backend API - Main Application
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import engine, Base
from app.api import (
    auth, users, admin, courses, sessions,
    checkins, devices, enrollments, stats, export, audit
)

# Create tables (for development - use Alembic migrations in production)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="SAIV Backend API",
    description="Secure Attendance & Identity Verification System",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Health check endpoint
@app.get("/health")
async def health_check():
    """Basic health check endpoint."""
    return {"status": "healthy"}


# Root endpoint
@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "service": "SAIV Backend API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health"
    }


# Include routers with /api/v1 prefix
app.include_router(auth.router, prefix="/api/v1")
app.include_router(users.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(courses.router, prefix="/api/v1")
app.include_router(sessions.router, prefix="/api/v1")
app.include_router(checkins.router, prefix="/api/v1")
app.include_router(devices.router, prefix="/api/v1")
app.include_router(enrollments.router, prefix="/api/v1")
app.include_router(stats.router, prefix="/api/v1")
app.include_router(export.router, prefix="/api/v1")
app.include_router(audit.router, prefix="/api/v1")
