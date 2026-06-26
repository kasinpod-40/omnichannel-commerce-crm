import type { Env } from "../../config/env";
import {
    exchangeLarkAuthorizationCode,
    getLarkLoginIdentity,
} from "../../providers/lark/lark-auth.provider";
import { AuthError } from "./auth.error";
import { createAuthSession } from "./auth.session";
import type {
    AuthSessionResponse,
    AuthUserResponse,
    LarkLoginIdentity,
} from "./auth.types";

function validateAuthorizationCode(code: string): string {
    const normalized = code.trim();

    if (!normalized || normalized.length > 2_048) {
        throw new AuthError(
            "AUTH_CODE_INVALID",
            "Lark authorization code is missing or invalid",
            400
        );
    }

    return normalized;
}

/**
 * ตรวจ Tenant เพิ่มอีกชั้นเมื่อมีการตั้ง LARK_ALLOWED_TENANT_KEY
 *
 * ผู้เรียกใช้: authenticateWithLarkCode() หลังอ่านข้อมูลผู้ใช้จาก Lark แล้ว
 * เหตุผล: App Availability เป็นด่านหลักว่าใครใช้แอปได้ ส่วน Tenant Key ช่วยป้องกัน
 * การรับ Session จากบัญชีองค์กรอื่น หากภายหลังมีการเปลี่ยนชนิดหรือการติดตั้งแอป
 *
 * ถ้ายังไม่ได้ตั้งค่า Environment นี้ ระบบจะอาศัย Lark App Availability เพียงอย่างเดียว
 * เพื่อให้เริ่มใช้งานได้โดยไม่ต้องสร้างตารางสิทธิ์ผู้ใช้เพิ่ม
 */
function assertAllowedTenant(
    env: Env,
    identity: LarkLoginIdentity
): void {
    const allowedTenantKey = env.LARK_ALLOWED_TENANT_KEY?.trim() ?? "";

    if (!allowedTenantKey) {
        return;
    }

    if (!identity.tenant_key) {
        throw new AuthError(
            "AUTH_TENANT_MISSING",
            "Lark user information does not include tenant_key",
            403
        );
    }

    if (identity.tenant_key !== allowedTenantKey) {
        throw new AuthError(
            "AUTH_TENANT_FORBIDDEN",
            "This Lark account belongs to a different tenant",
            403
        );
    }
}

/**
 * สร้างข้อมูลผู้ใช้ Dashboard จากบัญชี Lark โดยตรง
 *
 * ไม่มีการอ่านตารางสิทธิ์ผู้ใช้เพิ่ม ชื่อ รูป และอีเมลจึงมาจากผู้ใช้ที่ Login อยู่จริง
 * user_id เลือก Lark user_id ก่อน แล้ว fallback เป็น union_id/open_id เพราะบาง Field
 * จะไม่ถูกส่งกลับหากแอปยังไม่ได้ขอ Permission เพิ่มเติม
 *
 * Frontend v1.0.0 รองรับ role เฉพาะ admin/manager/sales จึงใช้ admin เป็นค่า
 * compatibility สำหรับโหมดสิทธิ์ร่วมกันทั้งองค์กร ตอนนี้ Backend ยังไม่ใช้ Role นี้
 * จำกัดข้อมูลหรืออนุญาตคำสั่งแก้ไขใด ๆ
 */
function createUserFromLarkIdentity(
    identity: LarkLoginIdentity
): AuthUserResponse {
    return {
        user_id:
            identity.user_id ??
            identity.union_id ??
            identity.open_id,
        lark_open_id: identity.open_id,
        name: identity.name,
        email: identity.email,
        avatar_url: identity.avatar_url,
        role: "admin",
        sales_owner_name: null,
    };
}

/**
 * Flow กลางของทั้ง Browser Login และ Lark Client Login
 *
 * ลำดับการเรียก:
 * routes/auth/auth.route.ts
 * → authenticateWithLarkCode()
 * → exchangeLarkAuthorizationCode() แลก Temporary Code
 * → getLarkLoginIdentity() อ่านบัญชีที่ Login อยู่
 * → ตรวจ Tenant เมื่อเปิดใช้ Config
 * → createAuthSession() สร้าง HttpOnly Session Cookie
 *
 * ผู้ใช้ที่ Lark App Availability อนุญาตจะเข้า Dashboard ได้ทันที
 * โดยไม่ต้องมี Record ใน Lark Base เพิ่มอีกตาราง
 */
export async function authenticateWithLarkCode(
    env: Env,
    code: string,
    nowMs = Date.now()
): Promise<{
    token: string;
    response: AuthSessionResponse;
}> {
    const userAccessToken = await exchangeLarkAuthorizationCode(
        env,
        validateAuthorizationCode(code)
    );
    const identity = await getLarkLoginIdentity(userAccessToken);

    assertAllowedTenant(env, identity);

    const user = createUserFromLarkIdentity(identity);
    const session = await createAuthSession(env, user, nowMs);

    return {
        token: session.token,
        response: {
            user,
            expires_at: new Date(
                session.payload.expires_at * 1_000
            ).toISOString(),
        },
    };
}
