import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BASE_URL } from '../helpers/constants.js';
import { ForbiddenError, NotFoundError } from '../model/error.js';
import { USER_ROLE_TYPES } from '../model/user.js';
import { deviceRegistrationTotal } from '../services/metrics.js';

async function ensureDeviceTable(fastify: FastifyInstance) {
    const pgClient = await (fastify as any).pg.connect();
    try {
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS devices (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                device_fingerprint TEXT NOT NULL,
                device_name TEXT,
                platform TEXT,
                public_key TEXT,
                public_key_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                is_trusted BOOLEAN NOT NULL DEFAULT FALSE,
                trust_score TEXT NOT NULL DEFAULT 'low',
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                total_checkins INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(user_id, device_fingerprint)
            )
        `);

        // Backfill columns for older schemas that may predate current device model.
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS device_name TEXT`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS platform TEXT`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS public_key TEXT`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS public_key_created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_trusted BOOLEAN NOT NULL DEFAULT FALSE`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS trust_score TEXT NOT NULL DEFAULT 'low'`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS total_checkins INTEGER NOT NULL DEFAULT 0`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        await pgClient.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        await pgClient.query(`CREATE UNIQUE INDEX IF NOT EXISTS devices_user_fingerprint_ux ON devices(user_id, device_fingerprint)`);
        await pgClient.query(`DO $$ BEGIN ALTER TABLE devices ADD CONSTRAINT devices_device_fingerprint_key UNIQUE (device_fingerprint); EXCEPTION WHEN duplicate_object OR duplicate_table OR unique_violation THEN END; $$;`);
    } finally {
        pgClient.release();
    }
}

async function deviceController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/devices`;

    await ensureDeviceTable(fastify);

    fastify.get(`${uri}/`, {
        preHandler: [fastify.authorize([USER_ROLE_TYPES.ADMIN, USER_ROLE_TYPES.INSTRUCTOR])],
        schema: {
            querystring: {
                type: 'object',
                properties: {
                    user_id: { type: 'string' },
                    is_active: { type: 'boolean' },
                    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
                    offset: { type: 'integer', minimum: 0, default: 0 }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { user_id, is_active, limit = 50, offset = 0 } = req.query as {
            user_id?: string;
            is_active?: boolean;
            limit?: number;
            offset?: number;
        };

        const params: any[] = [];
        const where: string[] = [];
        if (user_id) {
            params.push(user_id);
            where.push(`d.user_id = $${params.length}`);
        }
        if (typeof is_active === 'boolean') {
            params.push(is_active);
            where.push(`d.is_active = $${params.length}`);
        }

        const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const pgClient = await (fastify as any).pg.connect();
        try {
            const countResult = await pgClient.query(
                `SELECT COUNT(*)::int AS total
                 FROM devices d
                 ${whereClause}`,
                params
            );

            params.push(limit, offset);
            const result = await pgClient.query(
                `SELECT d.id, d.user_id, u.email, u.full_name, d.device_fingerprint,
                        d.device_name, d.platform, d.is_trusted, d.trust_score,
                        d.is_active, 
                        TO_CHAR((d.first_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS first_seen_at, 
                        TO_CHAR((d.last_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS last_seen_at, 
                        d.total_checkins
                 FROM devices d
                 LEFT JOIN users u ON u.id = d.user_id
                 ${whereClause}
                 ORDER BY d.last_seen_at DESC
                 LIMIT $${params.length - 1}
                 OFFSET $${params.length}`,
                params
            );

            res.status(200).send({
                items: result.rows,
                total: countResult.rows[0]?.total ?? 0,
                limit,
                offset
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/register`, {
        preHandler: [fastify.authorize(1)],
        schema: {
            body: {
                type: 'object',
                required: ['device_fingerprint'],
                properties: {
                    device_fingerprint: { type: 'string', minLength: 4 },
                    device_name: { type: 'string' },
                    platform: { type: 'string' },
                    public_key: { type: 'string' }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const userId = (req.user as any)?.sub as string;
        const { device_fingerprint, device_name, platform, public_key } = req.body as any;
        const normalizedPublicKey = public_key ?? '';

        const pgClient = await (fastify as any).pg.connect();
        try {
            const result = await pgClient.query(
                `INSERT INTO devices (
                    id, user_id, device_fingerprint, device_name, platform, public_key,
                    public_key_created_at,
                    is_trusted, trust_score, is_active, first_seen_at, last_seen_at,
                    total_checkins, created_at, updated_at
                ) VALUES (
                    gen_random_uuid()::text, $1, $2, $3, $4, $5,
                    NOW(),
                    FALSE, 'low', TRUE, NOW(), NOW(),
                    0, NOW(), NOW()
                )
                ON CONFLICT (user_id, device_fingerprint)
                DO UPDATE SET
                    device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
                    platform = COALESCE(EXCLUDED.platform, devices.platform),
                    public_key = COALESCE(EXCLUDED.public_key, devices.public_key),
                    is_active = TRUE,
                    last_seen_at = NOW(),
                    updated_at = NOW()
                RETURNING id, device_fingerprint, device_name, platform,
                          is_trusted, trust_score, is_active, 
                          TO_CHAR((first_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS first_seen_at, 
                          TO_CHAR((last_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS last_seen_at, 
                          total_checkins`,
                [userId, device_fingerprint, device_name ?? null, platform ?? null, normalizedPublicKey]
            );

            res.status(201).send(result.rows[0]);
            deviceRegistrationTotal.inc();
        } catch (err: any) {
            if (err.code === '23505' && (err.constraint === 'devices_device_fingerprint_key' || (err.message && err.message.includes('devices_device_fingerprint_key')))) {
                res.status(409).send({ message: 'Device already registered to another account. Please unbind first.' });
                return;
            }
            throw err;
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/`, {
        preHandler: [fastify.authorize(1)],
        schema: {
            body: {
                type: 'object',
                required: ['device_fingerprint'],
                properties: {
                    device_fingerprint: { type: 'string', minLength: 4 },
                    device_name: { type: 'string' },
                    platform: { type: 'string' },
                    public_key: { type: 'string' }
                }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const userId = (req.user as any)?.sub as string;
        const { device_fingerprint, device_name, platform, public_key } = req.body as any;
        const normalizedPublicKey = public_key ?? '';

        const pgClient = await (fastify as any).pg.connect();
        try {
            const result = await pgClient.query(
                `INSERT INTO devices (
                    id, user_id, device_fingerprint, device_name, platform, public_key,
                    public_key_created_at,
                    is_trusted, trust_score, is_active, first_seen_at, last_seen_at,
                    total_checkins, created_at, updated_at
                ) VALUES (
                    gen_random_uuid()::text, $1, $2, $3, $4, $5,
                    NOW(),
                    FALSE, 'low', TRUE, NOW(), NOW(),
                    0, NOW(), NOW()
                )
                ON CONFLICT (user_id, device_fingerprint)
                DO UPDATE SET
                    device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
                    platform = COALESCE(EXCLUDED.platform, devices.platform),
                    public_key = COALESCE(EXCLUDED.public_key, devices.public_key),
                    is_active = TRUE,
                    last_seen_at = NOW(),
                    updated_at = NOW()
                RETURNING id, device_fingerprint, device_name, platform,
                          is_trusted, trust_score, is_active, 
                          TO_CHAR((first_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS first_seen_at, 
                          TO_CHAR((last_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS last_seen_at, 
                          total_checkins`,
                [userId, device_fingerprint, device_name ?? null, platform ?? null, normalizedPublicKey]
            );

            res.status(201).send(result.rows[0]);
            deviceRegistrationTotal.inc();
        } catch (err: any) {
            if (err.code === '23505' && err.constraint === 'devices_device_fingerprint_key') {
                res.status(409).send({ message: 'Device already registered to another account. Please unbind first.' });
                return;
            }
            throw err;
        } finally {
            pgClient.release();
        }
    });

    fastify.get(`${uri}/my-devices`, {
        preHandler: [fastify.authorize(1)]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const userId = (req.user as any)?.sub as string;
        const pgClient = await (fastify as any).pg.connect();
        try {
            const result = await pgClient.query(
                `SELECT id, device_name, platform, is_trusted, trust_score,
                        is_active, 
                        TO_CHAR((first_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS first_seen_at, 
                        TO_CHAR((last_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS last_seen_at, 
                        total_checkins
                 FROM devices
                 WHERE user_id = $1
                 ORDER BY last_seen_at DESC`,
                [userId]
            );
            res.status(200).send(result.rows);
        } finally {
            pgClient.release();
        }
    });

    fastify.patch(`${uri}/:device_id`, {
        preHandler: [fastify.authorize(1)],
        schema: {
            params: {
                type: 'object',
                required: ['device_id'],
                properties: { device_id: { type: 'string' } }
            },
            body: {
                type: 'object',
                properties: {
                    device_name: { type: 'string' },
                    is_trusted: { type: 'boolean' },
                    is_active: { type: 'boolean' }
                },
                additionalProperties: false
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { device_id } = req.params as { device_id: string };
        const user = req.user as any;
        const userId = user?.sub as string;
        const role = user?.role as USER_ROLE_TYPES;
        const body = req.body as { device_name?: string; is_trusted?: boolean; is_active?: boolean };

        if (body.is_trusted !== undefined && role !== USER_ROLE_TYPES.ADMIN) {
            throw new ForbiddenError();
        }

        const pgClient = await (fastify as any).pg.connect();
        try {
            const ownerCheck = await pgClient.query('SELECT user_id FROM devices WHERE id = $1', [device_id]);
            if (!ownerCheck.rows.length) {
                throw new NotFoundError();
            }
            const ownerId = ownerCheck.rows[0].user_id as string;
            const isOwner = ownerId === userId;
            const isAdminOrInstructor = role === USER_ROLE_TYPES.ADMIN || role === USER_ROLE_TYPES.INSTRUCTOR;
            if (!isOwner && !isAdminOrInstructor) {
                throw new ForbiddenError();
            }

            const updates: string[] = [];
            const values: any[] = [];
            let p = 1;

            if (body.device_name !== undefined) {
                updates.push(`device_name = $${p++}`);
                values.push(body.device_name);
            }
            if (body.is_trusted !== undefined) {
                updates.push(`is_trusted = $${p++}`);
                values.push(body.is_trusted);
                updates.push(`trust_score = $${p++}`);
                values.push(body.is_trusted ? 'high' : 'low');
            }
            if (body.is_active !== undefined) {
                updates.push(`is_active = $${p++}`);
                values.push(body.is_active);
            }

            if (!updates.length) {
                res.status(200).send({ message: 'No changes applied' });
                return;
            }

            values.push(device_id);
            const result = await pgClient.query(
                `UPDATE devices
                 SET ${updates.join(', ')}, updated_at = NOW()
                 WHERE id = $${p}
                 RETURNING id, device_fingerprint, device_name, platform,
                           is_trusted, trust_score, is_active, 
                           TO_CHAR((first_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS first_seen_at, 
                           TO_CHAR((last_seen_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD"T"HH24:MI:SS"+08:00"') AS last_seen_at, 
                           total_checkins`,
                values
            );

            if (!result.rows.length) {
                throw new NotFoundError();
            }

            res.status(200).send(result.rows[0]);
        } finally {
            pgClient.release();
        }
    });

    fastify.delete(`${uri}/:device_id`, {
        preHandler: [fastify.authorize(1)],
        schema: {
            params: {
                type: 'object',
                required: ['device_id'],
                properties: { device_id: { type: 'string' } }
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const { device_id } = req.params as { device_id: string };
        const user = req.user as any;
        const userId = user?.sub as string;
        const role = user?.role as USER_ROLE_TYPES;

        const pgClient = await (fastify as any).pg.connect();
        try {
            const ownerCheck = await pgClient.query('SELECT user_id FROM devices WHERE id = $1', [device_id]);
            if (!ownerCheck.rows.length) {
                throw new NotFoundError();
            }
            const ownerId = ownerCheck.rows[0].user_id as string;
            const isOwner = ownerId === userId;
            const isAdminOrInstructor = role === USER_ROLE_TYPES.ADMIN || role === USER_ROLE_TYPES.INSTRUCTOR;
            if (!isOwner && !isAdminOrInstructor) {
                throw new ForbiddenError();
            }

            await pgClient.query('DELETE FROM devices WHERE id = $1', [device_id]);
            res.status(204).send();
        } finally {
            pgClient.release();
        }
    });
}

export default fp(deviceController);
