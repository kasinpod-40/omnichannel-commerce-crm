import { describe, expect, it } from "vitest";
import {
    getOrderRecordId,
    getWorkflowToken,
    isWorkflowRequestBody,
} from "./workflow-request";

describe("Lark workflow request helpers", () => {
    it("reads bearer and workflow-header tokens consistently", () => {
        expect(
            getWorkflowToken(
                new Request("https://example.com", {
                    headers: { Authorization: "Bearer secret" },
                }),
                {}
            )
        ).toBe("secret");
        expect(
            getWorkflowToken(
                new Request("https://example.com", {
                    headers: { "X-Lark-Workflow-Token": "header-secret" },
                }),
                {}
            )
        ).toBe("header-secret");
    });

    it("reads order ids from direct and nested Workflow payloads", () => {
        expect(getOrderRecordId({ orderRecordId: "rec-direct" })).toBe(
            "rec-direct"
        );
        expect(
            getOrderRecordId({ fields: { record_id: "rec-nested" } })
        ).toBe("rec-nested");
    });

    it("rejects arrays and null as request bodies", () => {
        expect(isWorkflowRequestBody({})).toBe(true);
        expect(isWorkflowRequestBody([])).toBe(false);
        expect(isWorkflowRequestBody(null)).toBe(false);
    });
});
