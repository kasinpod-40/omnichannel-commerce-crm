import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import {
    createPcWorkflowActionToken,
    createPcWorkflowActionUrl,
    verifyPcWorkflowActionToken,
} from "./pc.action-token";

function env(): Env {
    return {
        AUTH_SESSION_SECRET:
            "test-production-action-secret-at-least-32-characters",
        LARK_AUTH_REDIRECT_URI:
            "https://worker.example.com/auth/lark/callback",
    } as Env;
}

describe("Production workflow action token", () => {
    it("creates and verifies a signed action token for the exact batch", async () => {
        const now = Date.UTC(2026, 7, 2, 8, 0, 0);
        const token = await createPcWorkflowActionToken(env(), {
            action: "approve-production",
            production_record_id: "production-rec-1",
            now,
        });

        await expect(
            verifyPcWorkflowActionToken(env(), token, {
                action: "approve-production",
                production_record_id: "production-rec-1",
                now: now + 1_000,
            })
        ).resolves.toMatchObject({
            version: 1,
            action: "approve-production",
            production_record_id: "production-rec-1",
        });
    });

    it("rejects a tampered token", async () => {
        const token = await createPcWorkflowActionToken(env(), {
            action: "approve-production",
            production_record_id: "production-rec-1",
        });
        const [payload, signature] = token.split(".");
        const tampered = `${payload}x.${signature}`;

        await expect(
            verifyPcWorkflowActionToken(env(), tampered)
        ).rejects.toMatchObject({
            code: "PC_ACTION_TOKEN_INVALID",
        });
    });

    it("rejects reuse for another action or production batch", async () => {
        const token = await createPcWorkflowActionToken(env(), {
            action: "approve-production",
            production_record_id: "production-rec-1",
        });

        await expect(
            verifyPcWorkflowActionToken(env(), token, {
                action: "purchase-materials",
            })
        ).rejects.toMatchObject({
            code: "PC_ACTION_TOKEN_MISMATCH",
            status: 403,
        });

        await expect(
            verifyPcWorkflowActionToken(env(), token, {
                production_record_id: "production-rec-2",
            })
        ).rejects.toMatchObject({
            code: "PC_ACTION_TOKEN_MISMATCH",
            status: 403,
        });
    });

    it("rejects an expired token", async () => {
        const now = Date.UTC(2026, 7, 2, 8, 0, 0);
        const token = await createPcWorkflowActionToken(env(), {
            action: "complete-production",
            production_record_id: "production-rec-1",
            now,
        });

        await expect(
            verifyPcWorkflowActionToken(env(), token, {
                now: now + 8 * 24 * 60 * 60 * 1_000,
            })
        ).rejects.toMatchObject({
            code: "PC_ACTION_TOKEN_EXPIRED",
            status: 410,
        });
    });

    it("builds a Worker same-origin HTTPS action URL", async () => {
        const url = new URL(
            await createPcWorkflowActionUrl(env(), {
                action: "purchase-materials",
                production_record_id: "production rec/1",
            })
        );

        expect(url.origin).toBe("https://worker.example.com");
        expect(url.pathname).toBe(
            "/pc/actions/production%20rec%2F1/purchase-materials"
        );
        expect(url.searchParams.get("token")).toBeTruthy();
    });
});
