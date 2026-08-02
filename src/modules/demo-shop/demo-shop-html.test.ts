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

    it("emits syntactically valid inline JavaScript for all page scripts", () => {
        const html = renderDemoShopHtml({
            dashboardUrl: "https://dashboard.example.com",
            nonce: "nonce123",
        });
        const scripts = [
            ...html.matchAll(
                /<script nonce="nonce123">([\s\S]*?)<\/script>/g
            ),
        ].map((match) => match[1]);

        expect(scripts).toHaveLength(3);
        for (const script of scripts) {
            expect(() => new Function(script)).not.toThrow();
        }
    });

    it("uses actual stock and each SKU Min Stock for the availability label", () => {
        const html = renderDemoShopHtml({
            dashboardUrl: "https://dashboard.example.com",
            nonce: "abc",
        });

        expect(html).toContain("minStockBySku");
        expect(html).toContain("product.min_stock");
        expect(html).toContain("stock <= minStock");
        expect(html).toContain('nextLabel = "สินค้าใกล้หมด"');
        expect(html).toContain('nextLabel = "สินค้าหมด"');
        expect(html).toContain("ขั้นต่ำ \" + minStock + \" ชิ้น");
        expect(html).not.toContain(
            'currentStatus === "LOW_STOCK" || currentStatus === "OUT_OF_STOCK"'
        );
    });

    it("limits orders to the actual remaining quantity", () => {
        const html = renderDemoShopHtml({
            dashboardUrl: "https://dashboard.example.com",
            nonce: "abc",
        });

        expect(html).toContain("quantity > stock");
        expect(html).toContain("selectedQuantity(card) >= stock");
        expect(html).toContain("สินค้าคงเหลือ \" + stock + \" ชิ้น");
    });

    it("changes the unauthenticated handoff to direct Lark login and returns to Demo Shop", () => {
        const html = renderDemoShopHtml({
            dashboardUrl: "https://dashboard.example.com",
            nonce: "abc",
        });

        expect(html).toContain("เข้าสู่ระบบด้วย Lark");
        expect(html).toContain(
            "/auth/lark/login?return_to=%2Fdemo-shop"
        );
        expect(html).toContain(
            "ระบบจะกลับมาที่ Demo Shop อัตโนมัติ"
        );
    });

    it("serializes the dashboard URL for the legacy login handoff safely", () => {
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
