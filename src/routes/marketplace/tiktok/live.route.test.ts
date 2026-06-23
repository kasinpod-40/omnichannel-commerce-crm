import { describe, expect, it } from "vitest";
import {
    handleTikTokWebhook,
} from "./live.route";

describe("TikTok live route composition", () => {
    it("keeps the public webhook health probe", async () => {
        const response = await handleTikTokWebhook(
            new Request("https://example.com/webhooks/tiktok"),
            {} as any
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            ok: true,
            service: "tiktok-shop-webhook",
            region: "TH",
        });
    });

    it("requires the TikTok app secret for POST webhooks", async () => {
        const response = await handleTikTokWebhook(
            new Request("https://example.com/webhooks/tiktok", {
                method: "POST",
                body: "{}",
            }),
            {} as any
        );

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
            code: "TIKTOK_APP_SECRET_NOT_CONFIGURED",
        });
    });
});
