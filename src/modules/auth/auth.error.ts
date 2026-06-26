/**
 * Error แบบมาตรฐานของ Auth
 * Route ใช้ status และ code เพื่อส่งข้อความที่ปลอดภัยกลับ Frontend
 * details ภายในไม่ควรถูกส่งให้ผู้ใช้ เพราะอาจมีข้อมูลจาก Lark API
 */
export class AuthError extends Error {
    readonly code: string;
    readonly status: number;
    readonly cause?: unknown;

    constructor(
        code: string,
        message: string,
        status: number,
        cause?: unknown
    ) {
        super(message);
        this.name = "AuthError";
        this.code = code;
        this.status = status;
        this.cause = cause;
    }
}

export function isAuthError(error: unknown): error is AuthError {
    return error instanceof AuthError;
}
