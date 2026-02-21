import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { USER_ROLE_TYPES, UserModel } from '../model/user.js';
import { ACCESS_TOKEN_TTL, BASE_URL, REFRESH_TOKEN_TTL } from '../helpers/constants.js';
import { BadRequestError } from '../model/error.js';

async function authController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/auth`;

    // Student registeration
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
                        type: 'string'
                    }
                },
                required: ['email', 'password', 'full_name'],
                additionalProperties: false
            }
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        try {
            const pgClient = await fastify.pg.connect();
            const body: any = req.body;
            const user = await UserModel.create(pgClient, { ...body, role: USER_ROLE_TYPES.STUDENT });
            res.status(201).send({
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                is_active: user.is_active,
                created_at: user.created_at
            });
        } catch (err: any) {
            res.status(err?.statusCode || 500).send({ message: err.message });
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
        }
    }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { email, password: passwordClaim }: any = req.body;
            const user = await UserModel.login(pgClient, email, passwordClaim);

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
        } catch (err: any) {
            res.status(err?.statusCode || 500).send({ message: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/refresh`, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const refresh_token: any = req.cookies.refresh_token;
            if (!refresh_token) {
                throw new BadRequestError("Refresh token required");
            }

            const decoded: any = fastify.jwt.verify(refresh_token);
            if (decoded.type !== 'refresh') {
                throw new BadRequestError("Invalid refresh token");
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
        } catch (err: any) {
            res.status(err?.statusCode || 500).send({ message: err.message });
        } finally {
            pgClient.release();
        }
    });
}

export default fp(authController);