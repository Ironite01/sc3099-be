import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

// Parse URI to properly handle custom ports (e.g. 127.0.0.1:5434)
const uri = process.env.POSTGRES_URI || '127.0.0.1';
const [host, port] = uri.split(':');

const client = new Client({
    user: process.env.POSTGRES_USERNAME || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'capstone',
    host: host,
    port: port ? parseInt(port, 10) : 5432,
    database: process.env.POSTGRES_DB || 'postgres'
});

async function run() {
    await client.connect();
    try {
        // Update audit_action enum to include all new actions
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'user_updated';
        `);
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'checkin_flagged';
        `);
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'checkin_appealed';
        `);
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'checkin_reviewed';
        `);
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'session_created';
        `);
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'session_updated';
        `);
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'session_deleted';
        `);
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'enrollment_added';
        `);
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'enrollment_removed';
        `);
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'device_registered';
        `);
        await client.query(`
            ALTER TYPE audit_action ADD VALUE IF NOT EXISTS 'face_enrolled';
        `);

        await client.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS instructor_id TEXT REFERENCES users(id) ON DELETE SET NULL;');
        await client.query('CREATE INDEX IF NOT EXISTS idx_courses_instructor_id ON courses(instructor_id);');

        await client.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS instructor_id TEXT REFERENCES users(id) ON DELETE SET NULL;');
        await client.query('CREATE INDEX IF NOT EXISTS idx_sessions_instructor_id ON sessions(instructor_id);');
        await client.query('ALTER TABLE sessions ADD COLUMN IF NOT EXISTS qr_code_enabled BOOLEAN NOT NULL DEFAULT FALSE;');

        console.log("Migration successful: updated audit_action enum and added instructor_id/qr_code_enabled to courses and sessions");
    } catch (e) {
        console.error("Migration failed", e);
    } finally {
        await client.end();
    }
}
run();
