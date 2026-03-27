async function run() {
    const email = `test${Date.now()}@example.com`;
    const password = 'Password123!';
    
    console.log("Creating user...", email);
    const regRes = await fetch('http://localhost:8000/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, full_name: 'Test' })
    });
    
    console.log("Login user...");
    const loginRes = await fetch('http://localhost:8000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const loginData = await loginRes.json();
    console.log("Login HTTP Status:", loginRes.status);
    console.log("Login Token received?", !!loginData.access_token);
    
    console.log("Registering new device via Bearer Token");
    const devRes = await fetch('http://localhost:8000/api/v1/devices/register', {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${loginData.access_token}`
        },
        body: JSON.stringify({
            device_fingerprint: `direct-script-${Date.now()}`,
            device_name: 'Test Setup',
            platform: 'script'
        })
    });
    
    console.log("Device Reg HTTP Status:", devRes.status);
    console.log("Device Reg Body:", await devRes.text());
}
run();
