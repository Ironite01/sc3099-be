const { Pool } = require('pg');
const p = new Pool({
  user:'saiv',
  password:'saiv_password',
  database:'saiv',
  host:'127.0.0.1',
  port:5434
});
p.query('SELECT u.email, d.device_fingerprint, d.created_at FROM devices d JOIN users u ON u.id = d.user_id').then(res => {
  console.log(res.rows);
  p.end();
}).catch(console.error);
