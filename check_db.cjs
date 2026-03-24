const { Client } = require('pg');

const client = new Client({
    user: 'saiv',
    password: 'saiv_password',
    host: 'localhost',
    port: 5434,
    database: 'saiv'
});

async function main() {
    await client.connect();
    console.log("Connected to DB");
    
    const sessions = await client.query('SELECT id, course_id, venue_latitude, venue_longitude, geofence_radius_meters FROM sessions ORDER BY created_at DESC LIMIT 5');
    console.log("Recent sessions:", sessions.rows);
    
    const checkins = await client.query('SELECT id, session_id, student_id, status, risk_factors, latitude, longitude, distance_from_venue_meters FROM checkins ORDER BY checked_in_at DESC LIMIT 5');
    console.log("Recent checkins:", JSON.stringify(checkins.rows, null, 2));

    await client.end();
}
main().catch(console.error);
