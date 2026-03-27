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
        console.log("Adding constraint devices_device_fingerprint_key if it does not exist...");
        await pool.query('ALTER TABLE devices ADD CONSTRAINT devices_device_fingerprint_key UNIQUE(device_fingerprint)');
        console.log("Constraint added successfully!");
    } catch (err) {
        if (err.code === '42P16' || err.code === '42710') {
            console.log("Constraint already exists.");
        } else {
            console.error("Error:", err);
        }
    } finally {
        await pool.end();
    }
}
run();
