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
    it("returns the Lazada live connector health payload (unit style)", async () => {
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
            version: "lazada-live-connector-th-2",
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
});
