/**
 * ชนิดข้อมูลกลางของระบบ Authentication
 * ผู้เรียกใช้: auth.repository.ts, auth.service.ts, auth.session.ts และ routes/auth
 * จุดสำคัญ: Frontend รับเฉพาะข้อมูลผู้ใช้ที่จำเป็น ไม่รับ Lark access token หรือ App Secret
 */

export type AuthRole = "admin" | "manager" | "sales";

export type LarkLoginIdentity = {
    open_id: string;
    union_id: string | null;
    user_id: string | null;
    tenant_key: string | null;
    name: string;
    email: string | null;
    avatar_url: string | null;
};

/** รูปแบบผู้ใช้ที่ต้องตรงกับ Auth Contract ของ React Dashboard */
export type AuthUserResponse = {
    user_id: string;
    lark_open_id: string;
    name: string;
    email: string | null;
    avatar_url: string | null;
    role: AuthRole;
    sales_owner_name: string | null;
};

export type AuthSessionResponse = {
    user: AuthUserResponse;
    expires_at: string;
};

export type AuthSessionPayload = {
    kind: "session";
    version: 1;
    session_id: string;
    user: AuthUserResponse;
    issued_at: number;
    expires_at: number;
};

export type OAuthStatePayload = {
    kind: "oauth_state";
    version: 1;
    nonce: string;
    return_to: string;
    issued_at: number;
    expires_at: number;
};
