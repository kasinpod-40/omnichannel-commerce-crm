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
    it("serves the page with strict security headers when enabled", async () => {
        const response = handleDemoShopPage(
            new Request("https://worker.example.com/demo-shop"),
            env()
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("Content-Type")).toContain("text/html");
        expect(response.headers.get("Content-Security-Policy")).toContain(
            "default-src 'none'"
        );
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
