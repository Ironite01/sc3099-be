import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { USER_ROLE_HIERARCHY, USER_ROLE_TYPES } from '../model/user.js';
import { ForbiddenError, UnauthorizedError } from '../model/error.js';
import { AUDIT_ACTIONS, AuditModel } from '../model/audit.js';

declare module 'fastify' {
    interface FastifyInstance {
        authorize: (arg?: USER_ROLE_TYPES[] | number) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        config: any;
    }
}

function auth(fastify: FastifyInstance) {
    const secret = fastify.config.SECRET_KEY!!;

    fastify.register(fastifyJwt, {
        secret: secret,
        cookie: {
            cookieName: 'access_token',
            signed: false
        }
    })

    // Usage: { preHandler: [authorize([USER_ROLE_TYPES.STUDENT, USER_ROLE_TYPES.TA])]}
    // Usage: { preHandler: [authorize(2)]}
    fastify.decorate("authorize", (arg: USER_ROLE_TYPES[] | number = 1) =>
        async function (request: FastifyRequest, _reply: FastifyReply) {
            const prisma = await fastify.prisma;
            try {
                await request.jwtVerify();
            } catch (_err: any) {
                // Log invalid token attempt
                await AuditModel.log(prisma, {
                    userId: null,
                    action: AUDIT_ACTIONS.SECURITY_VIOLATION,
                    resourceType: 'auth',
                    resourceId: request.url,
                    ipAddress: request.ip,
                    userAgent: request.headers['user-agent'] || '',
                    success: false,
                    details: { violation_type: 'invalid_token', reason: 'jwt_verification_failed' }
                });
                throw new UnauthorizedError();
            }

            const userRole = (request.user as { role: USER_ROLE_TYPES })?.role;
            const userId = (request.user as any)?.sub;

            if (userRole === USER_ROLE_TYPES.ADMIN) {
                return;
            }

            if (typeof arg === 'number') {
                const userRoleLevel = USER_ROLE_HIERARCHY[userRole] || 0;

                if (userRoleLevel < arg) {
                    // Log insufficient permissions attempt
                    await AuditModel.log(prisma, {
                        userId: userId,
                        action: AUDIT_ACTIONS.SECURITY_VIOLATION,
                        resourceType: 'endpoint',
                        resourceId: request.url,
                        ipAddress: request.ip,
                        userAgent: request.headers['user-agent'] || '',
                        success: false,
                        details: { violation_type: 'insufficient_permissions', required_level: arg, user_level: userRoleLevel }
                    });
                    throw new ForbiddenError();
                }
            } else {
                if (typeof arg === "object" && (!userRole || !arg.includes(userRole))) {
                    // Log role mismatch attempt
                    await AuditModel.log(prisma, {
                        userId: userId,
                        action: AUDIT_ACTIONS.SECURITY_VIOLATION,
                        resourceType: 'endpoint',
                        resourceId: request.url,
                        ipAddress: request.ip,
                        userAgent: request.headers['user-agent'] || '',
                        success: false,
                        details: { violation_type: 'role_mismatch', required_roles: arg, user_role: userRole }
                    });
                    throw new ForbiddenError();
                }
            }
        }
    );
}

export default fp(auth);
