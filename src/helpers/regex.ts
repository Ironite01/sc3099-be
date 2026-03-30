export function isStrongPassword(password: string) {
    const re = new RegExp("^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$%^&*-]).{8,}$");
    return re.test(password);
}

export function isBase64(image: string) {
    if (!image || typeof image !== 'string' || image.trim().length === 0) {
        return false;
    }
    const base64Regex = /^[A-Za-z0-9+/=]*$/;
    return base64Regex.test(image);
}