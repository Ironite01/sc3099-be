import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { USER_ROLE_TYPES, UserModel } from '../model/user.js';
import { BASE_URL } from '../helpers/constants.js';
import { UnauthorizedError } from '../model/error.js';
import { AUDIT_ACTIONS, AuditModel } from '../model/audit.js';
import { loginTotal, registrationTotal } from '../services/metrics.js';

async function authController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/auth`;
    const resourceType = 'auth';

    const ACCESS_TOKEN_TTL = parseInt(fastify.config.ACCESS_TOKEN_EXPIRE_MINUTES || '60') * 60;
    const REFRESH_TOKEN_TTL = parseInt(fastify.config.REFRESH_TOKEN_EXPIRE_DAYS || '7') * 24 * 60 * 60;

    fastify.post(`${uri}/register`, {
        schema: {
            body: {
                type: 'object',
                properties: {
                    email: {
                        type: 'string',
                        format: 'email'
                    },
                    password: {
                        type: 'string',
                        minLength: 8
                    },
                    full_name: {
                        type: 'string',
                        minLength: 4
                    },
                    role: {
                        type: 'string',
                        enum: [
                            USER_ROLE_TYPES.STUDENT,
                            USER_ROLE_TYPES.TA,
                            USER_ROLE_TYPES.INSTRUCTOR,
                            USER_ROLE_TYPES.ADMIN
                        ],
                        default: USER_ROLE_TYPES.STUDENT
                    }
                },
                required: ['email', 'password', 'full_name'],
                additionalProperties: false
            }
        },
        preHandler: [fastify.rateLimit({
            limit: 10,
            window: 3600,
            keyGenerator: (req: FastifyRequest) => `rl:register:${req.ip}`
        })]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const body = req.body as any;
            const user = await UserModel.create(pgClient, {
                ...body,
                role: body.role || USER_ROLE_TYPES.STUDENT
            });

        await AuditModel.log(prisma, {
            userId: user.id,
            action: AUDIT_ACTIONS.USER_CREATED,
            resourceType,
            resourceId: user.id,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'] || '',
            success: true,
            details: { email: user.email, role: user.role }
        });
        registrationTotal.inc({ role: user.role });

        res.status(201).send({
            id: user.id,
            email: user.email,
            full_name: user.full_name,
            role: user.role,
            is_active: user.is_active,
            created_at: user.created_at
        });
    });

    fastify.post(`${uri}/login`, {
        schema: {
            body: {
                type: 'object',
                properties: {
                    email: {
                        type: 'string',
                        format: 'email',
                        pattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
                    },
                    password: {
                        type: 'string'
                    }
                },
                required: ['email', 'password']
            }
        },
        preHandler: [fastify.rateLimit({
            limit: 60,
            window: 3600,
            keyGenerator: (req: FastifyRequest) => `rl:login:${req.ip}`
        })]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const prisma = fastify.prisma;
        const { email, password: passwordClaim }: any = req.body;
        let user: any;
        try {
            user = await UserModel.login(prisma, email, passwordClaim);
            loginTotal.inc({ status: 'success' });

            await AuditModel.log(prisma, {
                userId: user.id,
                action: AUDIT_ACTIONS.LOGIN_SUCCESS,
                resourceType,
                resourceId: user.id,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: true,
                details: { user_id: user.id, ip: req.ip }
            });
        } catch (err) {
            loginTotal.inc({ status: 'failure' });

            // Check for multiple failed login attempts (brute force detection)
            const failedAttemptsKey = `failed_login:${req.ip}`;
            let failedAttempts = 0;
            try {
                const redis = (fastify as any).redis;
                if (redis) {
                    const current = await redis.incr(failedAttemptsKey);
                    if (current === 1) {
                        await redis.expire(failedAttemptsKey, 3600); // 1 hour window
                    }
                    failedAttempts = current || 0;

                    // Log as security_violation if multiple failures detected
                    if (failedAttempts >= 5) {
                        await AuditModel.log(prisma, {
                            userId: null,
                            action: AUDIT_ACTIONS.SECURITY_VIOLATION,
                            resourceType,
                            resourceId: email,
                            ipAddress: req.ip,
                            userAgent: req.headers['user-agent'] || '',
                            success: false,
                            details: { violation_type: 'brute_force_attempt', failed_attempts: failedAttempts, email: email }
                        });
                    }
                }
            } catch (redisErr) {
                console.error('Failed to check login attempts:', redisErr);
            }

            await AuditModel.log(prisma, {
                userId: null,
                action: AUDIT_ACTIONS.LOGIN_FAILED,
                resourceType,
                resourceId: email,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: false,
                details: { email: email, ip: req.ip, reason: 'invalid_credentials' }
            });
            throw err;
        }

            const shouldSetAuthCookies = String((req.headers['x-saiv-cookie-auth'] || '')).toLowerCase() === '1';
            if (shouldSetAuthCookies) {
                res.setCookie('access_token', accessToken, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
                    sameSite: 'strict',
                    path: '/',
                    maxAge: ACCESS_TOKEN_TTL
                });
                res.setCookie('refresh_token', refreshToken, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    path: '/',
                    maxAge: REFRESH_TOKEN_TTL
                });
            }

            res.status(200).send({
                access_token: accessToken,
                refresh_token: refreshToken,
                token_type: "bearer",
                user
            });
        } finally {
            pgClient.release();
        }

        res.status(200).send({
            access_token: accessToken,
            refresh_token: refreshToken,
            token_type: "bearer",
            user
        });
    });

    fastify.post(`${uri}/refresh`, {
        schema: {
            body: {
                type: 'object',
                properties: {
                    refresh_token: { type: 'string' }
                }
            }
        },
        preHandler: [fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const prisma = fastify.prisma;
        const refresh_token: any = (req.body as any)?.refresh_token || req.cookies.refresh_token;
        if (!refresh_token) {
            throw new UnauthorizedError();
        }

        let decoded: any;
        try {
            decoded = fastify.jwt.verify(refresh_token);
        } catch (_err: any) {
            throw new UnauthorizedError();
        }
        if (decoded.type !== 'refresh') {
            throw new UnauthorizedError();
        }

        const user = await UserModel.getById(prisma, decoded.sub);

        const accessToken = fastify.jwt.sign(
            { sub: user.id, email: user.email, role: user.role },
            { expiresIn: ACCESS_TOKEN_TTL }
        );
        const newRefreshToken = fastify.jwt.sign(
            { sub: user.id, type: 'refresh' },
            { expiresIn: REFRESH_TOKEN_TTL }
        );

        const shouldSetAuthCookies = String((req.headers['x-saiv-cookie-auth'] || '')).toLowerCase() === '1';
        if (shouldSetAuthCookies) {
            res.setCookie('access_token', accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
                sameSite: 'strict',
                path: '/',
                maxAge: ACCESS_TOKEN_TTL
            });
            res.setCookie('refresh_token', newRefreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                path: '/',
                maxAge: REFRESH_TOKEN_TTL
            });
        }

        res.status(200).send({ refresh_token: newRefreshToken, access_token: accessToken, user });
    });

    // Extra endpoint
    fastify.post(`${uri}/logout`, { preHandler: [fastify.rateLimit()] }, async (req: FastifyRequest, res: FastifyReply) => {
        const userId = (req.user as any)?.sub;
        if (userId) {
            await AuditModel.log(fastify.prisma, {
                userId: userId,
                action: AUDIT_ACTIONS.LOGOUT,
                resourceType,
                resourceId: userId,
                ipAddress: req.ip,
                userAgent: req.headers['user-agent'] || '',
                success: true
            });
        }

        res.clearCookie('access_token', {
            path: '/',
            httpOnly: true,
            sameSite: 'strict',
            secure: process.env.NODE_ENV === 'production'
        });
        res.clearCookie('refresh_token', {
            path: '/',
            httpOnly: true,
            sameSite: 'strict',
            secure: process.env.NODE_ENV === 'production'
        });
        res.status(200).send({ message: 'Logged out successfully' });
    });
}

export default fp(authController);
