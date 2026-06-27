import {
    getCookie,
    SESSION_COOKIE_NAME,
} from "./auth-cookie";

const MAX_SESSION_TOKEN_LENGTH = 8_192;

/**
 * อ่าน Dashboard Session จาก Bearer token ก่อน แล้ว fallback เป็น HttpOnly Cookie
 * Bearer ใช้เฉพาะ Web App ภายใน Lark iOS ที่อาจบล็อก third-party cookie ข้ามโดเมน
 */
export function getDashboardSessionToken(
    request: Request
): string | null {
    const authorization = request.headers.get("Authorization")?.trim() ?? "";
    const match = /^Bearer\s+(.+)$/iu.exec(authorization);

    if (match) {
        const token = match[1]?.trim() ?? "";
        if (token && token.length <= MAX_SESSION_TOKEN_LENGTH) {
            return token;
        }
        return null;
    }

    return getCookie(request, SESSION_COOKIE_NAME);
}
