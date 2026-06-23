import { describe, expect, it } from "vitest";
import type { Env } from "../config/env";
import { hmacSha256Hex } from "../modules/marketplace/lazada/lazada.crypto";
import { handleLazadaWebhook } from "./lazada-live.route";

function testEnv(input: {
    appKey?: string;
    appSecret?: string;
} = {}): Env {
    return {
        LAZADA_APP_KEY: input.appKey ?? "139683",
        LAZADA_APP_SECRET: input.appSecret ?? "test-secret",
    } as Env;
}

describe("Lazada live webhook", () => {
    it("acknowledges the signed Lazada Push Mechanism verification probe without seller credentials", async () => {
        const appKey = "139683";
        const appSecret = "test-secret";
        const rawBody = JSON.stringify({
            seller_id: "9999",
            message_type: 0,
            data: {
                order_status: "unpaid",
                trade_order_id: "123456",
                trade_order_line_id: "1234567",
            },
            timestamp: 1603766859530,
            site: "lazada_th",
        });
        const signature = await hmacSha256Hex(
            appSecret,
            `${appKey}${rawBody}`
        );
        const request = new Request(
            "https://example.com/webhooks/lazada",
            {
                method: "POST",
                headers: {
                    Authorization: signature,
                    "Content-Type": "application/json",
                },
                body: rawBody,
            }
        );

        const response = await handleLazadaWebhook(
            request,
            testEnv({ appKey, appSecret })
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            verified: true,
            service: "lazada-webhook",
        });
    });

    it("rejects a verification probe with an invalid signature", async () => {
        const rawBody = JSON.stringify({
            seller_id: "9999",
            message_type: 0,
            data: { trade_order_id: "123456" },
        });
        const request = new Request(
            "https://example.com/webhooks/lazada",
            {
                method: "POST",
                headers: {
                    Authorization: "invalid",
                    "Content-Type": "application/json",
                },
                body: rawBody,
            }
        );

        const response = await handleLazadaWebhook(request, testEnv());

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            ok: false,
            code: "LAZADA_WEBHOOK_SIGNATURE_INVALID",
        });
    });
});
