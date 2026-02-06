import * as bcrypt from 'bcrypt';
import type { PoolClient } from 'pg';
import { isEmailValid, isStrongPassword } from '../helpers/regex.js';
import { v4 as uuidv4 } from 'uuid';

const SALT_ROUNDS = 10;

export default class User {
    id!: string;
    email!: string;
    fullName!: string;
    role!: string;
    isActive!: boolean;
    createdAt!: Date;
    lastLoginAt: Date | undefined;

    constructor(id: string, email: string, fullName: string, role: string, isActive: boolean, createdAt: Date, lastLoginAt?: Date) {
        this.id = id;
        this.email = email;
        this.fullName = fullName;
        this.role = role;
        this.isActive = isActive;
        this.createdAt = createdAt;
        this.lastLoginAt = lastLoginAt;
    }

    static async create(pgClient: PoolClient, payload: any) {
        const { email, password, full_name, role, raw_face_data } = payload;

        if (!isEmailValid(email)) {
            throw new Error("Email is not valid!");
        }

        if (!isStrongPassword(password)) {
            throw new Error("Password is not strong!");
        }

        // TODO: Fetch the ML service

        // Store the user data
        const salt = bcrypt.genSaltSync(SALT_ROUNDS);
        const hashed_password = bcrypt.hashSync(password, salt);

        const resDb = await pgClient.query(
            `INSERT INTO users (id, email, full_name, hashed_password, role, face_embedding_hash, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id, email, full_name, role, is_active, created_at, last_login_at;`,
            [uuidv4(), email, full_name, hashed_password, role.toLowerCase(), "blablabla", new Date(), new Date()]
        );

        const r = resDb.rows[0];
        return new User(r.id, r.email, r.full_name, r.role, r.is_active, r.created_at, r.last_login_at);
    }

    static async authenticate(pgClient: PoolClient, email: string, passwordClaim: string) {
        // Query database for user by email
        const { rows } = await pgClient.query(
            'SELECT id, email, full_name, hashed_password, role, is_active, created_at, last_login_at FROM users WHERE email = $1',
            [email]
        );

        // Check if user exists
        if (rows.length === 0) {
            throw new Error("User not found!");
        }

        const user = rows[0];

        // Check if user account is active
        if (!user.is_active) {
            throw new Error("User account is inactive!");
        }

        // Compare provided password with stored hash
        const match = await bcrypt.compare(passwordClaim, user.hashed_password);

        if (!match) {
            throw new Error("Password is incorrect!");
        }

        // Update last login timestamp
        await pgClient.query(
            'UPDATE users SET last_login_at = NOW() WHERE id = $1',
            [user.id]
        );

        // Return User class instance
        return new User(
            user.id,
            user.email,
            user.full_name,
            user.role,
            user.is_active,
            user.created_at,
            new Date()
        );
    }
}