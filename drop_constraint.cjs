const { Pool } = require('pg');

async function run() {
    const pool = new Pool({
        user: 'saiv',
        host: '127.0.0.1',
        database: 'saiv',
        password: 'saiv_password',
        port: 5434,
    });

    try {
        console.log("Dropping constraint devices_device_fingerprint_key if it exists...");
        await pool.query('ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_device_fingerprint_key');
        console.log("Constraint dropped successfully!");
        
        // Let's also verify current constraints
        const res = await pool.query(`
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'devices'::regclass;
        `);
        console.log("Current constraints on devices table:", res.rows.map(r => r.conname));
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}
run();
