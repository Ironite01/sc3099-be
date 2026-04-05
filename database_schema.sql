-- SAIV Database Schema
-- Generated from DATABASE-SCHEMA.md

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE user_role AS ENUM ('student', 'instructor', 'ta', 'admin');
CREATE TYPE session_status AS ENUM ('scheduled', 'active', 'closed', 'cancelled');
CREATE TYPE checkin_status AS ENUM ('pending', 'approved', 'flagged', 'rejected', 'appealed');
CREATE TYPE risk_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE risk_signal_type AS ENUM (
    'geo_out_of_bounds', 'impossible_travel', 'geo_accuracy_low',
    'vpn_detected', 'proxy_detected', 'tor_detected', 'suspicious_ip',
    'device_unknown', 'device_emulator', 'device_rooted', 'attestation_failed',
    'rapid_succession', 'unusual_time', 'pattern_anomaly',
    'liveness_failed', 'liveness_low_confidence', 'deepfake_suspected', 'replay_suspected',
    'face_match_failed', 'face_match_low_confidence'
);
-- Using VARCHAR for audit actions as the list in spec is open-ended ('etc')
-- But creating a type for the explicitly listed ones if strict strictness is desired.
-- For now, sticking to the spec which says ENUM, but assuming the list provided is the initial set.
CREATE TYPE audit_action AS ENUM (
    'login_success', 'login_failed', 'logout', 'user_created',
    'checkin_attempted', 'checkin_approved', 'checkin_rejected',
    'data_exported', 'security_violation', 'user_updated', 'checkin_flagged',
    'checkin_appealed', 'checkin_reviewed', 'session_created', 'session_updated',
    'session_deleted', 'enrollment_added', 'enrollment_removed', 'device_registered',
    'face_enrolled'
);

-- =============================================================================
-- TABLES
-- =============================================================================

-- 1. Users
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY, -- UUID
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    role user_role NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    camera_consent BOOLEAN DEFAULT FALSE,
    geolocation_consent BOOLEAN DEFAULT FALSE,
    face_embedding_hash VARCHAR(64), -- SHA-256
    face_enrolled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    last_login_at TIMESTAMP,
    scheduled_deletion_at TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_is_active ON users(is_active);

-- 2. Courses
CREATE TABLE courses (
    id VARCHAR(36) PRIMARY KEY, -- UUID
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    semester VARCHAR(20) NOT NULL,
    instructor_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    venue_latitude FLOAT,
    venue_longitude FLOAT,
    venue_name VARCHAR(255),
    geofence_radius_meters FLOAT DEFAULT 100.0,
    require_face_recognition BOOLEAN DEFAULT FALSE,
    require_device_binding BOOLEAN DEFAULT TRUE,
    risk_threshold FLOAT DEFAULT 0.5,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_courses_code ON courses(code);
CREATE INDEX idx_courses_semester ON courses(semester);
CREATE INDEX idx_courses_is_active ON courses(is_active);
CREATE INDEX idx_courses_instructor_id ON courses(instructor_id);

-- 3. Enrollments
CREATE TABLE enrollments (
    id VARCHAR(36) PRIMARY KEY, -- UUID
    student_id VARCHAR(36) NOT NULL REFERENCES users(id),
    course_id VARCHAR(36) NOT NULL REFERENCES courses(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    enrolled_at TIMESTAMP NOT NULL,
    dropped_at TIMESTAMP,
    UNIQUE(student_id, course_id)
);

CREATE INDEX idx_enrollments_student_id ON enrollments(student_id);
CREATE INDEX idx_enrollments_course_id ON enrollments(course_id);

-- 4. Sessions
CREATE TABLE sessions (
    id VARCHAR(36) PRIMARY KEY, -- UUID
    course_id VARCHAR(36) NOT NULL REFERENCES courses(id),
    instructor_id VARCHAR(36) REFERENCES users(id),
    name VARCHAR(255) NOT NULL,
    session_type VARCHAR(50) DEFAULT 'lecture',
    description TEXT,
    scheduled_start TIMESTAMP NOT NULL,
    scheduled_end TIMESTAMP NOT NULL,
    checkin_opens_at TIMESTAMP NOT NULL,
    checkin_closes_at TIMESTAMP NOT NULL,
    status session_status NOT NULL,
    actual_start TIMESTAMP,
    actual_end TIMESTAMP,
    venue_latitude FLOAT,
    venue_longitude FLOAT,
    venue_name VARCHAR(255),
    geofence_radius_meters FLOAT,
    require_liveness_check BOOLEAN DEFAULT TRUE,
    require_face_match BOOLEAN DEFAULT FALSE,
    risk_threshold FLOAT,
    qr_code_secret VARCHAR(64),
    qr_code_expires_at TIMESTAMP,
    qr_code_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_sessions_course_id ON sessions(course_id);
CREATE INDEX idx_sessions_instructor_id ON sessions(instructor_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_scheduled_start ON sessions(scheduled_start);
CREATE INDEX idx_sessions_checkin_window ON sessions(checkin_opens_at, checkin_closes_at);

-- 5. Devices
CREATE TABLE devices (
    id VARCHAR(36) PRIMARY KEY, -- UUID
    user_id VARCHAR(36) NOT NULL REFERENCES users(id),
    device_fingerprint VARCHAR(64) UNIQUE NOT NULL,
    device_name VARCHAR(255),
    platform VARCHAR(50),
    browser VARCHAR(100),
    os_version VARCHAR(50),
    app_version VARCHAR(50),
    public_key TEXT NOT NULL,
    public_key_created_at TIMESTAMP NOT NULL,
    public_key_expires_at TIMESTAMP,
    attestation_passed BOOLEAN DEFAULT FALSE,
    last_attestation_at TIMESTAMP,
    attestation_token TEXT,
    is_trusted BOOLEAN DEFAULT FALSE,
    trust_score VARCHAR(20) DEFAULT 'low',
    is_emulator BOOLEAN DEFAULT FALSE,
    is_rooted_jailbroken BOOLEAN DEFAULT FALSE,
    first_seen_at TIMESTAMP NOT NULL,
    last_seen_at TIMESTAMP NOT NULL,
    total_checkins INTEGER DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    revoked_at TIMESTAMP,
    revocation_reason TEXT
);

CREATE INDEX idx_devices_user_id ON devices(user_id);
CREATE INDEX idx_devices_fingerprint ON devices(device_fingerprint);
CREATE INDEX idx_devices_is_active ON devices(is_active);
CREATE INDEX idx_devices_is_trusted ON devices(is_trusted);

-- 6. CheckIns
CREATE TABLE checkins (
    id VARCHAR(36) PRIMARY KEY, -- UUID
    session_id VARCHAR(36) NOT NULL REFERENCES sessions(id),
    student_id VARCHAR(36) NOT NULL REFERENCES users(id),
    device_id VARCHAR(36) REFERENCES devices(id),
    status checkin_status NOT NULL,
    checked_in_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    latitude FLOAT,
    longitude FLOAT,
    location_accuracy_meters FLOAT,
    distance_from_venue_meters FLOAT,
    liveness_passed BOOLEAN,
    liveness_score FLOAT,
    liveness_challenge_type VARCHAR(50),
    face_match_passed BOOLEAN,
    face_match_score FLOAT,
    face_embedding_hash VARCHAR(64),
    risk_score FLOAT NOT NULL DEFAULT 0.0,
    risk_factors TEXT, -- JSON array
    qr_code_verified BOOLEAN DEFAULT FALSE,
    reviewed_by_id VARCHAR(36) REFERENCES users(id),
    reviewed_at TIMESTAMP,
    review_notes TEXT,
    appeal_reason TEXT,
    appealed_at TIMESTAMP,
    scheduled_deletion_at TIMESTAMP,
    UNIQUE(session_id, student_id)
);

CREATE INDEX idx_checkins_session_id ON checkins(session_id);
CREATE INDEX idx_checkins_student_id ON checkins(student_id);
CREATE INDEX idx_checkins_status ON checkins(status);
CREATE INDEX idx_checkins_checked_in_at ON checkins(checked_in_at);
CREATE INDEX idx_checkins_risk_score ON checkins(risk_score);

-- 7. Risk Signals
CREATE TABLE risk_signals (
    id VARCHAR(36) PRIMARY KEY, -- UUID
    checkin_id VARCHAR(36) NOT NULL REFERENCES checkins(id),
    signal_type risk_signal_type NOT NULL,
    severity risk_severity NOT NULL,
    confidence FLOAT NOT NULL DEFAULT 1.0,
    details TEXT, -- JSON metadata
    weight FLOAT NOT NULL DEFAULT 0.1,
    detected_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_risk_signals_checkin_id ON risk_signals(checkin_id);
CREATE INDEX idx_risk_signals_type ON risk_signals(signal_type);
CREATE INDEX idx_risk_signals_severity ON risk_signals(severity);
CREATE INDEX idx_risk_signals_detected_at ON risk_signals(detected_at);

-- 8. Audit Logs
CREATE TABLE audit_logs (
    id VARCHAR(36) PRIMARY KEY, -- UUID
    user_id VARCHAR(36) REFERENCES users(id),
    action audit_action NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(36),
    ip_address VARCHAR(45),
    user_agent VARCHAR(500),
    device_id VARCHAR(36), -- No foreign key enforced to allow logs for deleted devices
    details TEXT, -- JSON details
    success BOOLEAN DEFAULT TRUE,
    timestamp TIMESTAMP NOT NULL
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_ip ON audit_logs(ip_address);
