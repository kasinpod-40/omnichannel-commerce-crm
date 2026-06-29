import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { createAuthSession } from "../../modules/auth/auth.session";
import { AiBusinessAnalysisError } from "../../modules/dashboard/ai-business-analysis.service";

const { generateAiBusinessAnalysis } = vi.hoisted(() => ({
    generateAiBusinessAnalysis: vi.fn(),
}));

vi.mock("../../modules/dashboard/ai-business-analysis.service", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../modules/dashboard/ai-business-analysis.service")>();
    return { ...original, generateAiBusinessAnalysis };
});

import { handleAiBusinessAnalysis } from "./ai-analysis.route";

const env = {
    DASHBOARD_URL: "https://crm.example.com",
    AUTH_ALLOWED_ORIGINS: "https://crm.example.com",
    AUTH_SESSION_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
    AUTH_SESSION_TTL_SECONDS: "3600",
    AUTH_COOKIE_SAME_SITE: "None",
} as Env;
const user = {
    user_id: "ou_user_001",
    lark_open_id: "ou_user_001",
    name: "Kasinpod",
    email: null,
    avatar_url: null,
    role: "admin" as const,
    sales_owner_name: null,
};

async function authenticatedRequest(body: unknown) {
    const session = await createAuthSession(env, user);
    return new Request("https://api.example.com/dashboard/ai-analysis", {
        method: "POST",
        headers: {
            Origin: "https://crm.example.com",
            Cookie: `crm_session=${encodeURIComponent(session.token)}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });
}

describe("POST /dashboard/ai-analysis", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        generateAiBusinessAnalysis.mockResolvedValue({
            request_id: "request-1",
            headline: "สรุปธุรกิจ",
        });
    });

    it("returns 401 when dashboard session is missing", async () => {
        const response = await handleAiBusinessAnalysis(new Request(
            "https://api.example.com/dashboard/ai-analysis",
            { method: "POST", headers: { Origin: "https://crm.example.com" } }
        ), env);
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_SESSION_MISSING" });
    });

    it("passes a validated period and scope to the Lark AI service", async () => {
        const response = await handleAiBusinessAnalysis(await authenticatedRequest({
            language: "en",
            scope: "marketplaces",
            period_mode: "month",
            period_value: "2026-06",
        }), env);
        expect(response.status).toBe(200);
        expect(generateAiBusinessAnalysis).toHaveBeenCalledWith(env, {
            language: "en",
            scope: "marketplaces",
            period: expect.objectContaining({ mode: "month", value: "2026-06" }),
        });
    });

    it("returns 400 for an invalid period instead of masking it as a server error", async () => {
        const response = await handleAiBusinessAnalysis(await authenticatedRequest({
            period_mode: "month",
            period_value: "2026-13",
        }), env);
        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({ code: "INVALID_DASHBOARD_PERIOD" });
        expect(generateAiBusinessAnalysis).not.toHaveBeenCalled();
    });

    it("preserves a safe configuration error code from the AI service", async () => {
        generateAiBusinessAnalysis.mockRejectedValue(new AiBusinessAnalysisError(
            "LARK_AI_WORKFLOW_NOT_CONFIGURED",
            "not configured",
            503
        ));
        const response = await handleAiBusinessAnalysis(await authenticatedRequest({
            period_mode: "day",
            period_value: "2026-06-29",
        }), env);
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
            code: "LARK_AI_WORKFLOW_NOT_CONFIGURED",
            message: "AI business analysis is unavailable",
        });
    });
});
