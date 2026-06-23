import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    generateLazadaApiSignature,
    hmacSha256Hex,
    verifyLazadaWebhookSignature,
} from "./lazada.crypto";

describe("Lazada Open Platform crypto", () => {
    it("generates the HMAC-SHA256 signature from path and ASCII-sorted parameters", async () => {
        const secret = "test-secret";
        const path = "/order/get";
        const parameters = {
            timestamp: 1517820392000,
            sign_method: "sha256",
            order_id: "1234",
            app_key: "123456",
            access_token: "test",
            sign: "ignored",
        };
        const canonical =
            "/order/get" +
            "access_tokentest" +
            "app_key123456" +
            "order_id1234" +
            "sign_methodsha256" +
            "timestamp1517820392000";
        const expected = createHmac("sha256", secret)
            .update(canonical)
            .digest("hex")
            .toUpperCase();

        await expect(
            generateLazadaApiSignature({
                appSecret: secret,
                path,
                parameters,
            })
        ).resolves.toBe(expected);
    });

    it("verifies raw and signature-prefixed webhook authorization values", async () => {
        const appKey = "123456";
        const secret = "webhook-secret";
        const rawBody = JSON.stringify({
            seller_id: "1234567",
            message_type: 0,
        });
        const signature = await hmacSha256Hex(secret, `${appKey}${rawBody}`);

        await expect(
            verifyLazadaWebhookSignature({
                appKey,
                appSecret: secret,
                rawBody,
                authorizationHeader: signature,
            })
        ).resolves.toBe(true);
        await expect(
            verifyLazadaWebhookSignature({
                appKey,
                appSecret: secret,
                rawBody,
                authorizationHeader: `signature=${signature}`,
            })
        ).resolves.toBe(true);
    });

    it("rejects a modified webhook body", async () => {
        const appKey = "123456";
        const secret = "webhook-secret";
        const signature = await hmacSha256Hex(
            secret,
            `${appKey}${JSON.stringify({ trade_order_id: "1" })}`
        );

        await expect(
            verifyLazadaWebhookSignature({
                appKey,
                appSecret: secret,
                rawBody: JSON.stringify({ trade_order_id: "2" }),
                authorizationHeader: signature,
            })
        ).resolves.toBe(false);
    });
});
