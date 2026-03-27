const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
    host: '127.0.0.1',
    port: 5434,
    user: 'saiv',
    password: 'saiv_password',
    database: 'saiv',
});

async function check() {
    const client = await pool.connect();
    try {
        // 1. Check PostgreSQL timezone
        const tz = await client.query('SHOW TIMEZONE');
        const now = await client.query('SELECT NOW() as now_val, CURRENT_TIMESTAMP as current_ts');
        
        // 2. Check raw device data
        const raw = await client.query('SELECT id, first_seen_at, last_seen_at FROM devices ORDER BY last_seen_at DESC LIMIT 1');
        
        // 3. Check with AT TIME ZONE conversion
        const converted = await client.query(`
            SELECT 
                first_seen_at as raw_first,
                first_seen_at AT TIME ZONE 'Asia/Singapore' as atz_first,
                TO_CHAR(first_seen_at AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS tochar_first
            FROM devices 
            ORDER BY last_seen_at DESC LIMIT 1
        `);

        const output = [];
        output.push('=== PostgreSQL Timezone ===');
        output.push('SHOW TIMEZONE: ' + JSON.stringify(tz.rows[0]));
        output.push('NOW(): ' + JSON.stringify(now.rows[0]));
        output.push('');
        output.push('=== Raw Device Data (pg driver output) ===');
        if (raw.rows[0]) {
            const r = raw.rows[0];
            output.push('first_seen_at typeof: ' + typeof r.first_seen_at);
            output.push('first_seen_at value: ' + String(r.first_seen_at));
            output.push('first_seen_at toISOString: ' + (r.first_seen_at instanceof Date ? r.first_seen_at.toISOString() : 'NOT A DATE'));
            output.push('last_seen_at typeof: ' + typeof r.last_seen_at);
            output.push('last_seen_at value: ' + String(r.last_seen_at));
        } else {
            output.push('No devices found');
        }
        output.push('');
        output.push('=== Converted Values ===');
        if (converted.rows[0]) {
            const c = converted.rows[0];
            output.push('raw_first typeof: ' + typeof c.raw_first);
            output.push('raw_first value: ' + String(c.raw_first));
            output.push('atz_first typeof: ' + typeof c.atz_first);
            output.push('atz_first value: ' + String(c.atz_first));
            output.push('tochar_first typeof: ' + typeof c.tochar_first);
            output.push('tochar_first value: ' + String(c.tochar_first));
        }
        
        const result = output.join('\n');
        fs.writeFileSync('tz_test_output.txt', result, 'utf8');
        console.log(result);
    } catch (err) {
        console.error('ERROR:', err.message);
        fs.writeFileSync('tz_test_output.txt', 'ERROR: ' + err.message, 'utf8');
    } finally {
        client.release();
        await pool.end();
    }
}

check();
