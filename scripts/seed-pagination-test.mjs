import { PrismaClient } from '../src/generated/prisma/client.js';
import { randomUUID } from 'node:crypto';

const API = 'http://localhost:8000/api/v1';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin123';
const PREFIX = 'PAGINATION_TEST';
const STUDENT_PREFIX = 'pagination_student_';
const TARGET = 300;

const prisma = new PrismaClient();

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, options);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}

async function main() {
  const login = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  const authHeaders = {
    Authorization: `Bearer ${login.access_token}`,
    'Content-Type': 'application/json'
  };

  const courses = await api('/courses/?is_active=true&limit=50&offset=0', { headers: { Authorization: authHeaders.Authorization } });
  const users = await api('/users/?role=instructor&is_active=true&limit=50&offset=0', { headers: { Authorization: authHeaders.Authorization } });
  const courseId = courses?.items?.[0]?.id;
  const instructorId = users?.items?.[0]?.id;
  if (!courseId || !instructorId) throw new Error('Missing active course or instructor');

  // 1) Ensure 300 pagination test sessions exist
  let offset = 0;
  const pageSize = 200;
  let allSessions = [];
  while (true) {
    const page = await api(`/sessions/?limit=${pageSize}&offset=${offset}`, { headers: { Authorization: authHeaders.Authorization } });
    const items = page.items || [];
    if (!items.length) break;
    allSessions = allSessions.concat(items);
    if (items.length < pageSize || allSessions.length >= page.total) break;
    offset += pageSize;
  }
  const existingNames = new Set(allSessions.map(s => s.name));

  const sessionsToCreate = [];
  for (let i = 1; i <= TARGET; i++) {
    const name = `${PREFIX}_SESSION_${String(i).padStart(3, '0')}`;
    if (!existingNames.has(name)) {
      const start = new Date(Date.now() + (i + 600) * 60000);
      const end = new Date(start.getTime() + 60 * 60000);
      const open = new Date(start.getTime() - 15 * 60000);
      const close = new Date(start.getTime() + 30 * 60000);
      sessionsToCreate.push({
        course_id: courseId,
        instructor_id: instructorId,
        name,
        session_type: 'lecture',
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        checkin_opens_at: open.toISOString(),
        checkin_closes_at: close.toISOString(),
        venue_name: 'Pagination Lab',
        venue_latitude: 1.3483,
        venue_longitude: 103.6831,
        geofence_radius_meters: 100,
        require_liveness_check: false,
        require_face_match: false,
        risk_threshold: 0.5,
        qr_code_enabled: false
      });
    }
  }

  for (const payload of sessionsToCreate) {
    await api('/sessions/', { method: 'POST', headers: authHeaders, body: JSON.stringify(payload) });
  }

  // Re-fetch all pagination test sessions IDs (first 300)
  offset = 0;
  allSessions = [];
  while (true) {
    const page = await api(`/sessions/?limit=${pageSize}&offset=${offset}`, { headers: { Authorization: authHeaders.Authorization } });
    const items = page.items || [];
    if (!items.length) break;
    allSessions = allSessions.concat(items);
    if (items.length < pageSize || allSessions.length >= page.total) break;
    offset += pageSize;
  }
  const testSessions = allSessions
    .filter(s => String(s.name || '').startsWith(`${PREFIX}_SESSION_`))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, TARGET);

  if (testSessions.length < TARGET) throw new Error(`Expected ${TARGET} sessions, got ${testSessions.length}`);

  // 2) Ensure 300 pagination test students exist
  const bulkUsers = [];
  for (let i = 1; i <= TARGET; i++) {
    bulkUsers.push({
      email: `${STUDENT_PREFIX}${String(i).padStart(3, '0')}@test.local`,
      password: 'Password123!',
      full_name: `Pagination Student ${String(i).padStart(3, '0')}`,
      role: 'student'
    });
  }
  try {
    await api('/admin/users/bulk', { method: 'POST', headers: authHeaders, body: JSON.stringify({ users: bulkUsers }) });
  } catch (e) {
    // Duplicates are fine across reruns; proceed to fetch by email prefix.
  }

  // Fetch all matching students from /users with pagination
  offset = 0;
  let allStudents = [];
  while (true) {
    const page = await api(`/users/?role=student&limit=100&offset=${offset}`, { headers: { Authorization: authHeaders.Authorization } });
    const items = page.items || [];
    if (!items.length) break;
    allStudents = allStudents.concat(items);
    if (items.length < 100 || allStudents.length >= page.total) break;
    offset += 100;
  }
  const testStudents = allStudents
    .filter(u => String(u.email || '').startsWith(STUDENT_PREFIX))
    .sort((a, b) => String(a.email).localeCompare(String(b.email)))
    .slice(0, TARGET);

  if (testStudents.length < TARGET) throw new Error(`Expected ${TARGET} students, got ${testStudents.length}`);

  // 3) Insert 300 flagged check-ins (idempotent by session_id+student_id)
  const pairs = [];
  for (let i = 0; i < TARGET; i++) {
    pairs.push({
      session_id: testSessions[i].id,
      student_id: testStudents[i].id
    });
  }

  const existingCheckins = await prisma.checkins.findMany({
    where: {
      OR: pairs.map(p => ({ session_id: p.session_id, student_id: p.student_id }))
    },
    select: { session_id: true, student_id: true }
  });
  const existingPairSet = new Set(existingCheckins.map(c => `${c.session_id}::${c.student_id}`));

  const now = new Date();
  const toInsert = [];
  for (const p of pairs) {
    const key = `${p.session_id}::${p.student_id}`;
    if (existingPairSet.has(key)) continue;
    toInsert.push({
      id: randomUUID(),
      session_id: p.session_id,
      student_id: p.student_id,
      status: 'flagged',
      checked_in_at: now,
      latitude: 1.3483,
      longitude: 103.6831,
      location_accuracy_meters: 10,
      distance_from_venue_meters: 20,
      liveness_passed: true,
      liveness_score: 0.95,
      risk_score: 0.62,
      risk_factors: JSON.stringify([{ type: 'pagination_test', weight: 0.62 }]),
      qr_code_verified: false
    });
  }

  if (toInsert.length) {
    await prisma.checkins.createMany({ data: toInsert });
  }

  // Verify counts
  const sessionsTotal = (await api('/sessions/?limit=1&offset=0', { headers: { Authorization: authHeaders.Authorization } })).total;
  const flaggedTotal = (await api('/checkins/flagged?limit=1&offset=0', { headers: { Authorization: authHeaders.Authorization } })).total;

  console.log(JSON.stringify({
    created_sessions: sessionsToCreate.length,
    test_sessions_available: testSessions.length,
    test_students_available: testStudents.length,
    inserted_flagged_checkins: toInsert.length,
    sessions_total_after: sessionsTotal,
    flagged_total_after: flaggedTotal
  }, null, 2));
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

