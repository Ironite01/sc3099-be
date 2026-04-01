import * as bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { isBase64, isStrongPassword } from '../helpers/regex.js';
import { BadRequestError, AppError, ForbiddenError, NotFoundError, UnauthorizedError, UnavailableError } from './error.js';
import { SALT_ROUNDS } from '../helpers/constants.js';
import { MlServices } from '../services/ml/index.js';
import generateRandomPassword from '../helpers/generateRandomPassword.js';

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

export type User = {
    id: string;
    email: string;
    full_name: string;
    hashed_password: string;
    role: string;
    is_active: boolean;
    created_at: Date;
    last_login_at: Date | null;
    camera_consent: boolean;
    face_enrolled: boolean;
    geolocation_consent: boolean;
    face_embedding_hash?: string;
    scheduled_deletion_at?: Date | null;
    updated_at?: Date | null;
};

export const UserModel = {
    getUsersByEmail: async (pgClient: any, emails: string[]) => {
        try {
            const { rows } = await pgClient.query(
                'SELECT id, email, full_name, role, is_active FROM users WHERE email = ANY($1)',
                [emails]
            );

            return rows as User[];
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getByFilteredUsers: async function getByFilteredUsers(pgClient: any, filters: Partial<{ role: string, search: string, is_active: boolean, limit: number, offset: number }>) {
        try {
            const { role, is_active, limit, offset, search } = filters;

            const conditions: string[] = [];
            const values: any[] = [];
            let paramIndex = 1;

            if (role) {
                if (!Object.values(USER_ROLE_TYPES).includes(role.toLowerCase() as USER_ROLE_TYPES)) {
                    throw new BadRequestError("Invalid role filter");
                }
                conditions.push(`role = $${paramIndex}`);
                values.push(role.toLowerCase());
                paramIndex++;
            }
            if (is_active !== undefined) {
                conditions.push(`is_active = $${paramIndex}`);
                values.push(is_active);
                paramIndex++;
            }
            if (search) {
                conditions.push(`(email ILIKE $${paramIndex} OR full_name ILIKE $${paramIndex + 1})`);
                values.push(`%${search}%`);
                values.push(`%${search}%`);
                paramIndex += 2;
            }

            const countResult = await pgClient.query(`SELECT COUNT(*) as count FROM users ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}`, values);
            const total = parseInt(countResult.rows[0].count);

            const { rows } = await pgClient.query(
                `SELECT id, email, full_name, role, is_active, created_at, last_login_at, camera_consent, geolocation_consent, face_enrolled FROM users
                ${conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''}
                LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
                `,
                [...values, limit || 50, offset || 0]
            );

            return {
                items: rows as User[],
                total,
                limit: limit || 50,
                offset: offset || 0
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getById: async function getById(pgClient: any, id: string) {
        try {
            const { rows } = await pgClient.query(
                'SELECT id, email, full_name, role, is_active, created_at, last_login_at, camera_consent, geolocation_consent, face_enrolled, face_embedding_hash FROM users WHERE id = $1',
                [id]
            );
            if (rows.length === 0) {
                throw new NotFoundError();
            }
            const user: User = rows[0];

            if (!user.is_active) {
                throw new ForbiddenError("Account disabled");
            }

            return user;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    getEnrolledUserByInstructorId: async function getEnrolledUserByInstructorId(pgClient: any, instructorId: string, studentId: string) {
        try {
            const { rows } = await pgClient.query(
                `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.created_at, u.last_login_at, u.camera_consent, u.geolocation_consent, u.face_enrolled
                FROM users u
                JOIN sessions s ON s.instructor_id = $1
                JOIN enrollments e ON e.student_id = u.id AND s.course_id = e.course_id
                JOIN courses c ON c.id = s.course_id
                WHERE u.id = $2 AND u.is_active = true`,
                [instructorId, studentId]
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
    create: async (pgClient: PoolClient, payload: Partial<User> & { password: string }) => {
        try {
            const { email, password, full_name, role } = payload;

            // Email validation is handled by ajv
            if (!isStrongPassword(password)) {
                throw new BadRequestError("Password too weak");
            }

            // Store the user data
            const salt = bcrypt.genSaltSync(SALT_ROUNDS);
            const hashed_password = bcrypt.hashSync(password, salt);

            const resDb = await pgClient.query(
                `INSERT INTO users (id, email, full_name, hashed_password, role, created_at, updated_at, is_active)
                VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, true)
                ON CONFLICT (email) DO NOTHING
                RETURNING id, email, full_name, role, is_active, created_at, last_login_at;`,
                [email, full_name, hashed_password, role!.toLowerCase(), new Date(), new Date()]
            );

            if (resDb.rowCount === 0) {
                throw new BadRequestError("Email already registered");
            }
            return resDb.rows[0] as User;
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    createMultipleUsers: async function createMultipleUsers(pgClient: PoolClient, users: Array<Partial<User>>) {
        try {
            if (!users || users.length === 0) {
                return [];
            }

            const hashedUsers = users.map(user => {
                let hashed_password: string;
                if ((user as any).password) {
                    hashed_password = (user as any).password;
                } else {
                    hashed_password = bcrypt.hashSync(generateRandomPassword(), bcrypt.genSaltSync(SALT_ROUNDS));
                }
                return {
                    email: user.email,
                    full_name: user.full_name,
                    hashed_password,
                    role: user.role!.toLowerCase()
                }
            });

            // Build the multi-value INSERT query
            const values: any[] = [];
            const placeholders: string[] = [];
            let paramIndex = 1;

            for (const user of hashedUsers) {
                placeholders.push(`(gen_random_uuid()::text, $${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, true)`);
                values.push(user.email, user.full_name, user.hashed_password, user.role, new Date(), new Date());
                paramIndex += 6;
            }

            const { rows } = await pgClient.query(
                `INSERT INTO users (id, email, full_name, hashed_password, role, created_at, updated_at, is_active)
                VALUES ${placeholders.join(', ')}
                ON CONFLICT (email) DO NOTHING
                RETURNING id, email, full_name, role, is_active;`,
                values
            );

            return rows as User[];
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    login: async function login(pgClient: PoolClient, email: string, passwordClaim: string) {
        try {
            // Query database for user by email
            const { rows } = await pgClient.query(
                'SELECT id, email, full_name, hashed_password, role, is_active, created_at, last_login_at FROM users WHERE email = $1',
                [email]
            );

            // Check if user exists
            if (rows.length === 0) {
                throw new UnauthorizedError();
            }

            const user: User = rows[0];

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
            await pgClient.query(
                'UPDATE users SET last_login_at = NOW() WHERE id = $1',
                [user.id]
            );

            return {
                ...user,
                hashed_password: undefined
            };
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    updateById: async function updateById(pgClient: PoolClient, userId: string, payload: Partial<{ camera_consent: boolean, geolocation_consent: boolean, full_name: string }>) {
        try {
            const { camera_consent, geolocation_consent, full_name } = payload;

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

            const user = await UserModel.getById(pgClient, userId);
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

            const rows = await pgClient.query(
                'UPDATE users SET face_enrolled = TRUE, face_embedding_hash = $2 WHERE id = $1',
                [userId, mlFaceEnrollResponse.face_template_hash]
            );
            if (rows.rowCount === 0) {
                throw new NotFoundError();
            }

            return {
                success: true,
                message: 'Face enrolled successfully',
                face_enrolled: true,
                quality_score: mlFaceEnrollResponse.quality_score
            }
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    deactivateById: async (pgClient: PoolClient, userId: string) => {
        try {
            const { rows } = await pgClient.query(
                `UPDATE users
                 SET is_active = FALSE, updated_at = NOW(), scheduled_deletion_at = NOW()
                 WHERE id = $1
                 RETURNING id, email`,
                [userId]
            );

            if (rows.length === 0) {
                throw new NotFoundError();
            }

            const user = rows[0] as Partial<User>;
            return {
                id: user.id,
                email: user.email,
                is_active: false
            }
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    },
    activateById: async (pgClient: PoolClient, userId: string) => {
        try {
            const { rows } = await pgClient.query(
                `UPDATE users
                 SET is_active = TRUE, updated_at = NOW(), scheduled_deletion_at = NULL
                 WHERE id = $1
                 RETURNING id, email`,
                [userId]
            );

            if (rows.length === 0) {
                throw new NotFoundError();
            }

            const user = rows[0] as Partial<User>;
            return {
                id: user.id,
                email: user.email,
                is_active: true
            }
        } catch (err: any) {
            if (err instanceof AppError) throw err;
            throw new BadRequestError('Database operation failed');
        }
    }
}
