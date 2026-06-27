import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";

const authenticateWithLarkCode = vi.hoisted(() => vi.fn());

vi.mock("../../modules/auth/auth.service", () => ({
    authenticateWithLarkCode,
}));

import { handleLarkClientSession } from "./auth.route";

const env = {
    LARK_APP_ID: "cli_test",
    DASHBOARD_URL: "https://crm.example.com",
    AUTH_ALLOWED_ORIGINS: "https://crm.example.com",
    AUTH_SESSION_SECRET:
        "test-secret-that-is-longer-than-thirty-two-characters",
    AUTH_SESSION_TTL_SECONDS: "3600",
    AUTH_COOKIE_SAME_SITE: "Lax",
} as Env;

describe("Lark client session route", () => {
    beforeEach(() => {
        authenticateWithLarkCode.mockReset();
    });

    it("คืน bearer session_token พร้อม Session Contract และ Set-Cookie fallback", async () => {
        authenticateWithLarkCode.mockResolvedValue({
            token: "signed-session-token",
            response: {
                user: {
                    user_id: "user-1",
                    lark_open_id: "ou-1",
                    name: "CRM User",
                    email: null,
                    avatar_url: null,
                    role: "admin",
                    sales_owner_name: null,
                },
                expires_at: "2026-06-28T00:00:00.000Z",
            },
        });

        const response = await handleLarkClientSession(
            new Request("https://api.example.com/auth/lark/client-session", {
                method: "POST",
                headers: {
                    Origin: "https://crm.example.com",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ code: "temporary-code", return_to: "/" }),
            }),
            env
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Set-Cookie")).toContain("crm_session=");
        expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
            "Authorization"
        );
        await expect(response.json()).resolves.toMatchObject({
            session_token: "signed-session-token",
            user: { user_id: "user-1" },
        });
    });
});
