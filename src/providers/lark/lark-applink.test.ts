import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import { buildLarkDashboardAppLink } from "./lark-applink";

const env = {
    LARK_APP_ID: "cli_test_app",
} as Env;

describe("Lark Web App AppLink", () => {
    it("เปิด Payment Review ผ่าน /lark-entry และรักษา returnTo ครบ", () => {
        const returnTo =
            "/orders/rec-order-001?review=1&notification=noti-001";
        const result = buildLarkDashboardAppLink(env, returnTo);
        const appLink = new URL(result);

        expect(appLink.origin).toBe("https://applink.larksuite.com");
        expect(appLink.pathname).toBe("/client/web_app/open");
        expect(appLink.searchParams.get("appId")).toBe("cli_test_app");
        expect(appLink.searchParams.get("mode")).toBe("window");

        const appPath = appLink.searchParams.get("path");
        expect(appPath).toBeTruthy();
        const entryUrl = new URL(appPath!, "https://crm.example.com");
        expect(entryUrl.pathname).toBe("/lark-entry");
        expect(entryUrl.searchParams.get("returnTo")).toBe(returnTo);
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
