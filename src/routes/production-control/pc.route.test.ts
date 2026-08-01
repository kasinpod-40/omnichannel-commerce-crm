import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import {
    handlePcMaterialRefresh,
    handlePcOverview,
} from "./pc.route";

function env(): Env {
    return {
        ENVIRONMENT: "test",
        DASHBOARD_URL: "https://dashboard.example.com",
        AUTH_ALLOWED_ORIGINS: "https://dashboard.example.com",
        AUTH_SESSION_SECRET:
            "test-session-secret-that-is-longer-than-32-characters",
    } as unknown as Env;
}

describe("Production & Stock dashboard route security", () => {
    it("rejects a state-changing request without an allowed Origin", async () => {
        const response = await handlePcMaterialRefresh(
            new Request("https://api.example.com/pc/materials/refresh", {
                method: "POST",
            }),
            env()
        );

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_ORIGIN_FORBIDDEN",
        });
    });

    it("requires a Dashboard session after Origin validation", async () => {
        const response = await handlePcMaterialRefresh(
            new Request("https://api.example.com/pc/materials/refresh", {
                method: "POST",
                headers: {
                    Origin: "https://dashboard.example.com",
                },
            }),
            env()
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_SESSION_MISSING",
        });
    });

    it("protects the overview with a Dashboard session", async () => {
        const response = await handlePcOverview(
            new Request("https://api.example.com/pc/overview"),
            env()
        );

        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_SESSION_MISSING",
        });
    });
});
