import type { Env } from "../../config/env";
import { AuthError } from "./auth.error";

export type CookieSameSite = "Lax" | "Strict" | "None";

function requireText(value: string | undefined, name: string): string {
    const normalized = value?.trim() ?? "";

    if (!normalized) {
        throw new AuthError(
            "AUTH_CONFIG_MISSING",
            `Missing authentication configuration: ${name}`,
            500
        );
    }

    return normalized;
}

/** URL หลักของ React Dashboard เช่น https://crm.example.com */
export function getDashboardUrl(env: Env): URL {
    const value = requireText(env.DASHBOARD_URL, "DASHBOARD_URL");

    try {
        return new URL(value);
    } catch (error) {
        throw new AuthError(
            "AUTH_CONFIG_INVALID",
            "DASHBOARD_URL must be an absolute URL",
            500,
            error
        );
    }
}

/** Callback URL ต้องตรงกับค่าที่ตั้งใน Lark Developer Console ทุกตัวอักษร */
export function getLarkRedirectUri(env: Env): string {
    return requireText(
        env.LARK_AUTH_REDIRECT_URI,
        "LARK_AUTH_REDIRECT_URI"
    );
}

export function getSessionSecret(env: Env): string {
    const secret = requireText(
        env.AUTH_SESSION_SECRET,
        "AUTH_SESSION_SECRET"
    );

    if (secret.length < 32) {
        throw new AuthError(
            "AUTH_SESSION_SECRET_WEAK",
            "AUTH_SESSION_SECRET must contain at least 32 characters",
            500
        );
    }

    return secret;
}

export function getSessionTtlSeconds(env: Env): number {
    const configured = Number(env.AUTH_SESSION_TTL_SECONDS ?? "28800");

    if (!Number.isFinite(configured)) {
        return 28_800;
    }

    // จำกัด Session ระหว่าง 5 นาทีถึง 24 ชั่วโมง ป้องกันค่าผิดพลาดจน Session ยาวเกินควร
    return Math.min(Math.max(Math.floor(configured), 300), 86_400);
}

export function getCookieSameSite(env: Env): CookieSameSite {
    const value = env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase();

    if (value === "strict") {
        return "Strict";
    }

    if (value === "none") {
        return "None";
    }

    return "Lax";
}

/**
 * รายการ Origin ที่อนุญาตให้ React เรียก API พร้อม Cookie
 * DASHBOARD_URL ถูกเพิ่มให้อัตโนมัติ ส่วน AUTH_ALLOWED_ORIGINS ใช้เพิ่ม localhost หรือหลาย Domain
 */
export function getAllowedOrigins(env: Env): Set<string> {
    const origins = new Set<string>([getDashboardUrl(env).origin]);

    for (const item of (env.AUTH_ALLOWED_ORIGINS ?? "").split(",")) {
        const value = item.trim();

        if (!value) {
            continue;
        }

        try {
            origins.add(new URL(value).origin);
        } catch {
            // ข้ามค่าที่ไม่ใช่ URL เพื่อไม่ให้ CORS เปิดกว้างจาก Config ผิดรูป
        }
    }

    return origins;
}

/**
 * return_to ต้องเป็น path ภายใน Dashboard เท่านั้น
 * ปฏิเสธ //evil.example และ backslash เพื่อป้องกัน Open Redirect
 */
export function sanitizeReturnTo(value: string | null | undefined): string {
    const normalized = value?.trim() ?? "";

    if (
        !normalized.startsWith("/") ||
        normalized.startsWith("//") ||
        normalized.includes("\\")
    ) {
        return "/";
    }

    return normalized;
}
