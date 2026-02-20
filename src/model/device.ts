

export default class Device {
    id!: string;
    user_id!: string;
    device_fingerprint!: string;
    device_name?: string | null;
    platform?: string | null;
    browser?: string | null;
    os_version?: string | null;
    app_version?: string | null;
    public_key!: string;
    public_key_created_at!: Date;
    public_key_expires_at?: Date | null;
    attestation_passed?: boolean | null;
    last_attestation_at?: Date | null;
    attestation_token?: string | null;
    is_trusted?: boolean | null;
    trust_score?: string | number | null;
    is_emulator?: boolean | null;
    is_rooted_jailbroken?: boolean | null;
    first_seen_at!: Date;
    last_seen_at!: Date;

}