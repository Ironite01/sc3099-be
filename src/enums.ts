/**
 * Shared enums for the SAIV backend
 */

// Session status enum
export enum SessionStatus {
    SCHEDULED = 'scheduled',
    ACTIVE = 'active',
    CLOSED = 'closed',
    CANCELLED = 'cancelled'
}

// Session type enum
export enum SessionType {
    LECTURE = 'lecture',
    TUTORIAL = 'tutorial',
    LAB = 'lab',
    EXAM = 'exam'
}

// User role enum
export enum UserRole {
    STUDENT = 'student',
    TA = 'ta',
    INSTRUCTOR = 'instructor',
    ADMIN = 'admin'
}

// Check-in status enum
export enum CheckinStatus {
    PENDING = 'pending',
    APPROVED = 'approved',
    FLAGGED = 'flagged',
    REJECTED = 'rejected',
    APPEALED = 'appealed'
}

// Helper arrays for validation
export const VALID_SESSION_STATUSES = Object.values(SessionStatus);
export const VALID_SESSION_TYPES = Object.values(SessionType);
export const VALID_USER_ROLES = Object.values(UserRole);
export const VALID_CHECKIN_STATUSES = Object.values(CheckinStatus);

// Roles that can be self-registered (excludes admin)
export const SELF_REGISTERABLE_ROLES = [UserRole.STUDENT, UserRole.TA, UserRole.INSTRUCTOR];
