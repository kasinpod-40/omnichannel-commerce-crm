import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
    generateTikTokApiSignature,
    hmacSha256Base64,
    hmacSha256Hex,
    verifyTikTokWebhookSignature,
} from "./tiktok.crypto";

describe("TikTok Shop crypto", () => {
    it("generates the official-style signed API canonical value", async () => {
        const secret = "test-secret";
        const path = "/order/202309/orders";
        const query = {
            timestamp: 1710000000,
            app_key: "app-key",
            shop_cipher: "cipher-th",
            sign: "ignored",
        };
        const body = JSON.stringify({ order_ids: ["123"] });
        const canonical =
            `${path}app_keyapp-keyshop_ciphercipher-thtimestamp1710000000${body}`;
        const wrapped = `${secret}${canonical}${secret}`;
        const expected = createHmac("sha256", secret)
            .update(wrapped)
            .digest("hex");

        await expect(
            generateTikTokApiSignature({
                appSecret: secret,
                path,
                query,
                body,
            })
        ).resolves.toBe(expected);
    });

    it("verifies raw, prefixed and base64 webhook signatures", async () => {
        const secret = "webhook-secret";
        const rawBody = JSON.stringify({ event: "ORDER_STATUS_CHANGE" });
        const hex = await hmacSha256Hex(secret, rawBody);
        const base64 = await hmacSha256Base64(secret, rawBody);

        await expect(
            verifyTikTokWebhookSignature({
                appSecret: secret,
                rawBody,
                authorizationHeader: hex,
            })
        ).resolves.toBe(true);
        await expect(
            verifyTikTokWebhookSignature({
                appSecret: secret,
                rawBody,
                authorizationHeader: `sha256=${hex}`,
            })
        ).resolves.toBe(true);
        await expect(
            verifyTikTokWebhookSignature({
                appSecret: secret,
                rawBody,
                authorizationHeader: base64,
            })
        ).resolves.toBe(true);
    });

    it("rejects a modified webhook body", async () => {
        const secret = "webhook-secret";
        const signature = await hmacSha256Hex(
            secret,
            JSON.stringify({ order_id: "1" })
        );

        await expect(
            verifyTikTokWebhookSignature({
                appSecret: secret,
                rawBody: JSON.stringify({ order_id: "2" }),
                authorizationHeader: signature,
            })
        ).resolves.toBe(false);
    });
});
