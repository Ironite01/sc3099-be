import { Client } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const client = new Client({
    user: process.env.POSTGRES_USERNAME || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'capstone',
    host: process.env.POSTGRES_URI || '127.0.0.1',
    port: 5432,
    database: process.env.POSTGRES_DB || 'postgres'
});

async function run() {
    await client.connect();
    try {
        await client.query('ALTER TABLE courses ADD COLUMN IF NOT EXISTS instructor_id TEXT REFERENCES users(id) ON DELETE SET NULL;');
        await client.query('CREATE INDEX IF NOT EXISTS idx_courses_instructor_id ON courses(instructor_id);');
        console.log("Migration successful: added instructor_id to courses");
    } catch (e) {
        console.error("Migration failed", e);
    } finally {
        await client.end();
    }
}
run();
