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
        console.log("Cleaning up duplicate devices to allow constraint creation...");
        
        // Find duplicates
        const dups = await pool.query(`
            SELECT device_fingerprint, array_agg(id) as ids 
            FROM devices 
            GROUP BY device_fingerprint 
            HAVING count(*) > 1
        `);
        
        console.log("Found duplicates:", dups.rows.length);
        
        if (dups.rows.length > 0) {
            for (const row of dups.rows) {
                const ids = row.ids;
                // Keep the FIRST created device (oldest). Delete the rest.
                const idsToDelete = ids.slice(1);
                console.log("Deleting duplicate IDs for fingerprint", row.device_fingerprint, ":", idsToDelete);
                
                await pool.query(`DELETE FROM devices WHERE id = ANY($1)`, [idsToDelete]);
            }
        }

        console.log("Adding constraint devices_device_fingerprint_key...");
        await pool.query(`ALTER TABLE devices ADD CONSTRAINT devices_device_fingerprint_key UNIQUE(device_fingerprint)`);
        console.log("Constraint added successfully!");
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}
run();
