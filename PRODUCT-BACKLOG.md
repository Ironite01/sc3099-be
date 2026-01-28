# SAIV Product Backlog

> **Project**: Secure Attendance & Identity Verification (SAIV)  
> **Duration**: 12-14 weeks | **Team Size**: 4 (1 per module)  
> **Total Points**: 130 (90 public + 40 hidden tests)

---

## 🏗️ Module Structure

| Module | Owner | Points |
|--------|-------|--------|
| Module 1: Student Frontend PWA | TBD | ~20 |
| Module 2: Backend API | TBD | ~35 |
| Module 3: Face Recognition Service | TBD | ~25 |
| Module 4: Observability Dashboard | TBD | ~20 |

---

## 📋 Epic 1: Infrastructure & Setup

### 🔧 Backend Setup

| # | User Story | Priority | Repo | Labels |
|---|------------|----------|------|--------|
| 1.1 | As a developer, I want to set up PostgreSQL database with all tables so that the backend can store data | 🔴 Critical | backend | `setup`, `database` |
| 1.2 | As a developer, I want to configure Redis for rate limiting and caching | 🔴 Critical | backend | `setup`, `infrastructure` |
| 1.3 | As a developer, I want to set up Alembic migrations for database schema management | 🟡 High | backend | `setup`, `database` |
| 1.4 | As a developer, I want to configure CORS to allow frontend requests | 🔴 Critical | backend | `setup`, `security` |

### 🎨 Frontend Setup

| # | User Story | Priority | Repo | Labels |
|---|------------|----------|------|--------|
| 1.5 | As a developer, I want to set up Next.js project structure with TypeScript | 🔴 Critical | frontend | `setup` |
| 1.6 | As a developer, I want to configure PWA manifest and service worker for offline capability | 🟡 High | frontend | `setup`, `pwa` |
| 1.7 | As a developer, I want to set up TailwindCSS for styling | 🟡 High | frontend | `setup` |

---

## 📋 Epic 2: Authentication & User Management (Backend)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 2.1 | As a user, I want to register with email/password so I can create an account | 🔴 Critical | 2 | `auth`, `api` |
| 2.2 | As a user, I want to login and receive JWT tokens | 🔴 Critical | 3 | `auth`, `api` |
| 2.3 | As a user, I want to refresh my access token using a refresh token | 🔴 Critical | 2 | `auth`, `api` |
| 2.4 | As a user, I want to view and update my profile | 🟡 High | 2 | `user`, `api` |
| 2.5 | As an admin, I want to list/search users with pagination | 🟡 High | 2 | `admin`, `api` |
| 2.6 | As an admin, I want to activate/deactivate user accounts | 🟡 High | 2 | `admin`, `api` |
| 2.7 | As a user, I want password hashing with bcrypt (cost ≥10) | 🔴 Critical | 1 | `security` |
| 2.8 | As the system, I want role-based access control (student/ta/instructor/admin) | 🔴 Critical | 3 | `security`, `auth` |

---

## 📋 Epic 3: Course Management (Backend)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 3.1 | As an instructor, I want to create courses with venue and geofence settings | 🔴 Critical | 2 | `course`, `api` |
| 3.2 | As a user, I want to list courses with filters (semester, active status) | 🔴 Critical | 2 | `course`, `api` |
| 3.3 | As an instructor, I want to update course details and settings | 🟡 High | 1 | `course`, `api` |
| 3.4 | As an admin, I want to deactivate (soft-delete) courses | 🟡 High | 1 | `course`, `api` |

---

## 📋 Epic 4: Session Management (Backend)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 4.1 | As an instructor, I want to create attendance sessions with check-in windows | 🔴 Critical | 3 | `session`, `api` |
| 4.2 | As a user, I want to list sessions with filters (status, course, date range) | 🔴 Critical | 2 | `session`, `api` |
| 4.3 | As a student, I want to see active sessions I can check into (`/sessions/active`) | 🔴 Critical | 2 | `session`, `api` |
| 4.4 | As a student, I want to see my enrolled sessions (`/sessions/my-sessions`) | 🟡 High | 2 | `session`, `api` |
| 4.5 | As an instructor, I want to update session status (scheduled → active → closed) | 🔴 Critical | 2 | `session`, `api` |
| 4.6 | As an instructor, I want to cancel sessions | 🟢 Medium | 1 | `session`, `api` |

---

## 📋 Epic 5: Enrollment Management (Backend)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 5.1 | As an admin, I want to enroll students in courses | 🔴 Critical | 2 | `enrollment`, `api` |
| 5.2 | As a student, I want to see my enrolled courses | 🔴 Critical | 1 | `enrollment`, `api` |
| 5.3 | As an instructor, I want to see students enrolled in my courses | 🟡 High | 1 | `enrollment`, `api` |
| 5.4 | As an admin, I want to bulk create users for stress tests | 🟡 High | 2 | `admin`, `api` |

---

## 📋 Epic 6: Check-in System (Backend + Face Recognition)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 6.1 | As a student, I want to check into a session with my location | 🔴 Critical | 5 | `checkin`, `api` |
| 6.2 | As the system, I want to validate geolocation against venue geofence | 🔴 Critical | 3 | `checkin`, `security` |
| 6.3 | As the system, I want to calculate distance from venue and risk score | 🔴 Critical | 3 | `checkin`, `risk` |
| 6.4 | As an instructor, I want to list check-ins for a session | 🔴 Critical | 2 | `checkin`, `api` |
| 6.5 | As a student, I want to view my check-in history | 🟡 High | 2 | `checkin`, `api` |
| 6.6 | As an instructor, I want to see flagged check-ins requiring review | 🔴 Critical | 2 | `checkin`, `api` |
| 6.7 | As a student, I want to appeal a rejected/flagged check-in | 🟡 High | 2 | `checkin`, `api` |
| 6.8 | As an instructor, I want to review and approve/reject flagged check-ins | 🔴 Critical | 2 | `checkin`, `api` |

---

## 📋 Epic 7: Device Management (Backend)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 7.1 | As a student, I want to register my device for check-ins | 🔴 Critical | 3 | `device`, `api` |
| 7.2 | As the system, I want to track device fingerprints and trust scores | 🔴 Critical | 2 | `device`, `security` |
| 7.3 | As a student, I want to list and manage my registered devices | 🟡 High | 1 | `device`, `api` |
| 7.4 | As an admin, I want to revoke suspicious devices | 🟡 High | 1 | `device`, `admin` |

---

## 📋 Epic 8: Face Recognition Service (Module 3)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 8.1 | As a user, I want to enroll my face for identity verification | 🔴 Critical | 3 | `face`, `privacy` |
| 8.2 | As the system, I want to perform liveness detection (blink, head pose) | 🔴 Critical | 4 | `face`, `liveness` |
| 8.3 | As the system, I want to match faces against enrolled embeddings | 🔴 Critical | 3 | `face`, `matching` |
| 8.4 | As the system, I want to calculate face-based risk signals | 🟡 High | 3 | `face`, `risk` |
| 8.5 | As the system, I want to detect anti-spoofing attacks (deepfakes, replays) | 🟡 High | 3 | `face`, `security` |
| 8.6 | As the privacy officer, I want to ensure NO raw face images are stored | 🔴 Critical | 2 | `face`, `privacy` |

---

## 📋 Epic 9: Risk Assessment (Backend + Face Recognition)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 9.1 | As the system, I want to detect GPS spoofing attempts | 🔴 Critical | 2 | `risk`, `security` |
| 9.2 | As the system, I want to detect VPN/proxy/Tor usage | 🟡 High | 2 | `risk`, `security` |
| 9.3 | As the system, I want to detect impossible travel patterns | 🟡 High | 2 | `risk`, `security` |
| 9.4 | As the system, I want to detect emulator/rooted device usage | 🟡 High | 2 | `risk`, `security` |
| 9.5 | As the system, I want to combine risk signals into overall risk score | 🔴 Critical | 3 | `risk` |

---

## 📋 Epic 10: Student Frontend PWA (Module 1)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 10.1 | As a student, I want a login/register page | 🔴 Critical | 2 | `frontend`, `auth` |
| 10.2 | As a student, I want to see my dashboard with enrolled courses | 🔴 Critical | 2 | `frontend`, `ui` |
| 10.3 | As a student, I want to see active sessions I can check into | 🔴 Critical | 2 | `frontend`, `session` |
| 10.4 | As a student, I want to grant camera/location permissions with consent | 🔴 Critical | 2 | `frontend`, `privacy` |
| 10.5 | As a student, I want to capture my face for check-in with WebRTC | 🔴 Critical | 3 | `frontend`, `camera` |
| 10.6 | As a student, I want to complete liveness challenges (blink, head turn) | 🔴 Critical | 3 | `frontend`, `liveness` |
| 10.7 | As a student, I want to share my GPS location for check-in | 🔴 Critical | 2 | `frontend`, `geolocation` |
| 10.8 | As a student, I want to view my check-in history and attendance | 🟡 High | 2 | `frontend`, `ui` |
| 10.9 | As a student, I want to enroll my face during onboarding | 🔴 Critical | 2 | `frontend`, `face` |
| 10.10 | As a student, I want the app to work offline (PWA) | 🟡 High | 2 | `frontend`, `pwa` |

---

## 📋 Epic 11: Instructor Dashboard (Module 4)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 11.1 | As an instructor, I want to see an overview dashboard with key stats | 🔴 Critical | 3 | `dashboard`, `stats` |
| 11.2 | As an instructor, I want to view real-time check-in status for active sessions | 🔴 Critical | 3 | `dashboard`, `realtime` |
| 11.3 | As an instructor, I want to review flagged check-ins with risk details | 🔴 Critical | 2 | `dashboard`, `review` |
| 11.4 | As an instructor, I want to export attendance data as CSV | 🟡 High | 2 | `dashboard`, `export` |
| 11.5 | As an instructor, I want to view attendance trends and analytics | 🟡 High | 2 | `dashboard`, `analytics` |
| 11.6 | As an admin, I want to explore audit logs | 🟡 High | 2 | `dashboard`, `audit` |

---

## 📋 Epic 12: Observability & Monitoring (Module 4)

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 12.1 | As an operator, I want Prometheus metrics exposed from all services | 🟡 High | 2 | `observability` |
| 12.2 | As an operator, I want Grafana dashboards for system health | 🟡 High | 2 | `observability` |
| 12.3 | As the system, I want to create immutable audit logs for all actions | 🔴 Critical | 3 | `audit`, `security` |

---

## 📋 Epic 13: Security & Privacy

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 13.1 | As the system, I want rate limiting to prevent brute force attacks | 🔴 Critical | 2 | `security` |
| 13.2 | As the system, I want input validation to prevent SQL injection | 🔴 Critical | 2 | `security` |
| 13.3 | As the system, I want to prevent XSS attacks | 🔴 Critical | 1 | `security` |
| 13.4 | As the privacy officer, I want PII auto-deletion after 30 days | 🟡 High | 2 | `privacy` |
| 13.5 | As the privacy officer, I want consent tracking for camera/geolocation | 🔴 Critical | 1 | `privacy` |

---

## 📋 Epic 14: Testing & Integration

| # | User Story | Priority | Points | Labels |
|---|------------|----------|--------|--------|
| 14.1 | As a developer, I want all public tests to pass (90 points) | 🔴 Critical | - | `testing` |
| 14.2 | As a developer, I want end-to-end check-in flow to work | 🔴 Critical | 4 | `testing`, `integration` |
| 14.3 | As a developer, I want performance tests to pass (latency, concurrency) | 🟡 High | 5 | `testing`, `performance` |

---

## 🎯 Suggested Sprint Plan

### Sprint 1 (Weeks 1-2): Foundation
- [ ] Epic 1: Infrastructure & Setup
- [ ] Epic 2: Authentication (items 2.1-2.4)
- [ ] Face Recognition: Health endpoint + basic setup

### Sprint 2 (Weeks 3-4): Core CRUD
- [ ] Epic 3: Course Management
- [ ] Epic 4: Session Management
- [ ] Epic 5: Enrollment Management
- [ ] Frontend: Login/Register pages

### Sprint 3 (Weeks 5-6): Check-in Core
- [ ] Epic 6: Check-in System (items 6.1-6.4)
- [ ] Epic 7: Device Management
- [ ] Frontend: Check-in flow with GPS

### Sprint 4 (Weeks 7-8): Face Recognition
- [ ] Epic 8: Face Recognition Service
- [ ] Frontend: Camera capture + liveness UI

### Sprint 5 (Weeks 9-10): Risk & Review
- [ ] Epic 9: Risk Assessment
- [ ] Epic 6: Check-in Review (items 6.5-6.8)
- [ ] Dashboard: Overview + Review UI

### Sprint 6 (Weeks 11-12): Polish & Testing
- [ ] Epic 10: PWA features
- [ ] Epic 11-12: Dashboard & Observability
- [ ] Epic 13: Security hardening
- [ ] Epic 14: Full test suite pass

---

## 📝 GitHub Labels to Create

| Label | Color | Description |
|-------|-------|-------------|
| `backend` | #0052CC | Backend API module |
| `frontend` | #36B37E | Frontend PWA module |
| `face` | #6554C0 | Face recognition module |
| `dashboard` | #00B8D9 | Dashboard module |
| `auth` | #FF5630 | Authentication related |
| `security` | #FF5630 | Security requirement |
| `privacy` | #FFAB00 | Privacy requirement |
| `api` | #0052CC | API endpoint |
| `setup` | #97A0AF | Infrastructure setup |
| `priority-critical` | #FF0000 | Must have |
| `priority-high` | #FF7700 | Should have |
| `priority-medium` | #FFCC00 | Nice to have |

---

## 📊 Test Points Reference

| Test File | Points | Related Epics |
|-----------|--------|---------------|
| test_api_functional.py | 26 | Epic 2-7 |
| test_face_recognition.py | 15 | Epic 8 |
| test_security_basic.py | 12 | Epic 13 |
| test_privacy_basic.py | 8 | Epic 8, 13 |
| test_frontend_dashboard.py | 8 | Epic 10, 11 |
| test_observability.py | 12 | Epic 11, 12 |
| test_performance.py | 5 | Epic 14 |
| test_integration.py | 4 | Epic 14 |
