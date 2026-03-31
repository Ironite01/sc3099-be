export default function extractNameFromEmail(email: string): string {
    return (email.split('@')[0] ?? '')
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, (c: string) => c.toUpperCase())
        .trim() || 'Student';
}