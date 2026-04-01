import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import * as bcrypt from 'bcrypt';
import { SALT_ROUNDS } from '../helpers/constants.js';
import { USER_ROLE_TYPES } from '../model/user.js';

async function schemaBootstrap(fastify: FastifyInstance) {
    const pgClient = await (fastify as any).pg.connect();
    try {
        // Needed for gen_random_uuid() used throughout inserts.
        await pgClient.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                full_name TEXT NOT NULL,
                hashed_password TEXT NOT NULL,
                role TEXT NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                face_embedding_hash TEXT,
                camera_consent BOOLEAN NOT NULL DEFAULT FALSE,
                geolocation_consent BOOLEAN NOT NULL DEFAULT FALSE,
                face_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_login_at TIMESTAMPTZ
            )
        `);

        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT,
                semester TEXT NOT NULL,
                instructor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                venue_latitude DOUBLE PRECISION,
                venue_longitude DOUBLE PRECISION,
                venue_name TEXT,
                geofence_radius_meters DOUBLE PRECISION NOT NULL DEFAULT 100,
                require_face_recognition BOOLEAN NOT NULL DEFAULT FALSE,
                require_device_binding BOOLEAN NOT NULL DEFAULT TRUE,
                risk_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.5,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                instructor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                name TEXT NOT NULL,
                session_type TEXT NOT NULL DEFAULT 'other',
                description TEXT,
                scheduled_start TIMESTAMPTZ NOT NULL,
                scheduled_end TIMESTAMPTZ NOT NULL,
                checkin_opens_at TIMESTAMPTZ NOT NULL,
                checkin_closes_at TIMESTAMPTZ NOT NULL,
                status TEXT NOT NULL DEFAULT 'scheduled',
                actual_start TIMESTAMPTZ,
                actual_end TIMESTAMPTZ,
                venue_latitude DOUBLE PRECISION,
                venue_longitude DOUBLE PRECISION,
                venue_name TEXT,
                geofence_radius_meters DOUBLE PRECISION,
                require_liveness_check BOOLEAN,
                require_face_match BOOLEAN,
                risk_threshold DOUBLE PRECISION,
                qr_code_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                qr_code_secret TEXT,
                qr_code_expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pgClient.query(`
            ALTER TABLE sessions
            ADD COLUMN IF NOT EXISTS qr_code_enabled BOOLEAN NOT NULL DEFAULT FALSE
        `);

        await pgClient.query(`
            UPDATE sessions
            SET qr_code_enabled = TRUE
            WHERE qr_code_enabled = FALSE
              AND (qr_code_secret IS NOT NULL OR qr_code_expires_at IS NOT NULL)
        `);

        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS enrollments (
                id TEXT PRIMARY KEY,
                student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                dropped_at TIMESTAMPTZ,
                UNIQUE(student_id, course_id)
            )
        `);

        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS checkins (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status TEXT NOT NULL DEFAULT 'approved',
                checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                latitude DOUBLE PRECISION NOT NULL,
                longitude DOUBLE PRECISION NOT NULL,
                distance_from_venue_meters DOUBLE PRECISION NOT NULL,
                liveness_passed BOOLEAN NOT NULL DEFAULT FALSE,
                liveness_score DOUBLE PRECISION,
                risk_score DOUBLE PRECISION,
                risk_factors JSONB NOT NULL DEFAULT '[]'::jsonb,
                UNIQUE(session_id, student_id)
            )
        `);

        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                action TEXT NOT NULL,
                resource_type TEXT,
                resource_id TEXT,
                ip_address TEXT,
                user_agent TEXT,
                device_id TEXT,
                details TEXT,
                success BOOLEAN NOT NULL DEFAULT TRUE,
                timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_courses_instructor_id ON courses(instructor_id)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_sessions_course_id ON sessions(course_id)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_sessions_status_checkin_close ON sessions(status, checkin_closes_at)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_enrollments_student_id ON enrollments(student_id)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_enrollments_course_active ON enrollments(course_id, is_active)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_checkins_session_id ON checkins(session_id)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_checkins_student_id ON checkins(student_id)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_checkins_checked_in_at ON checkins(checked_in_at)`);
        await pgClient.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)`);

        // Seed a default admin for local/dev convenience if missing.
        const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
        const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin123';
        const adminName = process.env.SEED_ADMIN_NAME || 'System Admin';

        const adminCheck = await pgClient.query(
            'SELECT id FROM users WHERE email = $1 LIMIT 1',
            [adminEmail]
        );

        if (!adminCheck.rows.length) {
            const hashed = bcrypt.hashSync(adminPassword, SALT_ROUNDS);
            await pgClient.query(
                `INSERT INTO users (
                    id, email, full_name, hashed_password, role, is_active,
                    face_embedding_hash, camera_consent, geolocation_consent, face_enrolled,
                    created_at, updated_at
                ) VALUES (
                    gen_random_uuid()::text, $1, $2, $3, $4, TRUE,
                    'seeded', FALSE, FALSE, FALSE,
                    NOW(), NOW()
                )`,
                [adminEmail, adminName, hashed, USER_ROLE_TYPES.ADMIN]
            );
            fastify.log.info(`[schema] Seeded default admin user: ${adminEmail}`);
        }

        fastify.log.info('[schema] Core tables ensured');
    } finally {
        pgClient.release();
    }
}

export default fp(schemaBootstrap);
