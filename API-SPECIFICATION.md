# SAIV API Specification

## Base URL
```
http://localhost:8000/api/v1
```

## Authentication

All protected endpoints require JWT bearer token:
```
Authorization: Bearer <access_token>
```

### Role-Based Access Control

| Role | Description | Permissions |
|------|-------------|-------------|
| `student` | Students checking into classes | Check-in, view own records, manage own devices |
| `ta` | Teaching assistants | Student permissions + view session check-ins, review flagged check-ins |
| `instructor` | Course instructors | TA permissions + manage sessions, view course analytics, manage enrollments |
| `admin` | System administrators | Full access to all endpoints |

---

## Endpoints

### Authentication

#### POST /auth/register
Register a new user.

**Request:**
```json
{
  "email": "student@example.com",
  "password": "securepass123",  // min 8 chars
  "full_name": "John Doe",
  "role": "student"  // student|instructor|ta|admin
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "email": "student@example.com",
  "full_name": "John Doe",
  "role": "student",
  "is_active": true,
  "created_at": "2024-01-15T10:00:00Z"
}
```

**Error Responses:**
- `400 Bad Request`: Email already registered, password too weak
- `422 Validation Error`: Invalid email format, missing fields

#### POST /auth/login
Login to receive JWT tokens.

**Request:**
```json
{
  "email": "student@example.com",
  "password": "securepass123"
}
```

**Response:** `200 OK`
```json
{
  "access_token": "eyJ...",  // Expires in 1 hour
  "refresh_token": "eyJ...",  // Expires in 7 days
  "token_type": "bearer",
  "user": { /* UserResponse */ }
}
```

**Error Responses:**
- `401 Unauthorized`: Invalid credentials
- `403 Forbidden`: Account disabled

#### POST /auth/refresh
Refresh access token.

**Request:**
```json
{
  "refresh_token": "eyJ..."
}
```

**Response:** `200 OK`
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "token_type": "bearer"
}
```

---

### Users

#### GET /users/me
Get current user information. **Requires auth.**

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "student@example.com",
  "full_name": "John Doe",
  "role": "student",
  "camera_consent": true,
  "geolocation_consent": true,
  "face_enrolled": false,
  "created_at": "2024-01-15T10:00:00Z"
}
```

#### PUT /users/me
Update current user profile. **Requires auth.**

**Request:**
```json
{
  "full_name": "John Smith",
  "camera_consent": true,
  "geolocation_consent": false
}
```

**Response:** `200 OK` - Returns updated user object

#### GET /users/
List all users with pagination and filters. **Requires auth (admin only).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `role` | string | - | Filter by role (student\|instructor\|ta\|admin) |
| `is_active` | boolean | - | Filter by active status |
| `search` | string | - | Search by name or email |
| `limit` | int | 50 | Results per page (max 100) |
| `offset` | int | 0 | Pagination offset |

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "email": "student@example.com",
      "full_name": "John Doe",
      "role": "student",
      "is_active": true,
      "face_enrolled": true,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

#### GET /users/{user_id}
Get specific user details. **Requires auth (admin, or instructor for enrolled students).**

**Response:** `200 OK` - Returns user object

#### PATCH /users/{user_id}
Update user details. **Requires auth (admin only).**

**Request:**
```json
{
  "role": "ta",
  "is_active": false
}
```

**Response:** `200 OK` - Returns updated user object

#### POST /users/me/face/enroll
Enroll the current user's face for identity verification. **Requires auth.**

This endpoint calls the face recognition service and updates the user's `face_enrolled` status.

**Prerequisites:**
- User must have `camera_consent: true`

**Request:**
```json
{
  "image": "base64_encoded_face_image"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | string | Yes | Base64-encoded face image (PNG/JPEG), without data URL prefix |

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Face enrolled successfully",
  "face_enrolled": true,
  "quality_score": 0.85
}
```

**Error Responses:**
- `400 Bad Request`: Camera consent not given, or no face detected
- `503 Service Unavailable`: Face recognition service unavailable

**Example Usage:**
```javascript
// Capture photo from video element
const canvas = document.createElement('canvas')
canvas.width = video.videoWidth
canvas.height = video.videoHeight
canvas.getContext('2d').drawImage(video, 0, 0)
const dataUrl = canvas.toDataURL('image/jpeg')

// Remove data URL prefix
const base64Image = dataUrl.replace(/^data:image\/\w+;base64,/, '')

// Call API
const response = await fetch('/api/v1/users/me/face/enroll', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ image: base64Image })
})
```

---

### Courses

#### GET /courses/
List courses with optional filters. **Requires auth.**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `is_active` | boolean | true | Filter by active status |
| `semester` | string | - | Filter by semester |
| `instructor_id` | uuid | - | Filter by instructor (admin only) |
| `limit` | int | 50 | Results per page |
| `offset` | int | 0 | Pagination offset |

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "code": "CS6101",
      "name": "Advanced Topics in CS",
      "semester": "AY2024-25 Sem 1",
      "instructor_id": "uuid",
      "instructor_name": "Dr. Smith",
      "venue_name": "LT1",
      "venue_latitude": 1.3483,
      "venue_longitude": 103.6831,
      "geofence_radius_meters": 100.0,
      "risk_threshold": 0.5,
      "is_active": true,
      "created_at": "2024-01-10T10:00:00Z"
    }
  ],
  "total": 25,
  "limit": 50,
  "offset": 0
}
```

#### GET /courses/{course_id}
Get course details. **Requires auth.**

**Response:** `200 OK` - Returns full course object including:
- Course metadata
- Default venue coordinates
- Security settings (risk threshold, geofence)

#### POST /courses/
Create a new course. **Requires auth (admin only).**

**Request:**
```json
{
  "code": "CS6101",
  "name": "Advanced Topics in CS",
  "semester": "AY2024-25 Sem 1",
  "instructor_id": "uuid",
  "venue_name": "LT1",
  "venue_latitude": 1.3483,
  "venue_longitude": 103.6831,
  "geofence_radius_meters": 100.0,
  "risk_threshold": 0.5
}
```

**Response:** `201 Created` - Returns created course object

#### PUT /courses/{course_id}
Update a course. **Requires auth (admin or course instructor).**

**Request:** (partial update supported)
```json
{
  "name": "Updated Course Name",
  "venue_name": "LT2",
  "risk_threshold": 0.6
}
```

**Response:** `200 OK` - Returns updated course object

#### DELETE /courses/{course_id}
Soft-delete a course (sets is_active=false). **Requires auth (admin only).**

**Response:** `204 No Content`

---

### Sessions

Sessions represent class meetings where students check in.

#### GET /sessions/
List all sessions with filters. **Requires auth (instructor/admin).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | - | Filter by status (scheduled\|active\|closed\|cancelled) |
| `course_id` | uuid | - | Filter by course |
| `instructor_id` | uuid | - | Filter by instructor |
| `start_date` | ISO8601 | - | Sessions starting after this date |
| `end_date` | ISO8601 | - | Sessions starting before this date |
| `limit` | int | 50 | Results per page |
| `offset` | int | 0 | Pagination offset |

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "course_id": "uuid",
      "course_code": "CS6101",
      "course_name": "Advanced Topics in CS",
      "instructor_id": "uuid",
      "name": "Lecture 5: Neural Networks",
      "session_type": "lecture",
      "status": "active",
      "scheduled_start": "2024-01-15T14:00:00Z",
      "scheduled_end": "2024-01-15T16:00:00Z",
      "checkin_opens_at": "2024-01-15T13:45:00Z",
      "checkin_closes_at": "2024-01-15T14:30:00Z",
      "venue_name": "NTU LT1",
      "total_enrolled": 50,
      "checked_in_count": 45
    }
  ],
  "total": 100,
  "limit": 50,
  "offset": 0
}
```

#### GET /sessions/active
List all currently active check-in sessions. **Public endpoint (no auth required).**

This endpoint returns sessions where check-in is currently open, useful for students to see available sessions.

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "course_id": "uuid",
    "course_code": "CS6101",
    "name": "Lecture 5: Neural Networks",
    "status": "active",
    "scheduled_start": "2024-01-15T14:00:00Z",
    "scheduled_end": "2024-01-15T16:00:00Z",
    "checkin_opens_at": "2024-01-15T13:45:00Z",
    "checkin_closes_at": "2024-01-15T14:30:00Z",
    "venue_name": "NTU LT1"
  }
]
```

#### GET /sessions/my-sessions
List sessions for courses the current user is enrolled in (students) or teaches (instructors). **Requires auth.**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | - | Filter by status |
| `upcoming` | boolean | false | Only show future sessions |
| `limit` | int | 50 | Results per page |

**Response:** `200 OK` - Returns list of sessions relevant to the user

#### GET /sessions/{session_id}
Get session details. **Requires auth.**

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "course_id": "uuid",
  "instructor_id": "uuid",
  "name": "Lecture 5: Neural Networks",
  "session_type": "lecture",
  "status": "active",
  "scheduled_start": "2024-01-15T14:00:00Z",
  "scheduled_end": "2024-01-15T16:00:00Z",
  "checkin_opens_at": "2024-01-15T13:45:00Z",
  "checkin_closes_at": "2024-01-15T14:30:00Z",
  "venue_latitude": 1.3483,
  "venue_longitude": 103.6831,
  "venue_name": "NTU LT1",
  "geofence_radius_meters": 100.0,
  "require_liveness_check": true,
  "require_face_match": false,
  "risk_threshold": 0.5,
  "qr_code_enabled": false,
  "created_at": "2024-01-14T10:00:00Z"
}
```

#### POST /sessions/
Create a new session. **Requires auth (instructor only).**

**Request:**
```json
{
  "course_id": "uuid",
  "name": "Lecture 5: Neural Networks",
  "session_type": "lecture",  // lecture|tutorial|lab|exam
  "scheduled_start": "2024-01-15T14:00:00Z",
  "scheduled_end": "2024-01-15T16:00:00Z",
  "checkin_opens_at": "2024-01-15T13:45:00Z",  // Optional, defaults to 15min before start
  "checkin_closes_at": "2024-01-15T14:30:00Z", // Optional, defaults to 30min after start
  "venue_latitude": 1.3483,  // Optional, uses course default
  "venue_longitude": 103.6831,
  "venue_name": "NTU LT1",
  "geofence_radius_meters": 100.0,
  "require_liveness_check": true,
  "require_face_match": false,
  "risk_threshold": 0.5
}
```

**Response:** `201 Created` - Returns created session object

**Validation:**
- `course_id` must be a course the instructor teaches
- `scheduled_start` must be in the future
- `scheduled_end` must be after `scheduled_start`
- `checkin_closes_at` must be after `checkin_opens_at`

#### PATCH /sessions/{session_id}
Update a session. **Requires auth (instructor only, must be session owner).**

**Request:** (partial update - any subset of fields)
```json
{
  "status": "closed",
  "name": "Updated Session Name",
  "checkin_closes_at": "2024-01-15T14:45:00Z"
}
```

**Response:** `200 OK` - Returns updated session object

**Status Transitions:**
- `scheduled` → `active`: Opens check-in window
- `active` → `closed`: Closes check-in, finalizes attendance
- Any status → `cancelled`: Cancels session

#### DELETE /sessions/{session_id}
Delete a session. **Requires auth (instructor only, must be session owner).**

Only sessions with status `scheduled` can be deleted. Active or closed sessions should be cancelled instead.

**Response:** `204 No Content`

---

### Check-ins

Check-ins record student attendance at sessions.

#### POST /checkins/
Student check-in to a session. **Requires auth (student only).**

**Request:**
```json
{
  "session_id": "uuid",
  "latitude": 1.3483,
  "longitude": 103.6831,
  "location_accuracy_meters": 10.0,
  "device_fingerprint": "unique_device_id",
  "liveness_challenge_response": "base64_encoded_image",  // Optional
  "qr_code": "session_qr_code"  // Optional, if session requires QR
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "session_id": "uuid",
  "student_id": "uuid",
  "status": "approved",  // pending|approved|flagged|rejected
  "checked_in_at": "2024-01-15T14:05:00Z",
  "latitude": 1.3483,
  "longitude": 103.6831,
  "distance_from_venue_meters": 45.2,
  "liveness_passed": true,
  "liveness_score": 0.92,
  "risk_score": 0.15,
  "risk_factors": [
    {"type": "device_unknown", "weight": 0.15}
  ]
}
```

**Check-in Status Logic:**
| Risk Score | Critical Signals | Result |
|------------|------------------|--------|
| < threshold | None | `approved` |
| >= threshold | None | `flagged` (requires review) |
| Any | Liveness failed | `rejected` |
| Any | GPS > 2x geofence | `rejected` |

**Error Responses:**
- `400 Bad Request`: Session not active, check-in window closed, already checked in
- `404 Not Found`: Session not found

#### GET /checkins/
List all check-ins with filters. **Requires auth (instructor/admin).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `session_id` | uuid | - | Filter by session |
| `course_id` | uuid | - | Filter by course |
| `student_id` | uuid | - | Filter by student |
| `status` | string | - | Filter by status (pending\|approved\|flagged\|rejected\|appealed) |
| `min_risk_score` | float | - | Minimum risk score |
| `max_risk_score` | float | - | Maximum risk score |
| `start_date` | ISO8601 | - | Check-ins after this date |
| `end_date` | ISO8601 | - | Check-ins before this date |
| `limit` | int | 50 | Results per page |
| `offset` | int | 0 | Pagination offset |

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "session_id": "uuid",
      "session_name": "Lecture 5",
      "student_id": "uuid",
      "student_name": "John Doe",
      "student_email": "john@example.com",
      "status": "approved",
      "checked_in_at": "2024-01-15T14:05:00Z",
      "distance_from_venue_meters": 45.2,
      "risk_score": 0.15,
      "liveness_passed": true
    }
  ],
  "total": 500,
  "limit": 50,
  "offset": 0
}
```

#### GET /checkins/my-checkins
Get current student's check-in history. **Requires auth (student).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `course_id` | uuid | - | Filter by course |
| `limit` | int | 50 | Results per page |

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "session_id": "uuid",
    "session_name": "Lecture 5: Neural Networks",
    "course_code": "CS6101",
    "status": "approved",
    "checked_in_at": "2024-01-15T14:05:00Z",
    "risk_score": 0.15
  }
]
```

#### GET /checkins/session/{session_id}
Get all check-ins for a session. **Requires auth (instructor/TA).**

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "student_id": "uuid",
    "student_name": "John Doe",
    "student_email": "john@example.com",
    "status": "approved",
    "checked_in_at": "2024-01-15T14:05:00Z",
    "distance_from_venue_meters": 45.2,
    "risk_score": 0.15,
    "risk_factors": [],
    "liveness_passed": true,
    "device_trusted": true
  }
]
```

#### GET /checkins/flagged
Get check-ins requiring review (flagged or appealed). **Requires auth (instructor/TA).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `course_id` | uuid | - | Filter by course |
| `session_id` | uuid | - | Filter by session |
| `limit` | int | 50 | Results per page |

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "session_id": "uuid",
    "session_name": "Lecture 5",
    "student_id": "uuid",
    "student_name": "John Doe",
    "status": "flagged",  // or "appealed"
    "checked_in_at": "2024-01-15T14:05:00Z",
    "risk_score": 0.72,
    "risk_factors": [
      {"type": "geo_out_of_bounds", "severity": "high", "weight": 0.4},
      {"type": "device_unknown", "severity": "medium", "weight": 0.15}
    ],
    "appeal_reason": null,  // Set if status is "appealed"
    "appealed_at": null
  }
]
```

#### GET /checkins/{checkin_id}
Get specific check-in details. **Requires auth (owner student, or instructor/TA for session).**

**Response:** `200 OK` - Returns full check-in object with all risk signals

#### POST /checkins/{id}/appeal
Appeal a rejected/flagged check-in. **Requires auth (student, must be owner).**

**Request:**
```json
{
  "appeal_reason": "I was actually in class, my phone GPS was inaccurate due to building interference."
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "status": "appealed",
  "appeal_reason": "...",
  "appealed_at": "2024-01-15T15:00:00Z"
}
```

**Validation:**
- Can only appeal `rejected` or `flagged` check-ins
- Cannot appeal more than once
- Appeal window: 7 days from check-in

#### POST /checkins/{id}/review
Review a flagged/appealed check-in. **Requires auth (instructor/TA for the session's course).**

**Request:**
```json
{
  "status": "approved",  // approved|rejected
  "review_notes": "GPS issue confirmed via student's explanation and nearby WiFi logs."
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "status": "approved",
  "reviewed_by_id": "uuid",
  "reviewed_at": "2024-01-15T16:00:00Z",
  "review_notes": "..."
}
```

---

### Statistics

Analytics endpoints for the instructor dashboard.

#### GET /stats/overview
Get system-wide statistics. **Requires auth (instructor/admin).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `course_id` | uuid | - | Filter stats by course |
| `days` | int | 7 | Number of days for trends |

**Response:** `200 OK`
```json
{
  "total_sessions": 150,
  "active_sessions": 3,
  "total_checkins_today": 245,
  "total_checkins_week": 1203,
  "average_attendance_rate": 0.87,
  "flagged_pending_review": 12,
  "approval_rate": 0.94,
  "average_risk_score": 0.18,
  "high_risk_checkins_today": 5,
  "trends": {
    "checkins_by_day": [
      {"date": "2024-01-15", "count": 245},
      {"date": "2024-01-14", "count": 198}
    ],
    "attendance_rate_by_day": [
      {"date": "2024-01-15", "rate": 0.89},
      {"date": "2024-01-14", "rate": 0.85}
    ]
  }
}
```

#### GET /stats/sessions/{session_id}
Get statistics for a specific session. **Requires auth (instructor/TA for session's course).**

**Response:** `200 OK`
```json
{
  "session_id": "uuid",
  "session_name": "Lecture 5",
  "course_code": "CS6101",
  "scheduled_start": "2024-01-15T14:00:00Z",
  "status": "closed",
  "total_enrolled": 50,
  "checked_in": 45,
  "attendance_rate": 0.90,
  "by_status": {
    "approved": 42,
    "flagged": 2,
    "rejected": 1,
    "pending": 0
  },
  "average_risk_score": 0.18,
  "average_distance_meters": 23.5,
  "average_checkin_time_minutes": 3.2,
  "risk_distribution": {
    "low": 40,    // risk < 0.3
    "medium": 4,  // 0.3 <= risk < 0.5
    "high": 1     // risk >= 0.5
  },
  "checkin_timeline": [
    {"minute": 0, "count": 15},
    {"minute": 5, "count": 20},
    {"minute": 10, "count": 8},
    {"minute": 15, "count": 2}
  ]
}
```

#### GET /stats/courses/{course_id}
Get attendance statistics for a course. **Requires auth (instructor for course, or admin).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `start_date` | ISO8601 | semester start | Start of date range |
| `end_date` | ISO8601 | today | End of date range |

**Response:** `200 OK`
```json
{
  "course_id": "uuid",
  "course_code": "CS6101",
  "course_name": "Advanced Topics in CS",
  "total_sessions": 12,
  "total_enrolled": 50,
  "overall_attendance_rate": 0.87,
  "sessions": [
    {
      "session_id": "uuid",
      "name": "Lecture 5",
      "date": "2024-01-15",
      "attendance_rate": 0.90,
      "checked_in": 45
    }
  ],
  "student_attendance": [
    {
      "student_id": "uuid",
      "student_name": "John Doe",
      "sessions_attended": 11,
      "attendance_rate": 0.92,
      "average_risk_score": 0.12
    }
  ],
  "low_attendance_alerts": [
    {
      "student_id": "uuid",
      "student_name": "Jane Smith",
      "attendance_rate": 0.50,
      "sessions_missed": 6
    }
  ]
}
```

#### GET /stats/students/{student_id}
Get attendance statistics for a specific student. **Requires auth (instructor for student's courses, or admin).**

**Response:** `200 OK`
```json
{
  "student_id": "uuid",
  "student_name": "John Doe",
  "student_email": "john@example.com",
  "courses": [
    {
      "course_id": "uuid",
      "course_code": "CS6101",
      "attendance_rate": 0.92,
      "sessions_attended": 11,
      "total_sessions": 12,
      "average_risk_score": 0.12
    }
  ],
  "recent_checkins": [
    {
      "session_name": "Lecture 5",
      "course_code": "CS6101",
      "checked_in_at": "2024-01-15T14:05:00Z",
      "status": "approved"
    }
  ]
}
```

---

### Devices

Device management for security and trust scoring.

#### POST /devices/register
Register a new device. **Requires auth.**

**Request:**
```json
{
  "device_fingerprint": "unique_device_hash",
  "device_name": "John's iPhone",
  "platform": "ios",  // ios|android|web|desktop
  "public_key": "-----BEGIN PUBLIC KEY-----..."
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "device_fingerprint": "unique_device_hash",
  "device_name": "John's iPhone",
  "platform": "ios",
  "is_trusted": false,
  "trust_score": "low",
  "is_active": true,
  "first_seen_at": "2024-01-15T10:00:00Z"
}
```

#### GET /devices/my-devices
List current user's registered devices. **Requires auth.**

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "device_name": "John's iPhone",
    "platform": "ios",
    "is_trusted": true,
    "trust_score": "high",
    "is_active": true,
    "first_seen_at": "2024-01-01T10:00:00Z",
    "last_seen_at": "2024-01-15T14:05:00Z",
    "total_checkins": 25
  }
]
```

#### DELETE /devices/{device_id}
Remove a device. **Requires auth (owner or admin).**

**Response:** `204 No Content`

#### PATCH /devices/{device_id}
Update device properties. **Requires auth (owner for name, admin for trust).**

**Request:**
```json
{
  "device_name": "My Primary Phone",
  "is_trusted": true,  // Admin only
  "is_active": false   // Deactivate device
}
```

**Response:** `200 OK` - Returns updated device object

---

### Enrollments

Manage student course enrollments.

#### GET /enrollments/my-enrollments
Get current student's course enrollments. **Requires auth (student).**

**Response:** `200 OK`
```json
[
  {
    "id": "uuid",
    "course_id": "uuid",
    "course_code": "CS6101",
    "course_name": "Advanced Topics in CS",
    "semester": "AY2024-25 Sem 1",
    "instructor_name": "Dr. Smith",
    "enrolled_at": "2024-01-10T10:00:00Z",
    "is_active": true
  }
]
```

#### GET /enrollments/course/{course_id}
Get all students enrolled in a course. **Requires auth (instructor/TA for course).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `is_active` | boolean | true | Filter by enrollment status |
| `search` | string | - | Search by student name/email |

**Response:** `200 OK`
```json
{
  "course_id": "uuid",
  "course_code": "CS6101",
  "total_enrolled": 50,
  "students": [
    {
      "id": "uuid",
      "student_id": "uuid",
      "student_email": "student@example.com",
      "student_name": "John Doe",
      "enrolled_at": "2024-01-10T10:00:00Z",
      "is_active": true,
      "face_enrolled": true
    }
  ]
}
```

#### POST /enrollments/
Enroll a student in a course. **Requires auth (instructor for course, or admin).**

**Request:**
```json
{
  "student_id": "uuid",
  "course_id": "uuid"
}
```

**Response:** `201 Created` - Returns enrollment object

**Error Responses:**
- `400 Bad Request`: Student already enrolled
- `404 Not Found`: Student or course not found

#### POST /enrollments/bulk
Bulk enroll students by email. **Requires auth (instructor for course, or admin).**

**Request:**
```json
{
  "course_id": "uuid",
  "student_emails": [
    "student1@example.com",
    "student2@example.com",
    "student3@example.com"
  ],
  "create_accounts": false  // If true, create accounts for unknown emails
}
```

**Response:** `200 OK`
```json
{
  "enrolled": 2,
  "already_enrolled": 1,
  "not_found": 0,
  "created": 0,
  "details": [
    {"email": "student1@example.com", "status": "enrolled"},
    {"email": "student2@example.com", "status": "already_enrolled"},
    {"email": "student3@example.com", "status": "enrolled"}
  ]
}
```

#### DELETE /enrollments/{enrollment_id}
Remove an enrollment. **Requires auth (instructor for course, or admin).**

**Response:** `204 No Content`

---

### Audit Logs

Immutable audit trail for compliance and security.

#### GET /audit/
Get audit logs with comprehensive filtering. **Requires auth (admin only).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `user_id` | uuid | - | Filter by user |
| `action` | string | - | Filter by action type |
| `resource_type` | string | - | Filter by resource (user\|session\|checkin\|course) |
| `resource_id` | uuid | - | Filter by specific resource |
| `success` | boolean | - | Filter by success status |
| `start_date` | ISO8601 | - | Logs after this date |
| `end_date` | ISO8601 | - | Logs before this date |
| `limit` | int | 100 | Results per page (max 1000) |
| `offset` | int | 0 | Pagination offset |

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "user_email": "student@example.com",
      "action": "checkin_attempted",
      "resource_type": "checkin",
      "resource_id": "uuid",
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "device_id": "uuid",
      "details": {
        "session_id": "uuid",
        "risk_score": 0.15
      },
      "success": true,
      "timestamp": "2024-01-15T14:05:00Z"
    }
  ],
  "total": 5000,
  "limit": 100,
  "offset": 0
}
```

**Audit Actions:**
| Action | Description |
|--------|-------------|
| `login_success` | Successful login |
| `login_failed` | Failed login attempt |
| `logout` | User logout |
| `user_created` | New user registration |
| `user_updated` | Profile update |
| `checkin_attempted` | Check-in attempt |
| `checkin_approved` | Check-in auto-approved |
| `checkin_flagged` | Check-in flagged for review |
| `checkin_rejected` | Check-in rejected |
| `checkin_appealed` | Student appealed check-in |
| `checkin_reviewed` | Instructor reviewed check-in |
| `session_created` | New session created |
| `session_updated` | Session modified |
| `session_deleted` | Session deleted |
| `enrollment_added` | Student enrolled |
| `enrollment_removed` | Enrollment removed |
| `device_registered` | New device registered |
| `face_enrolled` | Face enrollment completed |

---

### Export

Data export endpoints for reporting.

#### GET /export/attendance/{course_id}
Export attendance data for a course. **Requires auth (instructor for course).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | csv | Export format (csv\|json) |
| `start_date` | ISO8601 | semester start | Start date |
| `end_date` | ISO8601 | today | End date |

**Response:** `200 OK`
- `format=csv`: Returns CSV file download
- `format=json`: Returns JSON array

**CSV Columns:**
```csv
student_id,student_name,student_email,session_date,session_name,status,checked_in_at,risk_score
```

#### GET /export/session/{session_id}
Export check-in data for a session. **Requires auth (instructor for session).**

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `format` | string | csv | Export format (csv\|json) |

**Response:** `200 OK` - Returns downloadable file

---

## Face Recognition Service

**Base URL:** `http://localhost:8001`

This service handles face enrollment, face matching, liveness detection, and risk assessment.
It is called internally by the Backend API and does not require authentication.

> **Note:** Liveness detection (`/liveness/check`) is a **BONUS feature** due to its complexity.
> The core required features are face enrollment and face matching.

---

### POST /face/enroll
Enroll a user's face for future verification. This is a one-time registration per user.

**Request:**
```json
{
  "user_id": "uuid",
  "image": "base64_encoded_image",
  "camera_consent": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | Yes | UUID of the user being enrolled |
| `image` | string | Yes | Base64-encoded face image (PNG/JPEG) |
| `camera_consent` | boolean | Yes | Must be `true` to proceed with enrollment |

**Response:** `201 Created`
```json
{
  "enrollment_successful": true,
  "face_template_hash": "64_char_sha256_hex_string",
  "quality_score": 0.85,
  "details": {
    "face_detected": true,
    "face_detection_confidence": 0.95,
    "image_quality": "good"
  }
}
```

**Success Criteria:**
- Face detected with confidence >= 0.7
- Quality score >= 0.5
- Returns SHA-256 hash (64 hex chars) of face template
- Store `face_template_hash` in `users.face_embedding_hash`

**Error Responses:**
- `400 Bad Request`: No face detected, invalid image, or `camera_consent` is false
- `422 Validation Error`: Missing required fields

**Privacy Requirements:**
- Raw images MUST NOT be stored - only the hash is persisted
- All image processing must be in-memory only

---

### POST /face/verify
Verify that a face image matches a previously enrolled face.

**Request:**
```json
{
  "image": "base64_encoded_image",
  "reference_template_hash": "64_char_sha256_hex_string"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `image` | string | Yes | Base64-encoded face image to verify |
| `reference_template_hash` | string | Yes | Hash from enrollment (stored in `users.face_embedding_hash`) |

**Response:** `200 OK`
```json
{
  "match_passed": true,
  "match_score": 0.82,
  "match_threshold": 0.70,
  "face_detected": true,
  "current_template_hash": "64_char_sha256_hex_string"
}
```

**Matching Logic:**
- `match_passed = (match_score >= 0.70)`
- Same person should score >= 0.70
- Different person should score < 0.70

**Implementation Approaches (choose one):**
1. **ML-Based**: Use face embeddings (FaceNet, ArcFace) with cosine similarity
2. **Feature-Based**: Extract facial landmarks, compute geometric similarity
3. **Perceptual Hash**: Use pHash/dHash with Hamming distance (simpler but less robust)

---

### POST /face/match *(Legacy - use /face/verify instead)*
Match a face against a stored reference hash. Same as `/face/verify` for backward compatibility.

**Request:**
```json
{
  "image": "base64_encoded_image",
  "reference_hash": "sha256_64_char_hex_string"
}
```

**Response:** `200 OK`
```json
{
  "match_passed": true,
  "match_score": 0.85,
  "face_embedding_hash": "sha256_64_char_hex_string"
}
```

Note: `match_passed` is true when `match_score >= 0.7`

---

### POST /liveness/check *(BONUS FEATURE)*
Check face liveness from image using 3D cue analysis. **This is a bonus feature (3 points).**

Single-image liveness detection distinguishes real faces from:
- Printed photos (lack 3D depth)
- Screen displays (moire patterns, flat depth)
- Basic deepfakes (inconsistent face mesh)

**Request:**
```json
{
  "challenge_response": "base64_encoded_image",
  "challenge_type": "passive"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `challenge_response` | string | Yes | Base64-encoded face image (PNG/JPEG) |
| `challenge_type` | string | No | Detection mode (default: "passive") |

**Supported Challenge Types:**
| Type | Description | Implementation |
|------|-------------|----------------|
| `passive` | No user action required | Analyze depth cues from single image |
| `blink` | Detect eye blink | Compare eye aspect ratios |
| `head_turn` | Detect head rotation | Track face mesh landmarks |

> **Note:** The `passive` challenge type is recommended for simplicity - it analyzes 3D depth cues from a single image without requiring user interaction.

**Response:** `200 OK`
```json
{
  "liveness_passed": true,
  "liveness_score": 0.78,
  "liveness_threshold": 0.60,
  "challenge_type": "passive",
  "face_embedding_hash": "sha256_64_char_hex_string",
  "details": {
    "face_detection_confidence": 0.95,
    "face_mesh_complete": true,
    "depth_detected": true,
    "texture_analysis_score": 0.82,
    "threshold": 0.6
  }
}
```

**Liveness Detection Logic:**
- `liveness_passed = (liveness_score >= 0.60)`
- Uses MediaPipe Face Mesh for 3D analysis

**3D Cue Analysis (Recommended Implementation):**
1. **Depth Detection (30%)**: Check nose_tip_z coordinate from MediaPipe (real faces have z < -0.05)
2. **Face Mesh Completeness (25%)**: All 468 landmarks detected
3. **Texture Analysis (25%)**: Check for print/screen artifacts
4. **Color Distribution (20%)**: Natural skin color variance

**Anti-Spoofing Targets:**
- Printed photos: Should fail (no depth cues)
- Screen displays: Should fail (flat z-coordinates)
- Synthetic/uniform faces: Should score < 0.5

### POST /risk/assess
Comprehensive risk assessment combining multiple signals.

**Request:**
```json
{
  "liveness_score": 0.92,
  "face_match_score": 0.85,
  "device_signature": "device_hash",
  "device_public_key": "PEM_key_string",
  "user_agent": "Mozilla/5.0...",
  "ip_address": "192.168.1.1",
  "geolocation": {
    "latitude": 1.3483,
    "longitude": 103.6831,
    "accuracy": 10.0
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `liveness_score` | float | No | 0.0-1.0, from liveness check |
| `face_match_score` | float | No | 0.0-1.0, from face verification |
| `device_signature` | string | No | Device attestation signature |
| `device_public_key` | string | No | PEM-encoded public key |
| `user_agent` | string | No | Browser/client user agent |
| `ip_address` | string | No | Client IP address |
| `geolocation` | object | No | Location with lat, lng, accuracy |

**Response:** `200 OK`
```json
{
  "risk_score": 0.25,
  "risk_level": "LOW",
  "pass_threshold": true,
  "risk_threshold": 0.50,
  "signal_breakdown": {
    "liveness": 0.08,
    "face_match": 0.04,
    "device": 0.02,
    "network": 0.06,
    "geolocation": 0.05
  },
  "recommendations": []
}
```

| Field | Type | Description |
|-------|------|-------------|
| `risk_score` | float | 0.0-1.0, combined weighted risk |
| `risk_level` | string | LOW, MEDIUM, HIGH, or CRITICAL |
| `pass_threshold` | boolean | true if risk_score < risk_threshold |
| `risk_threshold` | float | Threshold used (default 0.50) |
| `signal_breakdown` | object | Per-signal risk contributions |
| `recommendations` | array | List of recommendation strings for low-scoring signals |

**Risk Level Mapping:**
- `LOW`: risk_score < 0.3
- `MEDIUM`: 0.3 <= risk_score < 0.5
- `HIGH`: 0.5 <= risk_score < 0.7
- `CRITICAL`: risk_score >= 0.7

**Signal Weights (for combining scores):**
| Signal | Weight | Notes |
|--------|--------|-------|
| Liveness | 25% | Invert: risk = 1 - liveness_score |
| Face Match | 25% | Invert: risk = 1 - face_match_score |
| Device | 20% | Check signature validity |
| Network | 15% | Detect VPN/proxy |
| Geolocation | 15% | Check accuracy and validity |

**Recommendations Logic:**
Generate recommendations for any signal that contributes high risk:
- Low liveness: "Improve lighting and face visibility"
- Low face match: "Re-enroll face or improve image quality"
- VPN detected: "Disable VPN for check-in"
- Bad geolocation: "Enable precise location services"

---

### POST /device/attest *(OPTIONAL - Not Tested)*
Verify device authenticity. This endpoint is optional and not included in public tests.

**Request:**
```json
{
  "device_public_key": "PEM_key_string",
  "device_signature": "signature_string",
  "challenge": "random_challenge_string",
  "device_info": {
    "platform": "ios",
    "os_version": "17.0"
  }
}
```

**Response:** `200 OK`
```json
{
  "attestation_passed": true,
  "attestation_score": 0.95,
  "device_trusted": true,
  "device_fingerprint": "sha256_hash",
  "issues": []
}
```

### GET /health
Health check endpoint.

**Response:** `200 OK`
```json
{
  "status": "healthy"
}
```

### GET /
Root endpoint - lists available API endpoints.

**Response:** `200 OK`
```json
{
  "service": "SAIV Face Recognition & Risk Service",
  "version": "1.0.0",
  "endpoints": [
    "GET /health - Health check",
    "POST /face/enroll - Enroll a face for verification",
    "POST /face/verify - Verify a face against enrolled template",
    "POST /face/match - Legacy face matching",
    "POST /liveness/check - Perform liveness detection (BONUS)",
    "POST /risk/assess - Multi-signal risk assessment"
  ]
}
```

---

### Admin Endpoints (Required for Automated Testing)

These endpoints are required for the automated test suite to work properly. They allow tests to set up test data and manipulate state without direct database access.

#### PATCH /admin/users/{user_id}/deactivate
Deactivate a user account. **Requires auth (admin only).**

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "is_active": false,
  "message": "User deactivated successfully"
}
```

#### PATCH /admin/users/{user_id}/activate
Reactivate a user account. **Requires auth (admin only).**

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "is_active": true,
  "message": "User activated successfully"
}
```

#### POST /admin/users/bulk
Bulk create users. **Requires auth (admin only).**

Designed for stress testing scenarios where many users need to be created quickly.

**Request:**
```json
{
  "users": [
    {
      "email": "student1@example.com",
      "password": "securepass123",
      "full_name": "Student One",
      "role": "student"
    },
    {
      "email": "student2@example.com",
      "password": "securepass123",
      "full_name": "Student Two",
      "role": "student"
    }
  ]
}
```

**Response:** `201 Created`
```json
{
  "created": 2,
  "failed": 0,
  "users": [
    {"id": "uuid", "email": "student1@example.com", "full_name": "Student One", "role": "student"},
    {"id": "uuid", "email": "student2@example.com", "full_name": "Student Two", "role": "student"}
  ],
  "errors": []
}
```

#### PATCH /admin/sessions/{session_id}/status
Update session status. **Requires auth (admin only).**

Allows setting session status for testing edge cases like checking in to closed or cancelled sessions.

**Request:**
```json
{
  "status": "closed"  // scheduled|active|closed|cancelled
}
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "name": "Lecture 5",
  "status": "closed",
  "message": "Session status changed from 'active' to 'closed'"
}
```

#### POST /admin/enrollments/
Create enrollment as admin (bypasses instructor ownership check). **Requires auth (admin only).**

This endpoint is designed for test setup where an admin needs to enroll a student without being the course instructor.

**Request:**
```json
{
  "student_id": "uuid",
  "course_id": "uuid"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "student_id": "uuid",
  "course_id": "uuid",
  "is_active": true,
  "enrolled_at": "2024-01-15T10:00:00Z"
}
```

---

## Error Responses

All endpoints may return these error codes:

**400 Bad Request**
```json
{
  "detail": "Invalid input data"
}
```

**401 Unauthorized**
```json
{
  "detail": "Could not validate credentials"
}
```

**403 Forbidden**
```json
{
  "detail": "Insufficient permissions"
}
```

**404 Not Found**
```json
{
  "detail": "Resource not found"
}
```

**422 Validation Error**
```json
{
  "detail": [
    {
      "loc": ["body", "email"],
      "msg": "Invalid email format",
      "type": "value_error.email"
    }
  ]
}
```

**429 Too Many Requests**
```json
{
  "detail": "Rate limit exceeded"
}
```

**500 Internal Server Error**
```json
{
  "detail": "Internal server error"
}
```

---

## Rate Limiting

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Login attempts | 60 | per hour per IP |
| API requests | 1000 | per hour per user |
| Check-in attempts | 10 | per minute per user |
| Registration | 10 | per hour per IP |

---

## CORS Policy

Allowed origins (configurable):
- http://localhost:3000 (Frontend)
- http://localhost:8501 (Dashboard)

---

## Security Requirements

1. **Password Hashing**: Bcrypt with cost factor >= 10
2. **JWT Signing**: HS256 algorithm, access token expires in 1 hour, refresh token expires in 7 days
3. **Input Validation**: Pydantic schemas
4. **SQL Injection Prevention**: ORM only (SQLAlchemy)
5. **XSS Prevention**: Output sanitization
6. **CSRF Protection**: Token-based
7. **Risk Threshold**: Default 0.5 (configurable per course/session)

> **Note**: This student project uses HTTP only. HTTPS/TLS is not required.

---

## Pagination

All list endpoints support consistent pagination:

```json
{
  "items": [...],
  "total": 100,   // Total matching records
  "limit": 50,    // Page size
  "offset": 0     // Current offset
}
```

**Query Parameters:**
- `limit`: Number of results per page (default varies, max 100)
- `offset`: Number of records to skip

---

## Testing Your Implementation

Run public tests:
```bash
pytest tests/public/ -v
```

Your implementation should pass 100% of public tests for full marks.

---

## Quick Start: Face Recognition Implementation

### Step 1: Install Dependencies

```bash
pip install mediapipe opencv-python pillow
```

### Step 2: Decode Base64 Images

```python
import base64
from io import BytesIO
from PIL import Image
import numpy as np

def decode_base64_image(base64_string: str) -> np.ndarray:
    """Convert base64 string to numpy array for MediaPipe."""
    try:
        image_data = base64.b64decode(base64_string)
        image = Image.open(BytesIO(image_data))
        return np.array(image.convert('RGB'))
    except Exception as e:
        raise ValueError(f"Invalid image: {e}")
```

### Step 3: Detect Faces with MediaPipe

```python
import mediapipe as mp

def detect_face(image_array: np.ndarray) -> dict:
    """Detect face and return detection info."""
    mp_face_detection = mp.solutions.face_detection

    with mp_face_detection.FaceDetection(
        min_detection_confidence=0.5
    ) as face_detection:
        results = face_detection.process(image_array)

        if not results.detections:
            return {"detected": False, "confidence": 0.0}

        # Take the first (most confident) detection
        detection = results.detections[0]
        confidence = detection.score[0]

        return {
            "detected": True,
            "confidence": confidence,
            "bounding_box": detection.location_data.relative_bounding_box
        }
```

### Step 4: Generate Face Hash

```python
import hashlib
import cv2

def generate_face_hash(image_array: np.ndarray, bbox) -> str:
    """Extract face region and generate SHA-256 hash."""
    h, w = image_array.shape[:2]

    # Crop face region
    x = int(bbox.xmin * w)
    y = int(bbox.ymin * h)
    width = int(bbox.width * w)
    height = int(bbox.height * h)

    # Ensure bounds are valid
    x = max(0, x)
    y = max(0, y)
    face_crop = image_array[y:y+height, x:x+width]

    # Resize to standard size for consistent hashing
    face_resized = cv2.resize(face_crop, (64, 64))

    # Generate hash
    return hashlib.sha256(face_resized.tobytes()).hexdigest()
```

### Step 5: Analyze Face Mesh for Liveness (BONUS)

```python
def analyze_face_mesh(image_array: np.ndarray) -> dict:
    """Analyze face mesh for 3D depth cues (BONUS)."""
    mp_face_mesh = mp.solutions.face_mesh

    with mp_face_mesh.FaceMesh(
        static_image_mode=True,
        max_num_faces=1,
        min_detection_confidence=0.5
    ) as face_mesh:
        results = face_mesh.process(image_array)

        if not results.multi_face_landmarks:
            return {
                "face_mesh_complete": False,
                "nose_tip_z": 0.0,
                "depth_quality": "poor"
            }

        landmarks = results.multi_face_landmarks[0]

        # Nose tip is landmark index 1
        nose_tip = landmarks.landmark[1]
        nose_tip_z = nose_tip.z

        # Determine depth quality
        if abs(nose_tip_z) > 0.03:
            depth_quality = "good"
        elif abs(nose_tip_z) > 0.01:
            depth_quality = "moderate"
        else:
            depth_quality = "poor"

        return {
            "face_mesh_complete": len(landmarks.landmark) >= 400,
            "landmark_count": len(landmarks.landmark),
            "nose_tip_z": nose_tip_z,
            "depth_quality": depth_quality
        }
```

### Step 6: VPN/Proxy Detection

```python
def detect_vpn_proxy(ip_address: str, user_agent: str) -> tuple:
    """Detect VPN/proxy usage. Returns (is_vpn, confidence)."""
    is_vpn = False
    confidence = 0.0

    if ip_address:
        # Private IP ranges (common VPN indicators)
        if (ip_address.startswith('10.') or
            ip_address.startswith('192.168.') or
            ip_address.startswith('172.16.') or
            ip_address.startswith('172.17.') or
            ip_address.startswith('172.18.') or
            ip_address.startswith('172.19.')):
            is_vpn = True
            confidence = 0.7

    if user_agent:
        vpn_keywords = ['vpn', 'proxy', 'tunnel', 'tor']
        if any(kw in user_agent.lower() for kw in vpn_keywords):
            is_vpn = True
            confidence = max(confidence, 0.8)

    return is_vpn, confidence
```

---

## Backend Integration

### Calling Face Service from Backend

The backend API should call the face recognition service during check-in:

```python
import httpx
import os

FACE_SERVICE_URL = os.getenv("FACE_SERVICE_URL", "http://localhost:8001")

async def enroll_face(user_id: str, image: str, consent: bool) -> dict:
    """Call face service to enroll a user's face."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{FACE_SERVICE_URL}/face/enroll",
            json={
                "user_id": user_id,
                "image": image,
                "camera_consent": consent
            }
        )
        return response.json()

async def verify_face(image: str, reference_hash: str) -> dict:
    """Call face service to verify a face."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{FACE_SERVICE_URL}/face/verify",
            json={
                "image": image,
                "reference_template_hash": reference_hash
            }
        )
        return response.json()

async def assess_risk(signals: dict) -> dict:
    """Call face service for risk assessment."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.post(
            f"{FACE_SERVICE_URL}/risk/assess",
            json=signals
        )
        return response.json()
```

### Updating User Face Enrollment Status

After successful face enrollment, update the user's record:

```python
# In backend check-in or enrollment endpoint
face_result = await enroll_face(user.id, image_base64, user.camera_consent)

if face_result.get("enrollment_successful"):
    # Update user record with face hash
    user.face_embedding_hash = face_result["face_template_hash"]
    user.face_enrolled = True
    db.commit()
```
