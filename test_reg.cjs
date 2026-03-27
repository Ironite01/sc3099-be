const fetch = require('node-fetch'); // we'll use native fetch in node 20
async function run() {
    console.log("Creating user...");
    const regRes = await fetch('http://localhost:8000/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `test${Date.now()}@example.com`, password: 'Password123!', full_name: 'Test' })
    });
    
    console.log("Login user...");
    const loginRes = await fetch('http://localhost:8000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: `test${Date.now()}@example.com`, password: 'Password123!' }) // Note: wrong email, need to store
    });
}
run();
