import { describe, expect, it } from "vitest";
import { getDashboardSessionToken } from "./auth-session-token";

describe("getDashboardSessionToken", () => {
    it("เลือก Bearer token ก่อน Cookie สำหรับ Lark client session", () => {
        const request = new Request("https://api.example.com/dashboard/summary", {
            headers: {
                Authorization: "Bearer bearer-token",
                Cookie: "crm_session=cookie-token",
            },
        });

        expect(getDashboardSessionToken(request)).toBe("bearer-token");
    });

    it("fallback เป็น HttpOnly Cookie สำหรับ Browser OAuth", () => {
        const request = new Request("https://api.example.com/dashboard/summary", {
            headers: { Cookie: "crm_session=cookie-token" },
        });

        expect(getDashboardSessionToken(request)).toBe("cookie-token");
    });

    it("ปฏิเสธ Bearer token ที่ยาวผิดปกติ", () => {
        const request = new Request("https://api.example.com/auth/me", {
            headers: { Authorization: `Bearer ${"x".repeat(8_193)}` },
        });

        expect(getDashboardSessionToken(request)).toBeNull();
    });
});
