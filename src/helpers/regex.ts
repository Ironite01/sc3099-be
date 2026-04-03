export function isBase64(image: string) {
    if (!image || typeof image !== 'string' || image.trim().length === 0) {
        return false;
    }
    const base64Regex = /^[A-Za-z0-9+/=]*$/;
    return base64Regex.test(image);
}