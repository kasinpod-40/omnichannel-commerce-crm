import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import { handleAuthLogout } from "./auth.route";

const env = {
    AUTH_COOKIE_SAME_SITE: "None",
} as Env;

describe("same-origin logout", () => {
    it("allows the Worker Demo Shop origin and clears the session cookie", async () => {
        const response = await handleAuthLogout(
            new Request("https://worker.example.com/auth/logout", {
                method: "POST",
                headers: {
                    Origin: "https://worker.example.com",
                    Cookie: "crm_session=session-token",
                },
            }),
            env
        );

        expect(response.status).toBe(204);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
            "https://worker.example.com"
        );
        const cookie = response.headers.get("Set-Cookie") ?? "";
        expect(cookie).toContain("crm_session=");
        expect(cookie).toContain("Max-Age=0");
        expect(cookie).toContain("SameSite=None");
        expect(cookie).toContain("Secure");
    });

    it("continues to reject a foreign origin", async () => {
        const response = await handleAuthLogout(
            new Request("https://worker.example.com/auth/logout", {
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
