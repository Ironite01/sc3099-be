import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

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
export class User {
    id!: string;
    email!: string;
    fullName!: string;
    role!: USER_ROLE_TYPES;
    isActive!: boolean;
    createdAt!: Date;
    lastLoginAt: Date | undefined;

    constructor(id: string, email: string, fullName: string, role: USER_ROLE_TYPES, isActive: boolean, createdAt: Date, lastLoginAt?: Date) {
        this.id = id;
        this.email = email;
        this.fullName = fullName;
        this.role = role.toLowerCase() as USER_ROLE_TYPES;
        this.isActive = isActive;
        this.createdAt = createdAt;
        this.lastLoginAt = lastLoginAt;
    }
}

export async function getUserById(pgClient: any, id: number) {
    const { rows } = await pgClient.query(
        'SELECT id, email, role FROM users WHERE id = $1 AND is_active = TRUE',
        [id]
    );
    if (rows.length === 0) {
        throw new Error("User not found or inactive");
    }
    return rows[0];
}

export function createUser(payload: any) {
    if (!payload || !payload.passwordClaim) {
        throw new Error("User password is empty!");
    }
    // TODO: Regex for strong password
    const salt = bcrypt.genSaltSync(SALT_ROUNDS);
    const hash = bcrypt.hashSync(payload.passwordClaim, salt);

    console.log("Creating user with hash = ", hash);
}

export async function authenticate(pgClient: any, email: string, passwordClaim: string) {
    // Query database for user by email
    const { rows } = await pgClient.query(
        'SELECT id, email, full_name, hashed_password, role, is_active, created_at, last_login_at FROM users WHERE email = $1 AND is_active = TRUE',
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