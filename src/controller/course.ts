import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

interface CourseCreateBody {
    code: string;
    name: string;
    semester: string;
    description?: string;
    venue_name?: string;
    venue_latitude?: number;
    venue_longitude?: number;
    geofence_radius_meters?: number;
    require_face_recognition?: boolean;
    require_device_binding?: boolean;
    risk_threshold?: number;
}

interface CourseUpdateBody {
    name?: string;
    description?: string;
    venue_name?: string;
    venue_latitude?: number;
    venue_longitude?: number;
    geofence_radius_meters?: number;
    require_face_recognition?: boolean;
    require_device_binding?: boolean;
    risk_threshold?: number;
    is_active?: boolean;
}

interface CourseListQuery {
    is_active?: boolean;
    semester?: string;
    limit?: number;
    offset?: number;
}

async function courseController(fastify: FastifyInstance) {
    const baseUri = '/api/v1/courses';

    // GET /courses/ - List courses with filters
    fastify.get(baseUri + '/', async (req: FastifyRequest<{ Querystring: CourseListQuery }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { is_active, semester, limit = 50, offset = 0 } = req.query;

            let query = `
                SELECT *
                FROM courses
                WHERE 1=1
            `;
            const params: any[] = [];
            let paramIndex = 1;

            if (is_active !== undefined) {
                query += ` AND is_active = $${paramIndex++}`;
                params.push(is_active);
            }
            if (semester) {
                query += ` AND semester = $${paramIndex++}`;
                params.push(semester);
            }


            query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
            params.push(limit, offset);

            const result = await pgClient.query(query, params);

            // Get total count
            let countQuery = 'SELECT COUNT(*) FROM courses WHERE 1=1';
            const countParams: any[] = [];
            let countParamIndex = 1;
            if (is_active !== undefined) {
                countQuery += ` AND is_active = $${countParamIndex++}`;
                countParams.push(is_active);
            }
            if (semester) {
                countQuery += ` AND semester = $${countParamIndex++}`;
                countParams.push(semester);
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
            console.error('Error listing courses:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // GET /courses/{id} - Get single course
    fastify.get(baseUri + '/:id', async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { id } = req.params;
            const result = await pgClient.query(
                'SELECT * FROM courses WHERE id = $1',
                [id]
            );

            if (result.rows.length === 0) {
                res.status(404).send({ detail: 'Course not found' });
                return;
            }

            res.status(200).send(result.rows[0]);
        } catch (err: any) {
            console.error('Error getting course:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // POST /courses/ - Create a new course (admin only)
    fastify.post(baseUri + '/', async (req: FastifyRequest<{ Body: CourseCreateBody }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const {
                code,
                name,
                semester,
                description = null,
                venue_name = null,
                venue_latitude = null,
                venue_longitude = null,
                geofence_radius_meters = 100.0,
                require_face_recognition = false,
                require_device_binding = true,
                risk_threshold = 0.5
            } = req.body;

            const result = await pgClient.query(
                `INSERT INTO courses (
                    id, code, name, description, semester, is_active,
                    venue_latitude, venue_longitude, venue_name,
                    geofence_radius_meters, require_face_recognition, require_device_binding,
                    risk_threshold, created_at, updated_at
                )
                 VALUES (
                    gen_random_uuid()::text, $1, $2, $3, $4, TRUE,
                    $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
                 )
                 RETURNING *`,
                [
                    code, name, description, semester,
                    venue_latitude, venue_longitude, venue_name,
                    geofence_radius_meters, require_face_recognition, require_device_binding,
                    risk_threshold
                ]
            );

            res.status(201).send(result.rows[0]);
        } catch (err: any) {
            console.error('Error creating course:', err.message);
            res.status(400).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // PUT /courses/{id} - Update course (admin or course instructor)
    fastify.put(baseUri + '/:id', async (req: FastifyRequest<{ Params: { id: string }, Body: CourseUpdateBody }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { id } = req.params;
            const updates = req.body;

            // Build dynamic update query
            const fields: string[] = [];
            const values: any[] = [];
            let paramIndex = 1;

            const allowedFields = [
                'name', 'description', 'venue_name', 'venue_latitude', 'venue_longitude',
                'geofence_radius_meters', 'require_face_recognition', 'require_device_binding',
                'risk_threshold', 'is_active'
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

            const query = `UPDATE courses SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
            const result = await pgClient.query(query, values);

            if (result.rows.length === 0) {
                res.status(404).send({ detail: 'Course not found' });
                return;
            }

            res.status(200).send(result.rows[0]);
        } catch (err: any) {
            console.error('Error updating course:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });

    // DELETE /courses/{id} - Soft delete course (admin only)
    fastify.delete(baseUri + '/:id', async (req: FastifyRequest<{ Params: { id: string } }>, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { id } = req.params;

            // Soft delete the course
            const result = await pgClient.query(
                `UPDATE courses SET is_active = FALSE, updated_at = NOW() WHERE id = $1 RETURNING id`,
                [id]
            );

            if (result.rows.length === 0) {
                res.status(404).send({ detail: 'Course not found' });
                return;
            }

            // Cancel all scheduled/active sessions for this course
            await pgClient.query(
                `UPDATE sessions 
                 SET status = 'cancelled', updated_at = NOW() 
                 WHERE course_id = $1 AND status IN ('scheduled', 'active')`,
                [id]
            );

            res.status(204).send();
        } catch (err: any) {
            console.error('Error deleting course:', err.message);
            res.status(500).send({ detail: err.message });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(courseController);
