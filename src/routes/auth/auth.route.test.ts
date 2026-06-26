import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import { createAuthSession } from "../../modules/auth/auth.session";
import {
    handleAuthLogout,
    handleAuthMe,
    handleLarkBrowserLogin,
} from "./auth.route";

const env = {
    LARK_APP_ID: "cli_test",
    DASHBOARD_URL: "https://crm.example.com",
    LARK_AUTH_REDIRECT_URI:
        "https://api.example.com/auth/lark/callback",
    AUTH_ALLOWED_ORIGINS:
        "https://crm.example.com,http://localhost:5173",
    AUTH_SESSION_SECRET:
        "test-secret-that-is-longer-than-thirty-two-characters",
    AUTH_SESSION_TTL_SECONDS: "3600",
    AUTH_COOKIE_SAME_SITE: "Lax",
} as Env;

const user = {
    user_id: "rec_user_001",
    lark_open_id: "ou_001",
    name: "CRM Admin",
    email: null,
    avatar_url: null,
    role: "admin" as const,
    sales_owner_name: null,
};

describe("authentication routes", () => {
    it("เริ่ม Browser OAuth พร้อม state cookie และ return_to ภายในระบบ", async () => {
        const response = await handleLarkBrowserLogin(
            new Request(
                "https://api.example.com/auth/lark/login?return_to=%2Forders%3Fpage%3D2"
            ),
            env
        );

        expect(response.status).toBe(302);
        const location = new URL(response.headers.get("Location") ?? "");
        expect(location.origin).toBe("https://open.larksuite.com");
        expect(location.searchParams.get("app_id")).toBe("cli_test");
        expect(location.searchParams.get("state")).toBeTruthy();
        expect(response.headers.get("Set-Cookie")).toContain(
            "crm_oauth_state="
        );
    });

    it("คืน Session Contract ที่ตรงกับ Frontend จาก /auth/me", async () => {
        const session = await createAuthSession(env, user);
        const response = await handleAuthMe(
            new Request("https://api.example.com/auth/me", {
                headers: {
                    Origin: "https://crm.example.com",
                    Cookie: `crm_session=${encodeURIComponent(session.token)}`,
                },
            }),
            env
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
            "https://crm.example.com"
        );
        await expect(response.json()).resolves.toMatchObject({
            user: {
                user_id: "rec_user_001",
                lark_open_id: "ou_001",
                role: "admin",
            },
        });
    });

    it("ปฏิเสธ Logout จาก Origin ที่ไม่ได้อนุญาต", async () => {
        const response = await handleAuthLogout(
            new Request("https://api.example.com/auth/logout", {
                method: "POST",
                headers: { Origin: "https://evil.example" },
            }),
            env
        );

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_ORIGIN_FORBIDDEN",
        });
    });
});
