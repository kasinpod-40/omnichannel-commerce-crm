import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import { buildLarkDashboardAppLink } from "./lark-applink";

const env = {
    LARK_APP_ID: "cli_test_app",
} as Env;

describe("Lark Web App AppLink", () => {
    it("แยก Payment Review returnTo ออกจาก path เพื่อให้ Mobile และ Desktop รักษาปลายทางครบ", () => {
        const returnTo =
            "/orders/rec-order-001?review=1&notification=noti-001";
        const result = buildLarkDashboardAppLink(env, returnTo);
        const appLink = new URL(result);

        expect(appLink.origin).toBe("https://applink.larksuite.com");
        expect(appLink.pathname).toBe("/client/web_app/open");
        expect(appLink.searchParams.get("appId")).toBe("cli_test_app");
        expect(appLink.searchParams.get("mode")).toBe("window");
        expect(appLink.searchParams.get("path")).toBe("/lark-entry");
        expect(appLink.searchParams.get("path")).not.toContain("?");
        expect(appLink.searchParams.get("source")).toBe("lark");
        expect(appLink.searchParams.get("crm_return_to")).toBe(returnTo);
    });

    it("ไม่สร้างลิงก์เมื่อ LARK_APP_ID ไม่มีค่า", () => {
        expect(() =>
            buildLarkDashboardAppLink(
                { ...env, LARK_APP_ID: "" },
                "/orders/rec-order-001"
            )
        ).toThrow("LARK_APP_ID is not configured");
    });

    it("ปฏิเสธ returnTo ที่พยายามออกนอก Dashboard", () => {
        expect(() =>
            buildLarkDashboardAppLink(env, "https://evil.example.com")
        ).toThrow("must be an internal absolute path");
        expect(() =>
            buildLarkDashboardAppLink(env, "//evil.example.com")
        ).toThrow("must be an internal absolute path");
    });
});
