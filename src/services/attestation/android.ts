// Placeholder implementation to keep builds stable until Play Integrity
// dependencies and credentials are provisioned in deployment.
export default async function androidAttestationService(_token: string) {
    return {
        isEmulator: false,
        isRootedJailbroken: false,
        integrityVerdict: null
    };
}
