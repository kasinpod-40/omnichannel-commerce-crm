import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import {
    createAuthSession,
    createOAuthState,
    verifyAuthSession,
    verifyOAuthState,
} from "./auth.session";

const env = {
    AUTH_SESSION_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
    AUTH_SESSION_TTL_SECONDS: "3600",
} as Env;

const user = {
    user_id: "rec_user_001",
    lark_open_id: "ou_001",
    name: "CRM Admin",
    email: "admin@example.com",
    avatar_url: null,
    role: "admin" as const,
    sales_owner_name: null,
};

describe("auth session", () => {
    it("ลงลายเซ็นและตรวจ Session ที่ยังไม่หมดอายุได้", async () => {
        const created = await createAuthSession(env, user, 1_000_000);
        const verified = await verifyAuthSession(
            env,
            created.token,
            1_500_000
        );

        expect(verified.user.lark_open_id).toBe("ou_001");
        expect(verified.expires_at).toBeGreaterThan(verified.issued_at);
    });

    it("ปฏิเสธ Session ที่ถูกแก้ไขหลังลงลายเซ็น", async () => {
        const created = await createAuthSession(env, user, 1_000_000);
        const tampered = `${created.token.slice(0, -1)}x`;

        await expect(
            verifyAuthSession(env, tampered, 1_500_000)
        ).rejects.toMatchObject({ code: "AUTH_TOKEN_INVALID" });
    });

    it("ปฏิเสธ Session ที่หมดอายุ", async () => {
        const created = await createAuthSession(env, user, 1_000_000);

        await expect(
            verifyAuthSession(env, created.token, 5_000_000)
        ).rejects.toMatchObject({ code: "AUTH_SESSION_EXPIRED" });
    });

    it("เก็บ return_to ใน OAuth state และตรวจลายเซ็นได้", async () => {
        const created = await createOAuthState(
            env,
            "/orders?page=2",
            1_000_000
        );
        const verified = await verifyOAuthState(
            env,
            created.token,
            1_100_000
        );

        expect(verified.return_to).toBe("/orders?page=2");
    });
});
