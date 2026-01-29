"""
Application configuration
"""
from typing import List
from pydantic_settings import BaseSettings
import os


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/saiv"

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # Security
    SECRET_KEY: str = "dev-secret-key-change-in-production-min-32-characters"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    BCRYPT_ROUNDS: int = 10

    # Face Recognition Service
    FACE_SERVICE_URL: str = "http://localhost:8001"

    # CORS
    CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:8501"]

    # Risk Assessment
    RISK_SCORE_THRESHOLD: float = 0.5
    LIVENESS_THRESHOLD: float = 0.6
    FACE_MATCH_THRESHOLD: float = 0.7
    GEOFENCE_RADIUS_METERS: float = 100.0

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
