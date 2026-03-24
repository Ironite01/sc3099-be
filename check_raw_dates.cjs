const { Pool } = require('pg');

const pool = new Pool({
    connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/sc3099",
});

async function check() {
    try {
        const res = await pool.query('SELECT device_fingerprint, first_seen_at, last_seen_at FROM devices LIMIT 5');
        console.log('Raw DB values:');
        console.log(JSON.stringify(res.rows, null, 2));
    } finally {
        await pool.end();
    }
}

check();
