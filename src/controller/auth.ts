import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import * as UserModel from '../model/user.js';
import { ACCESS_TOKEN_TTL, BASE_URL, REFRESH_TOKEN_TTL } from '../helpers/constants.js';

async function authController(fastify: FastifyInstance) {
    const uri = `${BASE_URL}/auth`;

    fastify.get(`${uri}/me`, { preHandler: [(fastify as any).authorize()] }, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const userId = (req?.user as any).sub;
            if (!userId) {
                throw new Error("User not found!");
            }
            const user = await UserModel.getUserById(pgClient, userId);
            if (!user) {
                throw new Error("User not found!");
            }
            if (!user.isActive) {
                return res.status(403).send({ success: false, message: "Forbidden" });
            }
            res.status(200).send({ success: true, user });
        } catch (e: any) {
            res.status(401).send({ success: false, message: e.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/login`, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const { email, password: passwordClaim }: any = req.body;
            const user = await UserModel.authenticate(pgClient, email, passwordClaim);
            // Check if user account is active
            if (!user.isActive) {
                return res.status(403).send({ success: false, message: "Forbidden" });
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
        } catch (err: any) {
            res.status(401).send({ success: false, error: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(`${uri}/refresh`, async (req: FastifyRequest, res: FastifyReply) => {
        const pgClient = await fastify.pg.connect();
        try {
            const refresh_token: any = req.cookies;
            if (!refresh_token) {
                throw new Error("Refresh token required");
            }

            const decoded: any = fastify.jwt.verify(refresh_token);
            if (decoded.type !== 'refresh') {
                throw new Error("Invalid refresh token");
            }

            const user = await UserModel.getUserById(pgClient, decoded.sub);
            if (!user.isActive) {
                return res.status(403).send({ success: false, message: "Forbidden" });
            }

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
            res.status(401).send({ message: err.message });
        } finally {
            pgClient.release();
        }
    });

    fastify.post(uri, async (req: FastifyRequest, res: FastifyReply) => {
        try {
            const parts = req.parts();
            const payload: any = {};
            for await (const part of parts) {
                if (part.type === 'file') {
                    // TODO: Handle profile picture
                    const profilePicture = part.file;
                } else {
                    payload[part.fieldname] = part.value;
                }
            }
            await UserModel.createUser(payload);
            res.status(201).send({ message: "Successfully created user!" });
        } catch (err) {
            console.error(err);
        }
    });
}

export default fp(authController);