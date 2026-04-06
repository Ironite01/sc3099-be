import { randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { isBase64 } from '../helpers/regex.js';
import { BadRequestError, AppError, ForbiddenError, NotFoundError, UnauthorizedError, UnavailableError } from './error.js';
import { MlServices } from '../services/ml/index.js';
import generateRandomPassword from '../helpers/generateRandomPassword.js';
import { PrismaCodeMap } from '../helpers/prismaCodeMap.js';

export enum USER_ROLE_TYPES {
    STUDENT = 'student',
    ADMIN = 'admin',
    INSTRUCTOR = 'instructor',
    TA = 'ta'
}
export const USER_ROLE_HIERARCHY: Record<USER_ROLE_TYPES, number> = {
    [USER_ROLE_TYPES.STUDENT]: 1,
    [USER_ROLE_TYPES.TA]: 2,
    [USER_ROLE_TYPES.INSTRUCTOR]: 3,
    [USER_ROLE_TYPES.ADMIN]: 4
};

const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS!! || '10');

export const UserModel = {
    getUsersByEmail: async (prisma: PrismaClient, emails: string[]) => {
        try {
            return await prisma.users.findMany({
                where: {
                    email: { in: emails }
                },
                select: {
                    id: true,
                    email: true,
                    full_name: true,
                    role: true,
                    is_active: true
                }
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getByFilteredUsers: async (prisma: PrismaClient, filters: { role?: string, search?: string, is_active?: boolean, limit?: number, offset?: number }) => {
        try {
            const { role, is_active, limit = 50, offset = 0, search } = filters;

            // Build dynamic where clause
            const where: any = {};

            if (role) {
                if (!Object.values(USER_ROLE_TYPES).includes(role.toLowerCase() as USER_ROLE_TYPES)) {
                    throw new BadRequestError("Invalid role filter");
                }
                where.role = role.toLowerCase();
            }

            if (is_active !== undefined) {
                where.is_active = is_active;
            }

            if (search) {
                where.OR = [
                    { email: { contains: search, mode: 'insensitive' } },
                    { full_name: { contains: search, mode: 'insensitive' } }
                ];
            }

            const [items, total] = await prisma.$transaction([
                prisma.users.findMany({
                    where,
                    select: {
                        id: true,
                        email: true,
                        full_name: true,
                        role: true,
                        is_active: true,
                        created_at: true,
                        last_login_at: true,
                        camera_consent: true,
                        geolocation_consent: true,
                        face_enrolled: true
                    },
                    skip: offset,
                    take: limit
                }),
                prisma.users.count({ where })
            ]);

            return {
                items,
                total,
                limit,
                offset
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getById: async function getById(prisma: PrismaClient, id: string) {
        try {
            if (!id) {
                throw new NotFoundError();
            }

            const user = await prisma.users.findUniqueOrThrow({
                where: { id },
                select: {
                    id: true,
                    email: true,
                    full_name: true,
                    role: true,
                    is_active: true,
                    created_at: true,
                    last_login_at: true,
                    camera_consent: true,
                    geolocation_consent: true,
                    face_enrolled: true,
                    face_embedding_hash: true
                }
            });

            return user as User;
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getEnrolledUserByInstructorId: async function getEnrolledUserByInstructorId(prisma: PrismaClient, instructorId: string, studentId: string) {
        try {
            return await prisma.users.findFirstOrThrow({
                where: {
                    id: studentId,
                    is_active: true,
                    enrollments: {
                        some: {
                            courses: {
                                instructor_id: instructorId
                            }
                        }
                    }
                },
                select: {
                    id: true,
                    email: true,
                    full_name: true,
                    role: true,
                    is_active: true,
                    created_at: true,
                    last_login_at: true,
                    camera_consent: true,
                    geolocation_consent: true,
                    face_enrolled: true
                }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    create: async (prisma: PrismaClient, payload: { email: string; password: string, full_name: string, role: string }) => {
        try {
            const { email, password, role } = payload;
            const full_name = String(payload.full_name || '').replace(/<[^>]*>/g, '').trim();

            // Store the user data
            const salt = bcrypt.genSaltSync(SALT_ROUNDS);
            const hashed_password = bcrypt.hashSync(password, salt);

            return await prisma.users.create({
                data: {
                    id: randomUUID(),
                    email: email!,
                    full_name: full_name!,
                    hashed_password,
                    role: role!.toLowerCase() as any,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date()
                },
                select: {
                    id: true,
                    email: true,
                    full_name: true,
                    role: true,
                    is_active: true,
                    created_at: true,
                    last_login_at: true
                }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.CONFLICT) {
                throw new BadRequestError("Email already registered");
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    createMultipleUsers: async (prisma: PrismaClient, users: Array<Partial<User>>) => {
        try {
            if (!users || users.length === 0) {
                return [];
            }

            return await prisma.users.createManyAndReturn({
                data: users.map(u => ({
                    id: randomUUID(),
                    email: u.email!,
                    full_name: u.full_name!,
                    hashed_password: u.hashed_password ? u.hashed_password : bcrypt.hashSync(generateRandomPassword(), bcrypt.genSaltSync(SALT_ROUNDS)),
                    role: u.role ? u.role!.toLowerCase() as USER_ROLE_TYPES : USER_ROLE_TYPES.STUDENT,
                    is_active: true,
                    created_at: new Date(),
                    updated_at: new Date()
                })),
                select: {
                    id: true,
                    email: true,
                    full_name: true,
                    role: true,
                    is_active: true
                },
                skipDuplicates: true
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    login: async function login(prisma: PrismaClient, email: string, passwordClaim: string) {
        try {
            // Query database for user by email
            const user = await prisma.users.findUniqueOrThrow({
                where: { email },
                select: {
                    id: true,
                    email: true,
                    full_name: true,
                    hashed_password: true,
                    role: true,
                    is_active: true,
                    created_at: true,
                    last_login_at: true
                }
            });

            // Check if user exists
            if (!user) {
                throw new UnauthorizedError();
            }

            // Check if user account is active
            if (!user.is_active) {
                throw new ForbiddenError("Account disabled");
            }

            // Compare provided password with stored hash
            const match = await bcrypt.compare(passwordClaim, user.hashed_password);
            if (!match) {
                throw new UnauthorizedError();
            }

            // Update last login timestamp
            await prisma.users.update({
                where: { id: user.id },
                data: { last_login_at: new Date() }
            });

            const { hashed_password, ...userWithoutPassword } = user;
            return userWithoutPassword as User;
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new UnauthorizedError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    updateById: async function updateById(pgClient: PoolClient, userId: string, payload: Partial<{ camera_consent: boolean, geolocation_consent: boolean, full_name: string }>) {
        try {
            const { camera_consent, geolocation_consent } = payload;
            const full_name = payload.full_name !== undefined
                ? String(payload.full_name).replace(/<[^>]*>/g, '').trim()
                : undefined;

            const updates: string[] = [];
            const values: any[] = [];

            if (full_name !== undefined) {
                updates.push(`full_name = $${updates.length + 1}`);
                values.push(full_name);
            }
            if (camera_consent !== undefined) {
                updates.push(`camera_consent = $${updates.length + 1}`);
                values.push(camera_consent);
            }
            if (geolocation_consent !== undefined) {
                updates.push(`geolocation_consent = $${updates.length + 1}`);
                values.push(geolocation_consent);
            }

            if (updates.length === 0) {
                throw new BadRequestError("No fields to update");
            }

            values.push(userId);

            const { rows } = await pgClient.query(
                `UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}
                RETURNING id, email, full_name, role, is_active, created_at, last_login_at, camera_consent, geolocation_consent, face_enrolled;`,
                values
            );

            if (rows.length === 0) {
                throw new NotFoundError();
            }

            return rows[0] as User;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    patchUserById: async function patchUserById(pgClient: PoolClient, userId: string, payload: Partial<{ is_active: boolean, role: string }>) {
        try {
            const { is_active, role } = payload;

            const updates: string[] = [];
            const values: any[] = [];
            if (is_active !== undefined) {
                updates.push(`is_active = $${updates.length + 1}`);
                values.push(Boolean(is_active));
            }
            if (role !== undefined) {
                if (!Object.values(USER_ROLE_TYPES).includes(role.toLowerCase() as USER_ROLE_TYPES)) {
                    throw new BadRequestError("Invalid role");
                }
                updates.push(`role = $${updates.length + 1}`);
                values.push(role.toLowerCase());
            }

            if (updates.length === 0) {
                throw new BadRequestError("No fields to update");
            }

            values.push(userId);

            const { rows } = await pgClient.query(
                `UPDATE users SET ${updates.join(', ')} WHERE id = $${values.length}
                RETURNING id, email, full_name, role, is_active, created_at, last_login_at, camera_consent, geolocation_consent, face_enrolled;`,
                values
            );

            if (rows.length === 0) {
                throw new NotFoundError();
            }

            return rows[0] as User;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    faceEnroll: async function faceEnroll(pgClient: PoolClient, userId: string, image: string) {
        try {
            if (!userId) {
                throw new NotFoundError();
            }

            if (Object.keys(payload).length === 0) {
                throw new BadRequestError("No fields to update");
            }

            const full_name = payload.full_name !== undefined
                ? String(payload.full_name).replace(/<[^>]*>/g, '').trim()
                : undefined;

            return await prisma.users.update({
                where: { id: userId },
                data: {
                    updated_at: new Date(),
                    ...(payload.camera_consent !== undefined && { camera_consent: payload.camera_consent }),
                    ...(payload.geolocation_consent !== undefined && { geolocation_consent: payload.geolocation_consent }),
                    ...(full_name !== undefined && { full_name })
                },
                select: {
                    id: true,
                    email: true,
                    full_name: true,
                    role: true,
                    is_active: true,
                    created_at: true,
                    last_login_at: true,
                    camera_consent: true,
                    geolocation_consent: true,
                    face_enrolled: true
                }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    patchUserById: async function patchUserById(prisma: PrismaClient, userId: string, payload: Partial<{ is_active: boolean, role: string }>) {
        try {
            if (Object.keys(payload).length === 0) {
                throw new BadRequestError("No fields to update");
            }

            return await prisma.users.update({
                where: { id: userId },
                data: {
                    ...(payload.is_active !== undefined && { is_active: Boolean(payload.is_active) }),
                    ...(payload.role !== undefined && { role: payload.role.toLowerCase() as any }),
                    updated_at: new Date()
                },
                select: {
                    id: true,
                    email: true,
                    full_name: true,
                    role: true,
                    is_active: true,
                    created_at: true,
                    last_login_at: true,
                    camera_consent: true,
                    geolocation_consent: true,
                    face_enrolled: true
                }
            });
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    faceEnroll: async function faceEnroll(prisma: PrismaClient, userId: string, image: string) {
        try {
            if (!userId) {
                throw new NotFoundError();
            }

            const user = await UserModel.getById(prisma, userId);
            if (!user.camera_consent) {
                throw new BadRequestError('Camera consent required before face enrollment');
            }

            if (!isBase64(image)) {
                throw new BadRequestError('Invalid image data');
            }

            let mlFaceEnrollResponse;
            try {
                mlFaceEnrollResponse = await MlServices.face.enroll.post({
                    user_id: userId,
                    image,
                    camera_consent: user.camera_consent
                });
            } catch (err) {
                console.error('Something went wrong in the ML service...', err);
                throw new UnavailableError();
            }

            await prisma.users.update({
                where: { id: userId },
                data: {
                    face_enrolled: true,
                    face_embedding_hash: mlFaceEnrollResponse.face_template_hash,
                    updated_at: new Date()
                }
            });

            return {
                success: true,
                message: 'Face enrolled successfully',
                face_enrolled: true,
                quality_score: mlFaceEnrollResponse.quality_score
            }
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    deactivateById: async (prisma: PrismaClient, userId: string) => {
        try {
            return await prisma.users.update({
                where: { id: userId },
                data: {
                    is_active: false,
                    scheduled_deletion_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    updated_at: new Date()
                },
                select: {
                    id: true,
                    email: true,
                    is_active: true
                }
            });
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    activateById: async (prisma: PrismaClient, userId: string) => {
        try {
            const user = await prisma.users.update({
                where: { id: userId },
                data: {
                    is_active: true,
                    scheduled_deletion_at: null,
                    updated_at: new Date()
                },
                select: {
                    id: true,
                    email: true,
                    is_active: true
                }
            });

            return user;
        } catch (err: any) {
            if (err?.code === PrismaCodeMap.NOT_FOUND) {
                throw new NotFoundError();
            }
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
}
