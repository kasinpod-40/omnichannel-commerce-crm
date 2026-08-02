import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import { handleDemoShopPage } from "./demo-shop.route";

function env(enabled = "true"): Env {
    return {
        PC_DEMO_SHOP_ENABLED: enabled,
        DASHBOARD_URL: "https://dashboard.example.com",
    } as unknown as Env;
}

describe("Demo Shop page route", () => {
    it("serves the page with strict headers and only the approved Kanit hosts", async () => {
        const response = handleDemoShopPage(
            new Request("https://worker.example.com/demo-shop"),
            env()
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("text/html");
        const csp = response.headers.get("Content-Security-Policy") ?? "";
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("https://fonts.googleapis.com");
        expect(csp).toContain("font-src https://fonts.gstatic.com");
        expect(csp).toContain("connect-src 'self'");
        expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
        await expect(response.text()).resolves.toContain("<title>Demo Shop</title>");
    });

    it("stays hidden while the Demo Shop feature flag is disabled", () => {
        const response = handleDemoShopPage(
            new Request("https://worker.example.com/demo-shop"),
            env("false")
        );

        expect(response.status).toBe(404);
    });

    it("rejects non-GET page requests", () => {
        const response = handleDemoShopPage(
            new Request("https://worker.example.com/demo-shop", {
                method: "POST",
            }),
            env()
        );

        expect(response.status).toBe(405);
        expect(response.headers.get("Allow")).toBe("GET");
    });
});
