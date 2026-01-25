import * as bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

// Tentative specification
export class User {
    username!: string;
    profilePicture?: any | undefined;
    createdAt?: Date | undefined;

    constructor(username: string, profilePicture?: any) {
        this.username = username;
        this.profilePicture = profilePicture || undefined;
    }
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

    // Return user data without password
    return {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        isActive: user.is_active,
        createdAt: user.created_at,
        lastLoginAt: new Date()
    };
}