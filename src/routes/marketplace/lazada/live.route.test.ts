import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../../config/env";
import { hmacSha256Hex } from "../../../modules/marketplace/lazada/lazada.crypto";
import { handleLazadaWebhook } from "./live.route";

function testEnv(input: {
    appKey?: string;
    appSecret?: string;
    queueSend?: ReturnType<typeof vi.fn>;
} = {}): Env {
    return {
        LAZADA_APP_KEY: input.appKey ?? "139683",
        LAZADA_APP_SECRET: input.appSecret ?? "test-secret",
        MARKETPLACE_EVENTS_QUEUE: {
            send: input.queueSend ?? vi.fn().mockResolvedValue(undefined),
        },
    } as unknown as Env;
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

    it("queues a signed Lazada order event instead of processing concurrent webhooks in the request", async () => {
        const appKey = "139683";
        const appSecret = "test-secret";
        const queueSend = vi.fn().mockResolvedValue(undefined);
        const rawBody = JSON.stringify({
            seller_id: "101522032146",
            message_type: 0,
            data: {
                order_status: "pending",
                trade_order_id: "1103490061815573",
                trade_order_line_id: "line-1",
            },
            timestamp: 1782352336000,
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
            testEnv({ appKey, appSecret, queueSend })
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            accepted: true,
            queued: true,
            order_id: "1103490061815573",
        });
        expect(queueSend).toHaveBeenCalledTimes(1);
        expect(queueSend).toHaveBeenCalledWith(
            expect.objectContaining({
                schema_version: 1,
                channel: "Lazada",
                seller_id: "101522032146",
                order_id: "1103490061815573",
                order_status: "pending",
            }),
            { contentType: "json" }
        );
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
