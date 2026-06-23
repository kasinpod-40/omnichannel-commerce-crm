import { describe, expect, it } from "vitest";
import { handleDocumentRoutes } from "./document.route";

const env = {
    NOTIFICATION_DISPATCH_TOKEN: "admin-secret",
    DOCUMENT_WORKFLOW_TOKEN: "workflow-secret",
    DOCUMENT_LINK_SECRET: "link-secret",
} as any;

describe("document route composition", () => {
    it("returns null for unrelated paths", async () => {
        await expect(
            handleDocumentRoutes(
                new Request("https://example.com/not-a-document-route"),
                env,
                "/not-a-document-route"
            )
        ).resolves.toBeNull();
    });

    it("protects the workflow document-generation endpoint", async () => {
        const response = await handleDocumentRoutes(
            new Request(
                "https://example.com/webhooks/lark/document-generate",
                {
                    method: "POST",
                    body: JSON.stringify({
                        order_record_id: "rec1",
                        document_type: "quotation",
                    }),
                    headers: { "Content-Type": "application/json" },
                }
            ),
            env,
            "/webhooks/lark/document-generate"
        );

        expect(response?.status).toBe(401);
    });

    it("protects the tax-form link endpoint", async () => {
        const response = await handleDocumentRoutes(
            new Request(
                "https://example.com/admin/documents/tax-form-link",
                {
                    method: "POST",
                    body: JSON.stringify({ order_record_id: "rec1" }),
                    headers: { "Content-Type": "application/json" },
                }
            ),
            env,
            "/admin/documents/tax-form-link"
        );

        expect(response?.status).toBe(401);
    });

    it("rejects unsigned public document links", async () => {
        const path = "/documents/order/rec1/invoice";
        const response = await handleDocumentRoutes(
            new Request(`https://example.com${path}`),
            env,
            path
        );

        expect(response?.status).toBe(401);
        await expect(response?.json()).resolves.toMatchObject({
            code: "DOCUMENT_LINK_INVALID_OR_EXPIRED",
        });
    });
});
