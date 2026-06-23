import { describe, expect, it } from "vitest";
import { renderTaxFormHtml } from "./tax-form-html";

describe("tax form html", () => {
    it("escapes values and renders a signed form action", () => {
        const html = renderTaxFormHtml({
            model: {
                order_record_id: "rec1",
                order_number: "LZ-1",
                channel: "LINE",
                customer_name: "A",
                tax_name: "<script>",
                tax_address: "Bangkok",
                tax_id: "",
                tax_branch: "สำนักงานใหญ่",
            },
            actionUrl: "https://example.com/form?signature=abc&expires=1",
        });
        expect(html).toContain("&lt;script&gt;");
        expect(html).toContain("signature=abc&amp;expires=1");
        expect(html).toContain("เลขประจำตัวผู้เสียภาษี 13 หลัก");
    });
});
