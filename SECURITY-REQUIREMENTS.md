# SAIV Security Requirements

This document defines all security parameters for the SAIV system. These values are the authoritative source and must be used consistently across all modules.

---

## Authentication

### Password Requirements

| Parameter | Value | Notes |
|-----------|-------|-------|
| Minimum length | 8 characters | Enforced at API level |
| Hashing algorithm | Bcrypt | Use passlib library |
| Cost factor | >= 10 | 12 recommended for production |
| Validation | At registration and password change | Return 422 if too weak |

**Implementation:**
```python
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)
```

### JWT Tokens

| Parameter | Value | Notes |
|-----------|-------|-------|
| Algorithm | HS256 | Symmetric signing |
| Access token TTL | 1 hour (3600 seconds) | Short-lived for security |
| Refresh token TTL | 7 days (604800 seconds) | Longer-lived for UX |
| Secret key source | Environment variable `SECRET_KEY` | Never hardcode |

**Token Structure:**
```json
{
  "sub": "user_id_uuid",
  "email": "user@example.com",
  "role": "student",
  "exp": 1705000000,
  "iat": 1704996400
}
```

---

## Authorization (RBAC)

### Role Hierarchy

| Role | Level | Access |
|------|-------|--------|
| admin | 4 | Full system access |
| instructor | 3 | Course management, all student data |
| ta | 2 | Session management, course student data |
| student | 1 | Own data only |

### Endpoint Permissions

| Endpoint | student | ta | instructor | admin |
|----------|---------|-----|------------|-------|
| GET /users/me | Yes | Yes | Yes | Yes |
| POST /checkins/ | Yes | No | No | No |
| GET /checkins/session/{id} | No | Yes | Yes | Yes |
| POST /sessions/ | No | No | Yes | Yes |
| GET /audit/ | No | No | No | Yes |

---

## Rate Limiting

### Limits (Redis-based)

| Endpoint Category | Limit | Window | Key |
|-------------------|-------|--------|-----|
| Login attempts | 60 | 1 hour | IP address |
| API requests | 1000 | 1 hour | User ID |
| Check-in attempts | 10 | 1 minute | User ID |
| Registration | 10 | 1 hour | IP address |

**Implementation with Redis:**
```python
import redis
from datetime import timedelta

redis_client = redis.Redis()

def check_rate_limit(key: str, limit: int, window: int) -> bool:
    current = redis_client.get(key)
    if current and int(current) >= limit:
        return False
    pipe = redis_client.pipeline()
    pipe.incr(key)
    pipe.expire(key, window)
    pipe.execute()
    return True
```

---

## Risk Scoring

### Thresholds

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| Risk threshold | 0.5 | 0.0-1.0 | Check-in approval cutoff |
| Liveness threshold | 0.6 | 0.0-1.0 | Liveness check pass |
| Face match threshold | 0.7 | 0.0-1.0 | Face verification pass |
| Geofence radius | 100m | Configurable | Distance from venue |

### Signal Weights

| Signal Category | Weight | Description |
|-----------------|--------|-------------|
| Liveness | 0.25 | Face liveness detection |
| Face match | 0.25 | Face verification against enrolled |
| Device attestation | 0.20 | Device trust validation |
| Network analysis | 0.15 | VPN/proxy detection |
| Geolocation | 0.15 | Location verification |

### Risk Levels

| Level | Score Range | Action |
|-------|-------------|--------|
| LOW | 0.0 - 0.3 | Auto-approve |
| MEDIUM | 0.3 - 0.5 | Auto-approve with logging |
| HIGH | 0.5 - 0.7 | Flag for review |
| CRITICAL | 0.7 - 1.0 | Auto-reject |

---

## Input Validation

### Required Validations

1. **Email Format**: RFC 5322 compliant
2. **UUID Format**: Valid UUIDv4 for all IDs
3. **Coordinates**: Valid latitude (-90 to 90), longitude (-180 to 180)
4. **Timestamps**: ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ)
5. **Enums**: Strict validation against allowed values

### SQL Injection Prevention

- Use SQLAlchemy ORM exclusively
- Never construct raw SQL with user input
- Parameterized queries only

### XSS Prevention

- HTML escape all user-provided content in responses
- Content-Type headers set correctly
- No inline JavaScript from user data

---

## Data Protection

### Biometric Data

| Requirement | Implementation |
|-------------|----------------|
| No raw images | Process in memory, never store |
| Hash-only storage | SHA-256 of face embedding (64 hex chars) |
| No BLOB columns | No binary data in main tables |

**Face Hash Generation:**
```python
import hashlib

def generate_face_hash(embedding: bytes) -> str:
    return hashlib.sha256(embedding).hexdigest()
```

### Consent Tracking

| Field | Type | Required Before |
|-------|------|-----------------|
| camera_consent | Boolean | Capturing face image |
| geolocation_consent | Boolean | Capturing GPS location |

### Data Retention

| Data Type | Retention | Mechanism |
|-----------|-----------|-----------|
| Check-in records | 30 days | scheduled_deletion_at field |
| User PII | 30 days after deletion | Scheduled cleanup job |
| Audit logs | Indefinite | Immutable, no deletion |

---

## Audit Logging

### Required Events

| Event | Trigger | Data Logged |
|-------|---------|-------------|
| login_success | Successful auth | user_id, ip, device |
| login_failed | Failed auth | email, ip, reason |
| checkin_attempted | Check-in submit | student_id, session_id, location |
| checkin_approved | Auto/manual approve | checkin_id, reviewer_id |
| checkin_rejected | Auto/manual reject | checkin_id, reason |
| security_violation | Suspicious activity | user_id, violation_type |
| data_exported | CSV/report export | user_id, export_type |

### Immutability

- Audit logs have NO `updated_at` column
- Logs cannot be modified after creation
- Use append-only pattern

---

## CORS Policy

**Allowed Origins (Development):**
- `http://localhost:3000` (Frontend)
- `http://localhost:8501` (Dashboard)

**Production:**
- Configure via `CORS_ORIGINS` environment variable
- Use exact domain matching, no wildcards

---

## Transport Security

> **Note**: This student project uses HTTP only. HTTPS/TLS is **not required** for any environment.

---

## Environment Variables

### Required Secrets

| Variable | Description | Example |
|----------|-------------|---------|
| SECRET_KEY | JWT signing key | 32+ char random string |
| DATABASE_URL | PostgreSQL connection | postgresql://user:pass@host/db |
| REDIS_URL | Redis connection | redis://localhost:6379/0 |

### Optional Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| ACCESS_TOKEN_EXPIRE_MINUTES | 60 | Access token TTL |
| REFRESH_TOKEN_EXPIRE_DAYS | 7 | Refresh token TTL |
| BCRYPT_ROUNDS | 10 | Bcrypt cost factor |
| RISK_SCORE_THRESHOLD | 0.5 | Default risk threshold |

---

## Testing Security

Run security tests:
```bash
pytest tests/public/test_security_basic.py -v
```

Verify:
- Password strength enforcement
- Token validation
- Role-based access control
- Rate limiting
- Input validation
