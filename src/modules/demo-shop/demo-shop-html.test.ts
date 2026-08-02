import { describe, expect, it } from "vitest";
import { renderDemoShopHtml } from "./demo-shop-html";

describe("Demo Shop HTML", () => {
    it("renders Kanit, size variants and a processing popup", () => {
        const html = renderDemoShopHtml({
            dashboardUrl: "https://dashboard.example.com",
            nonce: "nonce123",
        });

        expect(html).toContain("<title>Demo Shop</title>");
        expect(html).toContain('<h1 id="page-title">Demo Shop</h1>');
        expect(html).toContain("สั่งซื้อสินค้า");
        expect(html).toContain("เลือกไซซ์");
        expect(html).toContain("groupProducts");
        expect(html).toContain("size-option");
        expect(html).toContain("family=Kanit");
        expect(html).toContain('font-family: "Kanit"');
        expect(html).toContain('id="processing-overlay"');
        expect(html).toContain("Shopee Order Simulation");
        expect(html).toContain("Notification");
        expect(html).toContain('style nonce="nonce123"');
        expect(html).toContain('script nonce="nonce123"');
        expect(html).not.toContain("Demo<br />Shop");
        expect(html).not.toContain("<script src=");
        expect(html).not.toContain("PC_PRODUCTS_TABLE_ID");
        expect(html).not.toContain("materials_json");
    });

    it("emits syntactically valid inline JavaScript for both page scripts", () => {
        const html = renderDemoShopHtml({
            dashboardUrl: "https://dashboard.example.com",
            nonce: "nonce123",
        });
        const scripts = [
            ...html.matchAll(
                /<script nonce="nonce123">([\s\S]*?)<\/script>/g
            ),
        ].map((match) => match[1]);

        expect(scripts).toHaveLength(2);
        for (const script of scripts) {
            expect(() => new Function(script)).not.toThrow();
        }
    });

    it("serializes the dashboard URL for the login handoff", () => {
        const html = renderDemoShopHtml({
            dashboardUrl: "https://dashboard.example.com",
            nonce: "abc",
        });

        expect(html).toContain(
            'const dashboardUrl = "https://dashboard.example.com";'
        );
    });

    it("escapes script-breaking characters in the dashboard URL", () => {
        const html = renderDemoShopHtml({
            dashboardUrl: 'https://dashboard.example.com/<script>&next=1',
            nonce: "abc",
        });

        expect(html).toContain("\\u003cscript\\u003e\\u0026next=1");
        expect(html).not.toContain("<script>&next=1");
    });
});
