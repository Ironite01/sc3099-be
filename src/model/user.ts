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

export async function authenticate(username: String, passwordClaim: string) {
    // Below hash is value = "test"
    const hashValue = "$2b$10$bpK6AUNVhwrIBBVS0AmVROQeHbjphYeYeyY4aUhMMqQrRbUK89yfG";
    const match = await bcrypt.compare(passwordClaim, hashValue);

    if (!match) {
        throw new Error("Password is incorrect!");
    }

    return { id: 1, username: "Nelson" };
}