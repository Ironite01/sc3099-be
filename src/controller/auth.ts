import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { USER_ROLE_TYPES, UserModel } from '../model/user.js';
import { ACCESS_TOKEN_TTL, BASE_URL, REFRESH_TOKEN_TTL } from '../helpers/constants.js';
import { UnauthorizedError } from '../model/error.js';
// import { loginTotal, registrationTotal } from '../services/metrics.js';

async function authController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/auth`;

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
                        ]
                    }
                },
                required: ['email', 'password', 'full_name', 'role'],
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
            const user = await UserModel.create(pgClient, req.body as any);

            // registrationTotal.inc({ role });

            res.status(201).send({
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                is_active: user.is_active,
                created_at: user.created_at
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/login`, {
        schema: {
            body: {
                type: 'object',
                properties: {
                    email: {
                        type: 'string',
                        format: 'email'
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
        const pgClient = await fastify.pg.connect();
        try {
            const { email, password: passwordClaim }: any = req.body;
            let user: any;
            try {
                user = await UserModel.login(pgClient, email, passwordClaim);
                // loginTotal.inc({ status: 'success' });
            } catch (err) {
                // loginTotal.inc({ status: 'failure' });
                throw err;
            }

            const accessToken = fastify.jwt.sign(
                { sub: user.id, email: user.email, role: user.role }, { expiresIn: ACCESS_TOKEN_TTL }
            );
            const refreshToken = fastify.jwt.sign(
                { sub: user.id, type: 'refresh' }, { expiresIn: REFRESH_TOKEN_TTL }
            );

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

            res.status(200).send({
                access_token: accessToken,
                refresh_token: refreshToken,
                token_type: "bearer",
                user
            });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/refresh`, {
        preHandler: [fastify.rateLimit()]
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const refresh_token: any = req.cookies.refresh_token;
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

            const user = await UserModel.getById(pgClient, decoded.sub);

            const accessToken = fastify.jwt.sign(
                { sub: user.id, email: user.email, role: user.role },
                { expiresIn: ACCESS_TOKEN_TTL }
            );
            const newRefreshToken = fastify.jwt.sign(
                { sub: user.id, type: 'refresh' },
                { expiresIn: REFRESH_TOKEN_TTL }
            );

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

            res.status(200).send({ refresh_token: newRefreshToken, access_token: accessToken, user });
        } finally {
            pgClient.release();
        }
    });

    // Extra endpoint
    fastify.post(`${uri}/logout`, { preHandler: [fastify.rateLimit()] }, async (_req: FastifyRequest, res: FastifyReply) => {
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