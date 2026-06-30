import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { buildDocumentViewModelFromRecord } from "./document.service";
import { renderDocumentHtml } from "./document-html";

const env = {
    DOCUMENT_COMPANY_NAME: "บริษัท ทดสอบ จำกัด",
    DOCUMENT_COMPANY_ADDRESS: "กรุงเทพมหานคร",
    DOCUMENT_COMPANY_TAX_ID: "0100000000000",
    DOCUMENT_VAT_RATE: "7",
    DOCUMENT_PRICE_INCLUDES_VAT: "true",
} as Env;

function record() {
    return {
        record_id: "rec-order-1",
        fields: {
            [ORDER_FIELDS.ORDER_NUMBER]: "ORD-001",
            [ORDER_FIELDS.CHANNEL]: "Lazada",
            [ORDER_FIELDS.EXTERNAL_ORDER_ID]: "LZ-1001",
            [ORDER_FIELDS.CUSTOMER_NAME]: "สมชาย ใจดี",
            [ORDER_FIELDS.PHONE]: "0812345678",
            [ORDER_FIELDS.ADDRESS]: "กรุงเทพมหานคร",
            [ORDER_FIELDS.PRODUCT_NAME]: "เสื้อยืด",
            [ORDER_FIELDS.QUANTITY]: 1,
            [ORDER_FIELDS.TOTAL_AMOUNT]: 38,
            [ORDER_FIELDS.ORDER_STATUS]: "Processing",
            [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
            [ORDER_FIELDS.CURRENCY]: "THB",
            [ORDER_FIELDS.MARKETPLACE_ITEMS_JSON]: JSON.stringify([
                {
                    sku: "SKU-1",
                    name: "เสื้อยืด",
                    variant: "สีดำ L",
                    quantity: 1,
                    unit_price: 9,
                },
            ]),
            tax_name: "สมชาย ใจดี",
            tax_address: "กรุงเทพมหานคร",
            tax_id: "1234567890123",
        },
    };
}

describe("document service", () => {
    it("builds marketplace document and preserves shipping adjustment", () => {
        const model = buildDocumentViewModelFromRecord(
            env,
            record(),
            "invoice",
            Date.UTC(2026, 5, 23)
        );

        expect(model.document_number).toBe("INV-LZ-1001");
        expect(model.items).toHaveLength(1);
        expect(model.subtotal).toBe(9);
        expect(model.adjustment).toBe(29);
        expect(model.grand_total).toBe(38);

        const html = renderDocumentHtml(model);
        expect(html).toContain("ใบแจ้งหนี้");
        expect(html).toContain("บริษัท ทดสอบ จำกัด");
        expect(html).toContain("--primary: #15865A");
        expect(html).toContain("พิมพ์ / บันทึกเป็น PDF");
        expect(html).toContain("ค่าจัดส่ง / ส่วนลด / ปรับยอด");
        expect(html).toContain("กำลังดำเนินการ");
        expect(html).toContain("ชำระแล้ว");
        expect(html).not.toContain("OmniCommerce CRM");
        expect(html).not.toContain("Omnichannel Commerce CRM");
    });

    it("calculates VAT for tax invoice", () => {
        const model = buildDocumentViewModelFromRecord(
            env,
            record(),
            "tax-invoice"
        );

        expect(model.vat_rate).toBe(7);
        expect(model.taxable_amount).toBe(35.51);
        expect(model.vat_amount).toBe(2.49);
    });

    it("rejects tax invoice when tax data is incomplete", () => {
        const incomplete = record();
        (incomplete.fields as Record<string, unknown>).tax_id = undefined;

        expect(() =>
            buildDocumentViewModelFromRecord(
                env,
                incomplete,
                "tax-invoice"
            )
        ).toThrow("TAX_DATA_INCOMPLETE:Orders.tax_id");
    });
});
