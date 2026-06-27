import {
    env,
    createExecutionContext,
    waitOnExecutionContext,
    SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Omnichannel Commerce CRM worker", () => {
    it("returns the current application health payload (unit style)", async () => {
        const request = new IncomingRequest(
            "http://example.com/health"
        );
        const ctx = createExecutionContext();
        const response = await worker.fetch(request, env, ctx);

        await waitOnExecutionContext(ctx);

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            service: "omnichannel-commerce-crm",
            version: "lark-ios-auth-fix-th-27",
        });
    });

    it("returns 401 for /auth/me when the session cookie is missing", async () => {
        const response = await SELF.fetch(
            "https://example.com/auth/me"
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_SESSION_MISSING",
        });
    });

    it("returns JSON 404 for an unknown route (integration style)", async () => {
        const response = await SELF.fetch(
            "https://example.com/unknown-route"
        );

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toMatchObject({
            ok: false,
            message: "Route not found",
            path: "/unknown-route",
        });
    });
    it("preserves the Lazada webhook health route after route grouping", async () => {
        const response = await SELF.fetch(
            "https://example.com/webhooks/lazada"
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            service: "lazada-webhook",
            region: "TH",
        });
    });

    it("preserves the TikTok webhook health route after route grouping", async () => {
        const response = await SELF.fetch(
            "https://example.com/webhooks/tiktok"
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            ok: true,
            service: "tiktok-shop-webhook",
            region: "TH",
        });
    });

});
