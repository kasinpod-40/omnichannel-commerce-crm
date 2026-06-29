import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { createAuthSession } from "../../modules/auth/auth.session";
import { AiBusinessAnalysisError } from "../../modules/dashboard/ai-business-analysis.service";

const {
    startAiBusinessAnalysis,
    getAiBusinessAnalysisJob,
    completeAiBusinessAnalysis,
} = vi.hoisted(() => ({
    startAiBusinessAnalysis: vi.fn(),
    getAiBusinessAnalysisJob: vi.fn(),
    completeAiBusinessAnalysis: vi.fn(),
}));

vi.mock("../../modules/dashboard/ai-business-analysis.service", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../modules/dashboard/ai-business-analysis.service")>();
    return {
        ...original,
        startAiBusinessAnalysis,
        getAiBusinessAnalysisJob,
        completeAiBusinessAnalysis,
    };
});

import {
    handleAiBusinessAnalysisCallback,
    handleAiBusinessAnalysisStart,
    handleAiBusinessAnalysisStatus,
} from "./ai-analysis.route";

const env = {
    DASHBOARD_URL: "https://crm.example.com",
    AUTH_ALLOWED_ORIGINS: "https://crm.example.com",
    AUTH_SESSION_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
    AUTH_SESSION_TTL_SECONDS: "3600",
    AUTH_COOKIE_SAME_SITE: "None",
    LARK_AI_CALLBACK_TOKEN: "callback-secret",
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

async function authenticatedRequest(body: unknown, url = "https://api.example.com/dashboard/ai-analysis") {
    const session = await createAuthSession(env, user);
    return new Request(url, {
        method: url.endsWith("/ai-analysis") ? "POST" : "GET",
        headers: {
            Origin: "https://crm.example.com",
            Cookie: `crm_session=${encodeURIComponent(session.token)}`,
            "Content-Type": "application/json",
        },
        body: url.endsWith("/ai-analysis") ? JSON.stringify(body) : undefined,
    });
}

describe("async /dashboard/ai-analysis routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        startAiBusinessAnalysis.mockResolvedValue({
            request_id: "11111111-1111-4111-8111-111111111111",
            status: "processing",
            poll_after_ms: 1500,
        });
        getAiBusinessAnalysisJob.mockResolvedValue({
            request_id: "11111111-1111-4111-8111-111111111111",
            status: "processing",
            poll_after_ms: 1500,
        });
        completeAiBusinessAnalysis.mockResolvedValue({
            request_id: "11111111-1111-4111-8111-111111111111",
        });
    });

    it("returns 401 when dashboard session is missing", async () => {
        const response = await handleAiBusinessAnalysisStart(new Request(
            "https://api.example.com/dashboard/ai-analysis",
            { method: "POST", headers: { Origin: "https://crm.example.com" } }
        ), env);
        expect(response.status).toBe(401);
        await expect(response.json()).resolves.toMatchObject({ code: "AUTH_SESSION_MISSING" });
    });

    it("starts an async job with a validated period and returns 202", async () => {
        const response = await handleAiBusinessAnalysisStart(await authenticatedRequest({
            language: "en",
            scope: "marketplaces",
            period_mode: "month",
            period_value: "2026-06",
        }), env);
        expect(response.status).toBe(202);
        expect(startAiBusinessAnalysis).toHaveBeenCalledWith(env, {
            language: "en",
            scope: "marketplaces",
            period: expect.objectContaining({ mode: "month", value: "2026-06" }),
        });
    });

    it("returns a protected job status", async () => {
        const id = "11111111-1111-4111-8111-111111111111";
        const response = await handleAiBusinessAnalysisStatus(
            await authenticatedRequest({}, `https://api.example.com/dashboard/ai-analysis/${id}`),
            env,
            id
        );
        expect(response.status).toBe(200);
        expect(getAiBusinessAnalysisJob).toHaveBeenCalledWith(env, id);
    });

    it("rejects an invalid callback token", async () => {
        const response = await handleAiBusinessAnalysisCallback(new Request(
            "https://api.example.com/dashboard/ai-analysis/callback",
            { method: "POST", body: "{}" }
        ), env);
        expect(response.status).toBe(401);
    });

    it("accepts an authenticated idempotent callback", async () => {
        const id = "11111111-1111-4111-8111-111111111111";
        const response = await handleAiBusinessAnalysisCallback(new Request(
            "https://api.example.com/dashboard/ai-analysis/callback",
            {
                method: "POST",
                headers: {
                    Authorization: "Bearer callback-secret",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ request_id: id, analysis_json: "{}" }),
            }
        ), env);
        expect(response.status).toBe(200);
        expect(completeAiBusinessAnalysis).toHaveBeenCalledWith(
            env,
            id,
            expect.objectContaining({ analysis_json: "{}" })
        );
    });

    it("preserves a safe configuration error code from the AI service", async () => {
        startAiBusinessAnalysis.mockRejectedValue(new AiBusinessAnalysisError(
            "LARK_AI_WORKFLOW_NOT_CONFIGURED",
            "not configured",
            503
        ));
        const response = await handleAiBusinessAnalysisStart(await authenticatedRequest({
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
