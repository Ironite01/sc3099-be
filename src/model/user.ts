import * as bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { isStrongPassword } from '../helpers/regex.js';
import { v4 as uuidv4 } from 'uuid';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from './error.js';
import { SALT_ROUNDS } from '../helpers/constants.js';

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
};

export const UserModel = {
    getById: async function getById(pgClient: any, id: string) {
        const { rows } = await pgClient.query(
            'SELECT id, email, full_name, role, is_active, created_at, last_login_at, camera_consent, geolocation_consent, face_enrolled FROM users WHERE id = $1',
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
    },
    create: async function create(pgClient: PoolClient, payload: Partial<User> & { password: string, raw_face_data: string }) {
        const { email, password, full_name, role, raw_face_data } = payload;

        // Email validation is handled by ajv
        if (!isStrongPassword(password)) {
            throw new BadRequestError("Password too weak");
        }

        // TODO: Fetch the ML service

        // Store the user data
        const salt = bcrypt.genSaltSync(SALT_ROUNDS);
        const hashed_password = bcrypt.hashSync(password, salt);

        const resDb = await pgClient.query(
            `INSERT INTO users (id, email, full_name, hashed_password, role, face_embedding_hash, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (email) DO NOTHING
            RETURNING id, email, full_name, role, is_active, created_at, last_login_at;`,
            [uuidv4(), email, full_name, hashed_password, role!.toLowerCase(), "blablabla", new Date(), new Date()]
        );

        if (resDb.rowCount === 0) {
            throw new BadRequestError("Email already registered");
        }
        return resDb.rows[0] as User;
    },
    login: async function login(pgClient: PoolClient, email: string, passwordClaim: string) {
        // TODO: Transaction to select user AND update last_login_at

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
    }
}
