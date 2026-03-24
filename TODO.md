# SAIV Backend API - Implementation Checklist

## Summary
- **Total Endpoints**: 49
- **Implemented**: 8 (with bugs)
- **Needs Refactoring**: 5
- **Not Started**: 36
- **Completion Rate**: ~16%

---

## ✅ IMPLEMENTED (with issues requiring refactoring)

### Authentication (3/3 - but needs fixes)
- [x] **POST /auth/register**
  - Issue: Password validation returns 400, spec requires 422
  - Status: Functional (minor bug)

- [x] **POST /auth/login**
  - Issue: Response includes `user` object, spec doesn't require it
  - Status: Functional (response mismatch)

- [x] **POST /auth/refresh**
  - Issue: Response includes `user` object, spec shows only tokens
  - Status: Functional (response mismatch)

### Sessions (1/7)
- [x] **GET /sessions/active**
  - Status: Partial implementation (works but filtering may need refinement)

### Devices (2/4)
- [x] **POST /devices/register**
  - Issue: Calls `fastify.pg.transact()` which doesn't exist in pg.ts
  - Issue: Missing attestation validation logic (imported but not implemented)
  - Status: **BROKEN** - Cannot register devices

- [x] **GET /devices/my-devices**
  - Status: Partial implementation (controller exists, query logic incomplete)

### Check-ins (1/8)
- [x] **POST /checkins/**
  - ⚠️ Hardcoded Variables:
    - `livenessPassed = true` (should calculate from ML service)
    - `livenessScore = 0.95` (should calculate from ML service)
    - `riskScore = 0.1` (should calculate from risk assessment)
  - ⚠️ Missing Logic:
    - QR code verification (TODO comment)
    - Student enrollment verification (TODO comment)
    - No face matching verification
  - Status: Functional for basic flow, but risk scoring & validations incomplete

### Users (1/6)
- [x] **GET /users/me**
  - Status: Working correctly

---

## 🔄 NEEDS REFACTORING (bugs in working code)

### Priority: Critical
1. **Fix Device Registration Transact Method**
   - File: [src/controller/device.ts](src/controller/device.ts#L50)
   - Issue: `fastify.pg.transact()` doesn't exist
   - Solution: Add transact method to [src/services/pg.ts](src/services/pg.ts) or refactor device registration

2. **Implement Real Risk Scoring**
   - File: [src/model/checkin.ts](src/model/checkin.ts#L108)
   - Replace hardcoded values with signal-weighted calculation:
     - Liveness (0.25) + Face match (0.25) + Device attestation (0.20) + Network (0.15) + Geolocation (0.15)
   - Determine risk level (LOW/MEDIUM/HIGH/CRITICAL)

3. **Implement Device Attestation Service**
   - File: [src/services/attestation/index.ts](src/services/attestation/index.ts)
   - Required for: iOS App Attest validation, Android SafetyNet/Play Integrity
   - Currently imported but not functional

### Priority: High
4. **Fix Auth Token Response Structures**
   - POST /auth/login: Remove or keep `user` object per spec
   - POST /auth/refresh: Response should be `{access_token, refresh_token, token_type}` only (no user)
   - File: [src/controller/auth.ts](src/controller/auth.ts#L100-L110)

5. **Fix Password Validation Error Code**
   - File: [src/model/user.ts](src/model/user.ts#L47)
   - Change error code from 400 to 422 (Validation Error)

6. **Complete Checkin Validation**
   - Implement: QR code verification
   - Implement: Student enrollment in course check
   - Implement: Face matching (if required by session)
   - Implement: Prevent duplicate check-ins

---

## ❌ NOT IMPLEMENTED

### Users Endpoints (5 remaining)
- [x] **PUT /users/me** - Update current user profile
  - Allow: full_name, camera_consent, geolocation_consent
  - Requires: Auth

- [x] **GET /users/** - List all users (admin only)
  - Query params: role, is_active, search, limit, offset
  - Pagination required
  - Requires: Admin role

- [x] **GET /users/{user_id}** - Get specific user
  - Requires: Admin or instructor (for enrolled students)

- [x] **PATCH /users/{user_id}** - Update user (admin only)
  - Allow: role, is_active
  - Requires: Admin role

- [ ] **POST /users/me/face/enroll** - Enroll face for biometric verification
  - Request: {image: base64}
  - Requires: camera_consent = true
  - Calls ML service: POST http://ml-service:8001/face/enroll
  - Returns: quality_score, face_enrolled status

### Courses Endpoints (5 total)
- [ ] **GET /courses/** - List courses with filters
  - Query params: is_active, semester, instructor_id, limit, offset
  - Requires: Auth

- [ ] **GET /courses/{course_id}** - Get course details
  - Requires: Auth

- [ ] **POST /courses/** - Create course
  - Request: code, name, semester, instructor_id, venue coords, geofence_radius, risk_threshold
  - Requires: Admin role

- [ ] **PUT /courses/{course_id}** - Update course
  - Partial update allowed
  - Requires: Admin or course instructor

- [ ] **DELETE /courses/{course_id}** - Soft delete (set is_active=false)
  - Requires: Admin role

### Sessions Endpoints (6 remaining)
- [ ] **GET /sessions/** - List sessions (instructor/admin)
  - Query params: status, course_id, instructor_id, start_date, end_date, limit, offset
  - Requires: Instructor/Admin role

- [ ] **GET /sessions/my-sessions** - List user's sessions
  - Students: enrolled courses, Instructors: teaching courses
  - Query params: status, upcoming, limit
  - Requires: Auth

- [ ] **GET /sessions/{session_id}** - Get session details
  - Requires: Auth

- [ ] **POST /sessions/** - Create session (instructor)
  - Request: course_id, name, session_type, scheduled_start/end, checkin times, venue, geofence, risk settings
  - Validation: course ownership, time logic
  - Requires: Instructor role

- [ ] **PATCH /sessions/{session_id}** - Update session
  - Partial update, status transitions
  - Requires: Instructor (session owner)

- [ ] **DELETE /sessions/{session_id}** - Delete session
  - Only if status == 'scheduled'
  - Requires: Instructor (session owner)

### Check-in Endpoints (7 remaining)
- [ ] **GET /checkins/** - List check-ins (instructor/admin)
  - Query params: session_id, course_id, student_id, status, min/max_risk_score, date range, limit, offset

- [ ] **GET /checkins/my-checkins** - Student's check-in history
  - Query params: course_id, limit
  - Requires: Student role

- [ ] **GET /checkins/session/{session_id}** - Check-ins for a session
  - Requires: Instructor/TA role

- [ ] **GET /checkins/flagged** - Flagged/appealed check-ins needing review
  - Query params: course_id, session_id, limit
  - Requires: Instructor/TA role

- [ ] **GET /checkins/{checkin_id}** - Get specific check-in
  - Requires: Owner student or instructor/TA

- [ ] **POST /checkins/{id}/appeal** - Student appeals flagged/rejected check-in
  - Request: appeal_reason
  - Constraints: 7-day appeal window, one appeal per check-in
  - Requires: Student (check-in owner)

- [ ] **POST /checkins/{id}/review** - Instructor reviews flagged check-in
  - Request: status (approved/rejected), review_notes
  - Requires: Instructor/TA role

### Statistics Endpoints (4 total)
- [ ] **GET /stats/overview** - System-wide stats dashboard
  - Query params: course_id, days
  - Returns: session counts, checkin counts, attendance rates, trends, high-risk alerts
  - Requires: Instructor/Admin role

- [ ] **GET /stats/sessions/{session_id}** - Session-level stats
  - Returns: attendance rate, checkin distribution, risk distribution, timeline
  - Requires: Instructor/TA role

- [ ] **GET /stats/courses/{course_id}** - Course attendance stats
  - Query params: start_date, end_date
  - Returns: overall attendance, per-student attendance, low attendance alerts
  - Requires: Instructor/Admin role

- [ ] **GET /stats/students/{student_id}** - Individual student stats
  - Returns: course attendance, recent check-ins
  - Requires: Instructor/Admin role

### Devices Endpoints (2 remaining)
- [x] **DELETE /devices/{device_id}** - Remove device
  - Requires: Owner or Admin

- [ ] **PATCH /devices/{device_id}** - Update device
  - Allow: device_name, is_trusted (admin only), is_active
  - Requires: Owner or Admin

### Enrollments Endpoints (5 total)
- [x] **GET /enrollments/my-enrollments** - Student's course enrollments
  - Returns: enrolled courses
  - Requires: Student role

- [x] **GET /enrollments/course/{course_id}** - Students in course
  - Query params: is_active, search
  - Requires: Instructor/TA role

- [ ] **POST /enrollments/** - Enroll student in course
  - Request: student_id, course_id
  - Requires: Instructor or Admin

- [ ] **POST /enrollments/bulk** - Bulk enroll by email
  - Request: course_id, student_emails[], create_accounts
  - Requires: Instructor or Admin

- [ ] **DELETE /enrollments/{enrollment_id}** - Remove enrollment
  - Requires: Instructor or Admin

### Audit Logging (1 total - comprehensive)
- [ ] **GET /audit/** - Get immutable audit logs (admin only)
  - Query params: user_id, action, resource_type, resource_id, success, date range, limit, offset
  - Must log all actions per spec: login, user creation, checkin attempts, approvals, reviews, etc.
  - Immutable: no updates/deletes, append-only pattern

### Data Export (2 total)
- [ ] **GET /export/attendance/{course_id}** - Export course attendance
  - Query params: format (csv/json), date range
  - CSV columns: student_id, student_name, student_email, session_date, session_name, status, checked_in_at, risk_score
  - Requires: Instructor for course

- [ ] **GET /export/session/{session_id}** - Export session check-ins
  - Query params: format (csv/json)
  - Requires: Instructor for session

---

## 🔗 ML Service Integration Points

The following endpoints require calls to the ML service at `http://localhost:8001`:

### 1. Face Enrollment
**Endpoint**: `POST /users/me/face/enroll`
- Call ML: `POST http://localhost:8001/face/enroll`
- Save: `face_embedding_hash` from ML response to users table
- Mark: `face_enrolled = true`

### 2. Face Verification (In Check-in)
**Endpoint**: `POST /checkins/` (when face_match required)
- Call ML: `POST http://localhost:8001/face/verify`
- Input: liveness_challenge_response image + stored face_embedding_hash
- Use score for risk calculation

### 3. Liveness Detection (In Check-in)
**Endpoint**: `POST /checkins/` (when liveness required)
- Call ML: `POST http://localhost:8001/liveness/check`
- Input: liveness_challenge_response image
- Returns: liveness_score (threshold 0.60)

### 4. Risk Assessment (Final step in Check-in)
**Endpoint**: `POST /checkins/` (final calculation)
- Call ML: `POST http://localhost:8001/risk/assess`
- Input: All signals (liveness_score, face_match_score, device_signature, location, IP, user_agent)
- Returns: Overall risk_score and risk_level

---

## 🛡️ Security Features Not Yet Implemented

- [ ] **Rate Limiting** - Redis-based per endpoint
  - Login: 60/hour per IP
  - API: 1000/hour per user
  - Check-in: 10/minute per user
  - Registration: 10/hour per IP

- [ ] **Audit Logging** - Immutable append-only logs for all actions
  - Critical: login_success, login_failed, checkin_attempted, checkin_approved, checkin_flagged, checkin_rejected, checkin_reviewed, checkin_appealed

- [ ] **Data Retention** - Scheduled deletion after 30 days
  - Check-in records: scheduled_deletion_at field
  - User PII after account deletion

- [ ] **Input Validation** - Enhanced validation
  - Coordinate validation: latitude (-90 to 90), longitude (-180 to 180)
  - UUID format validation for path parameters
  - Strict enum validation (roles, session types)
  - ISO8601 timestamp validation

- [ ] **Error Response Codes** - Ensure 422 vs 400 consistency
  - 400: Bad request (logic errors, already exists)
  - 422: Validation error (invalid format, weak password, etc.)

---

## 📋 Important Notes

### Hardcoded Values to Replace
- [x] Mark all hardcoded risk/liveness scores as TODO
- [x] ML service calls currently blocked

### Database Assumptions
- Assumes `users`, `sessions`, `checkins`, `devices`, `enrollments`, `courses`, `audit_logs` tables exist
- May need migrations for new fields (e.g., `scheduled_deletion_at`, audit log fields)

### Environment Variables Needed
- `ML_SERVICE_URL` - Face recognition service (default: http://localhost:8001)
- `REDIS_URL` - For rate limiting (currently not used)
- `MAX_UPLOAD_SIZE` - For image uploads in face enrollment

---

## Priority Roadmap

### Phase 1: Fix Critical Bugs (1-2 days)
1. Fix device registration transact method
2. Implement device attestation service
3. Replace hardcoded risk scores with calculation
4. Fix token response structures

### Phase 2: User & Course Management (2-3 days)
1. User profile update endpoints
2. User listing/filtering (admin)
3. Course CRUD endpoints
4. Course listing with filters

### Phase 3: Session Management (2-3 days)
1. Session CRUD endpoints
2. Session status transitions
3. Session query/filtering

### Phase 4: Check-in Review System (2-3 days)
1. Check-in listing endpoints
2. Check-in appeal system
3. Instructor review endpoints
4. Fix checkin QR/enrollment validation

### Phase 5: Enrollments (1-2 days)
1. Enrollment CRUD
2. Bulk enrollment
3. Course roster

### Phase 6: Statistics & Reporting (2-3 days)
1. Dashboard stats endpoints
2. Export CSV/JSON

### Phase 7: Security & Compliance (2-3 days)
1. Rate limiting middleware
2. Audit logging
3. Data retention cleanup jobs
4. Input validation enhancements

