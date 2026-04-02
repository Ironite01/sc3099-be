## Endpoints

### Auth

#### POST /auth/register✅
#### POST /auth/login✅
#### POST /auth/refresh✅

### Users

#### GET /users/me✅
#### PUT /users/me✅
#### GET /users/✅
#### GET /users/{user_id}✅
#### PATCH /users/{user_id}✅
#### POST /users/me/face/enroll

### Courses

#### GET /courses/
#### GET /courses/{course_id}
#### POST /courses/
#### PUT /courses/{course_id}
#### DELETE /courses/{course_id}

### Sessions

#### GET /sessions/
#### GET /sessions/active
#### GET /sessions/my-sessions
#### GET /sessions/{session_id}
#### POST /sessions/
#### PATCH /sessions/{session_id}
#### DELETE /sessions/{session_id}

### Check-ins

#### POST /checkins/
#### GET /checkins/
#### GET /checkins/my-checkins
#### GET /checkins/session/{session_id}
#### GET /checkins/flagged
#### GET /checkins/{checkin_id}
#### POST /checkins/{id}/appeal
#### POST /checkins/{id}/review

### Statistics

#### GET /stats/overview
#### GET /stats/sessions/{session_id}
#### GET /stats/courses/{course_id}
#### GET /stats/students/{student_id}

### Devices

#### POST /devices/register
#### GET /devices/my-devices
#### DELETE /devices/{device_id}
#### PATCH /devices/{device_id}

### Enrollments

#### GET /enrollments/my-enrollments
#### GET /enrollments/course/{course_id}
#### POST /enrollments/
#### POST /enrollments/bulk
#### DELETE /enrollments/{enrollment_id}

### Audit Logs

#### GET /audit/

### Export

#### GET /export/attendance/{course_id}
#### GET /export/session/{session_id}

### POST /device/attest *(OPTIONAL - Not Tested)*

#### PATCH /admin/users/{user_id}/deactivate
#### PATCH /admin/users/{user_id}/activate
#### POST /admin/users/bulk
#### PATCH /admin/sessions/{session_id}/status
#### POST /admin/enrollments/