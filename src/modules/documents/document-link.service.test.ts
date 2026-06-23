import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import {
    createSignedDocumentLink,
    documentUrlFieldName,
    toLarkHyperlinkValue,
} from "./document-link.service";

const env = {
    DOCUMENT_LINK_SECRET: "document-secret",
} as Env;

describe("document link service", () => {
    it("maps each document type to the correct Orders URL field", () => {
        expect(documentUrlFieldName("quotation")).toBe("quotation_url");
        expect(documentUrlFieldName("invoice")).toBe("invoice_url");
        expect(documentUrlFieldName("tax-invoice")).toBe("tax_invoice_url");
    });

    it("creates a Lark hyperlink field value", () => {
        expect(
            toLarkHyperlinkValue("invoice", "https://example.com/invoice")
        ).toEqual({
            text: "เปิดใบแจ้งหนี้",
            link: "https://example.com/invoice",
        });
    });

    it("creates a signed document URL without exposing the admin token", async () => {
        const generated = await createSignedDocumentLink({
            env,
            requestUrl:
                "https://omnichannel-commerce-crm.example/admin/documents/generate-and-save",
            orderRecordId: "rec-order-1",
            documentType: "quotation",
            expiresMinutes: 60,
            validateDocument: false,
        });

        const url = new URL(generated.url);
        expect(url.pathname).toBe(
            "/documents/order/rec-order-1/quotation"
        );
        expect(url.searchParams.get("expires")).toBeTruthy();
        expect(url.searchParams.get("signature")).toBeTruthy();
        expect(generated.field_name).toBe("quotation_url");
        expect(generated.url).not.toContain("document-secret");
    });
});
