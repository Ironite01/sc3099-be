import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { SessionStatus, VALID_SESSION_STATUSES } from '../enums.js';

interface SessionCreateBody {
    course_id: string;
    instructor_id?: string;
    name: string;
    session_type?: string;
    description?: string;
    scheduled_start: string;
    scheduled_end: string;
    checkin_opens_at?: string;
    checkin_closes_at?: string;
    venue_name?: string;
    venue_latitude?: number;
    venue_longitude?: number;
    geofence_radius_meters?: number;
    require_liveness_check?: boolean;
    require_face_match?: boolean;
    risk_threshold?: number;
}

interface SessionUpdateBody {
    name?: string;
    description?: string;
    status?: SessionStatus;
    scheduled_start?: string;
    scheduled_end?: string;
    checkin_opens_at?: string;
    checkin_closes_at?: string;
    venue_name?: string;
    venue_latitude?: number;
    venue_longitude?: number;
    geofence_radius_meters?: number;
    require_liveness_check?: boolean;
    require_face_match?: boolean;
    risk_threshold?: number;
}

interface SessionListQuery {
    status?: string;
    course_id?: string;
    instructor_id?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
}

async function sessionController(fastify: FastifyInstance) {
    const baseUri = '/api/v1/sessions';
    const adminUri = '/api/v1/admin/sessions';

    // GET /sessions/ - List all sessions with filters (instructor/admin)
    fastify.get(baseUri + '/', async (req: FastifyRequest<{ Querystring: SessionListQuery }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { status, course_id, instructor_id, start_date, end_date, limit = 50, offset = 0 } = req.query;

            let query = `
                SELECT s.*, c.code as course_code, c.name as course_name,
                       u.full_name as instructor_name,
                       COALESCE((SELECT COUNT(*) FROM enrollments e WHERE e.course_id = s.course_id AND e.is_active = TRUE), 0) as total_enrolled,
                       COALESCE((SELECT COUNT(*) FROM checkins ch WHERE ch.session_id = s.id), 0) as checked_in_count
                FROM sessions s
                LEFT JOIN courses c ON s.course_id = c.id
                LEFT JOIN users u ON s.instructor_id = u.id
                WHERE 1=1
            `;
            const params: any[] = [];
            let paramIndex = 1;

            if (status) {
                query += ` AND s.status = $${paramIndex++}`;
                params.push(status);
            }
            if (course_id) {
                query += ` AND s.course_id = $${paramIndex++}`;
                params.push(course_id);
            }
            if (instructor_id) {
                query += ` AND s.instructor_id = $${paramIndex++}`;
                params.push(instructor_id);
            }
            if (start_date) {
                query += ` AND s.scheduled_start >= $${paramIndex++}`;
                params.push(start_date);
            }
            if (end_date) {
                query += ` AND s.scheduled_start <= $${paramIndex++}`;
                params.push(end_date);
            }

            query += ` ORDER BY s.scheduled_start DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
            params.push(limit, offset);

            const result = await pgClient.query(query, params);

            // Get total count
            let countQuery = 'SELECT COUNT(*) FROM sessions WHERE 1=1';
            const countParams: any[] = [];
            let countParamIndex = 1;
            if (status) {
                countQuery += ` AND status = $${countParamIndex++}`;
                countParams.push(status);
            }
            if (course_id) {
                countQuery += ` AND course_id = $${countParamIndex++}`;
                countParams.push(course_id);
            }
            if (instructor_id) {
                countQuery += ` AND instructor_id = $${countParamIndex++}`;
                countParams.push(instructor_id);
            }
            const countResult = await pgClient.query(countQuery, countParams);
            const total = parseInt(countResult.rows[0].count);

            res.status(200).send({
                items: result.rows,
                total: total,
                limit: limit,
                offset: offset
            });
        } catch (err: any) {
            console.error('Error listing sessions:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // GET /sessions/active - List active sessions (public endpoint)
    fastify.get(baseUri + '/active', async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const result = await pgClient.query(`
                SELECT s.id, s.course_id, c.code as course_code, s.name, s.status,
                       s.scheduled_start, s.scheduled_end,
                       s.checkin_opens_at, s.checkin_closes_at, s.venue_name
                FROM sessions s
                LEFT JOIN courses c ON s.course_id = c.id
                WHERE s.status = 'active'
                  AND NOW() >= s.checkin_opens_at
                  AND NOW() <= s.checkin_closes_at
                ORDER BY s.scheduled_start ASC
            `);

            res.status(200).send(result.rows);
        } catch (err: any) {
            console.error('Error listing active sessions:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // GET /sessions/my-sessions - User's sessions (student: enrolled courses, instructor: taught courses)
    fastify.get(baseUri + '/my-sessions', async (req: FastifyRequest<{ Querystring: { status?: string, upcoming?: boolean, limit?: number } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            // TODO: Get user from JWT token - for now return all sessions
            const { status, upcoming, limit = 50 } = req.query;

            let query = `
                SELECT s.*, c.code as course_code, c.name as course_name
                FROM sessions s
                LEFT JOIN courses c ON s.course_id = c.id
                WHERE 1=1
            `;
            const params: any[] = [];
            let paramIndex = 1;

            if (status) {
                query += ` AND s.status = $${paramIndex++}`;
                params.push(status);
            }
            if (upcoming) {
                query += ` AND s.scheduled_start > NOW()`;
            }

            query += ` ORDER BY s.scheduled_start ASC LIMIT $${paramIndex++}`;
            params.push(limit);

            const result = await pgClient.query(query, params);
            res.status(200).send(result.rows);
        } catch (err: any) {
            console.error('Error listing my sessions:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // GET /sessions/{id} - Get single session
    fastify.get(baseUri + '/:id', async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { id } = req.params;

            // Skip special routes
            if (id === 'active' || id === 'my-sessions') {
                return;
            }

            const result = await pgClient.query(`
                SELECT s.*, c.code as course_code, c.name as course_name,
                       u.full_name as instructor_name
                FROM sessions s
                LEFT JOIN courses c ON s.course_id = c.id
                LEFT JOIN users u ON s.instructor_id = u.id
                WHERE s.id = $1
            `, [id]);

            if (result.rows.length === 0) {
                res.status(404).send({ detail: 'Session not found' });
                return;
            }

            res.status(200).send(result.rows[0]);
        } catch (err: any) {
            console.error('Error getting session:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // POST /sessions/ - Create a new session (instructor only)
    fastify.post(baseUri + '/', async (req: FastifyRequest<{ Body: SessionCreateBody }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const {
                course_id,
                instructor_id = null,
                name,
                session_type = 'lecture',
                description = null,
                scheduled_start,
                scheduled_end,
                checkin_opens_at,
                checkin_closes_at,
                venue_name = null,
                venue_latitude = null,
                venue_longitude = null,
                geofence_radius_meters = null,
                require_liveness_check = true,
                require_face_match = false,
                risk_threshold = null
            } = req.body;

            // Default check-in window: opens 15min before start, closes 30min after start
            const startTime = new Date(scheduled_start);
            const endTime = new Date(scheduled_end);
            const defaultOpensAt = checkin_opens_at || new Date(startTime.getTime() - 15 * 60 * 1000).toISOString();
            const defaultClosesAt = checkin_closes_at || new Date(startTime.getTime() + 30 * 60 * 1000).toISOString();
            const opensAt = new Date(defaultOpensAt);
            const closesAt = new Date(defaultClosesAt);

            // Validation: scheduled_start must be in the future
            if (startTime <= new Date()) {
                res.status(400).send({ detail: 'scheduled_start must be in the future' });
                return;
            }

            // Validation: scheduled_end must be after scheduled_start
            if (endTime <= startTime) {
                res.status(400).send({ detail: 'scheduled_end must be after scheduled_start' });
                return;
            }

            // Validation: checkin_closes_at must be after checkin_opens_at
            if (closesAt <= opensAt) {
                res.status(400).send({ detail: 'checkin_closes_at must be after checkin_opens_at' });
                return;
            }

            const result = await pgClient.query(
                `INSERT INTO sessions (
                    id, course_id, instructor_id, name, session_type, description,
                    scheduled_start, scheduled_end, checkin_opens_at, checkin_closes_at,
                    status, venue_name, venue_latitude, venue_longitude,
                    geofence_radius_meters, require_liveness_check, require_face_match,
                    risk_threshold, created_at, updated_at
                )
                 VALUES (
                    gen_random_uuid()::text, $1, $2, $3, $4, $5,
                    $6, $7, $8, $9,
                    'scheduled', $10, $11, $12,
                    $13, $14, $15, $16, NOW(), NOW()
                 )
                 RETURNING *`,
                [
                    course_id, instructor_id, name, session_type, description,
                    scheduled_start, scheduled_end, defaultOpensAt, defaultClosesAt,
                    venue_name, venue_latitude, venue_longitude,
                    geofence_radius_meters, require_liveness_check, require_face_match,
                    risk_threshold
                ]
            );

            res.status(201).send(result.rows[0]);
        } catch (err: any) {
            console.error('Error creating session:', err.message);
            res.status(400).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // PATCH /sessions/{id} - Update session (instructor only)
    fastify.patch(baseUri + '/:id', async (req: FastifyRequest<{ Params: { id: string }, Body: SessionUpdateBody }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { id } = req.params;
            const updates = req.body;

            // Build dynamic update query
            const fields: string[] = [];
            const values: any[] = [];
            let paramIndex = 1;

            const allowedFields = [
                'name', 'description', 'status', 'scheduled_start', 'scheduled_end',
                'checkin_opens_at', 'checkin_closes_at', 'venue_name', 'venue_latitude',
                'venue_longitude', 'geofence_radius_meters', 'require_liveness_check',
                'require_face_match', 'risk_threshold'
            ];

            for (const field of allowedFields) {
                if ((updates as any)[field] !== undefined) {
                    fields.push(`${field} = $${paramIndex++}`);
                    values.push((updates as any)[field]);
                }
            }

            if (fields.length === 0) {
                res.status(400).send({ detail: 'No valid fields to update' });
                return;
            }

            fields.push(`updated_at = NOW()`);
            values.push(id);

            const query = `UPDATE sessions SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
            const result = await pgClient.query(query, values);

            if (result.rows.length === 0) {
                res.status(404).send({ detail: 'Session not found' });
                return;
            }

            res.status(200).send(result.rows[0]);
        } catch (err: any) {
            console.error('Error updating session:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // PATCH /admin/sessions/{id}/status - Update session status (admin endpoint)
    fastify.patch(adminUri + '/:id/status', async (req: FastifyRequest<{ Params: { id: string }, Body: { status: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { id } = req.params;
            const { status } = req.body;


            if (!VALID_SESSION_STATUSES.includes(status as SessionStatus)) {
                res.status(400).send({ detail: `Invalid status. Must be one of: ${VALID_SESSION_STATUSES.join(', ')}` });
                return;
            }

            const result = await pgClient.query(
                `UPDATE sessions SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
                [status, id]
            );

            if (result.rows.length === 0) {
                res.status(404).send({ detail: 'Session not found' });
                return;
            }

            res.status(200).send(result.rows[0]);
        } catch (err: any) {
            console.error('Error updating session status:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // DELETE /sessions/{id} - Delete session (instructor only, scheduled sessions only)
    fastify.delete(baseUri + '/:id', async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { id } = req.params;

            // Check if session is scheduled
            const checkResult = await pgClient.query(
                'SELECT status FROM sessions WHERE id = $1',
                [id]
            );

            if (checkResult.rows.length === 0) {
                res.status(404).send({ detail: 'Session not found' });
                return;
            }

            if (checkResult.rows[0].status !== SessionStatus.SCHEDULED) {
                res.status(400).send({ detail: 'Only scheduled sessions can be deleted. Use cancel for active/closed sessions.' });
                return;
            }

            await pgClient.query('DELETE FROM sessions WHERE id = $1', [id]);
            res.status(204).send();
        } catch (err: any) {
            console.error('Error deleting session:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(sessionController);
