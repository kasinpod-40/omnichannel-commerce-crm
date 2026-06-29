import type { Env } from "../../config/env";
import { isAuthError } from "../../modules/auth/auth.error";
import {
    AiBusinessAnalysisError,
    completeAiBusinessAnalysis,
    getAiBusinessAnalysisJob,
    startAiBusinessAnalysis,
    type AiAnalysisScope,
} from "../../modules/dashboard/ai-business-analysis.service";
import { parseDashboardPeriodInput } from "../../modules/dashboard/dashboard-period";
import { addAuthCorsHeaders } from "../auth/auth-http";
import {
    assertDashboardSession,
    dashboardApiErrorResponse,
    dashboardJson,
    dashboardMethodNotAllowed,
} from "../shared/dashboard-api";

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeEqual(left: string, right: string): boolean {
    const a = new TextEncoder().encode(left);
    const b = new TextEncoder().encode(right);
    let mismatch = a.length ^ b.length;
    const length = Math.max(a.length, b.length);
    for (let index = 0; index < length; index += 1) {
        mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
    }
    return mismatch === 0;
}

function bearerToken(request: Request): string {
    const authorization = request.headers.get("authorization")?.trim() ?? "";
    return authorization.toLowerCase().startsWith("bearer ")
        ? authorization.slice(7).trim()
        : "";
}

function normalizeError(error: unknown): AiBusinessAnalysisError {
    return error instanceof AiBusinessAnalysisError
        ? error
        : new AiBusinessAnalysisError(
            "AI_ANALYSIS_FAILED",
            "AI business analysis is unavailable",
            500
        );
}

function serviceErrorResponse(request: Request, env: Env, error: unknown): Response {
    if (isAuthError(error)) {
        return dashboardApiErrorResponse(request, env, error, {
            code: "AI_ANALYSIS_AUTH_FAILED",
            publicMessage: "AI business analysis is unavailable",
            logLabel: "AI business analysis authentication failed",
        });
    }
    const normalized = normalizeError(error);
    if (!(error instanceof AiBusinessAnalysisError)) {
        console.error("AI business analysis failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
    return addAuthCorsHeaders(
        dashboardJson({
            code: normalized.code,
            message: normalized.status >= 500
                ? "AI business analysis is unavailable"
                : normalized.message,
        }, normalized.status),
        request,
        env
    );
}

export async function handleAiBusinessAnalysisStart(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        const body = await request.json().catch(() => null);
        if (!isObject(body)) {
            return addAuthCorsHeaders(
                dashboardJson({ code: "INVALID_REQUEST", message: "Invalid request body" }, 400),
                request,
                env
            );
        }
        const language = body.language === "en" ? "en" : "th";
        const scope: AiAnalysisScope = body.scope === "line" || body.scope === "marketplaces"
            ? body.scope
            : "all";
        let period;
        try {
            period = parseDashboardPeriodInput({
                mode: body.period_mode,
                value: body.period_value,
            });
        } catch {
            return addAuthCorsHeaders(
                dashboardJson({
                    code: "INVALID_DASHBOARD_PERIOD",
                    message: "Invalid dashboard period",
                }, 400),
                request,
                env
            );
        }
        const result = await startAiBusinessAnalysis(env, { language, scope, period });
        return addAuthCorsHeaders(dashboardJson(result, 202), request, env);
    } catch (error) {
        return serviceErrorResponse(request, env, error);
    }
}

export async function handleAiBusinessAnalysisStatus(
    request: Request,
    env: Env,
    requestId: string
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
            return addAuthCorsHeaders(
                dashboardJson({ code: "INVALID_REQUEST_ID", message: "Invalid request ID" }, 400),
                request,
                env
            );
        }
        const result = await getAiBusinessAnalysisJob(env, requestId);
        return addAuthCorsHeaders(dashboardJson(result), request, env);
    } catch (error) {
        return serviceErrorResponse(request, env, error);
    }
}

export async function handleAiBusinessAnalysisCallback(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return dashboardJson({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed" }, 405);
    }
    const configuredToken = env.LARK_AI_CALLBACK_TOKEN?.trim() ?? "";
    const providedToken = bearerToken(request);
    if (!configuredToken || !providedToken || !safeEqual(configuredToken, providedToken)) {
        return dashboardJson({ code: "AI_CALLBACK_UNAUTHORIZED", message: "Unauthorized" }, 401);
    }
    try {
        const raw = await request.text();
        if (!raw || raw.length > 100_000) {
            return dashboardJson({ code: "INVALID_REQUEST", message: "Invalid callback body" }, 400);
        }
        const body = JSON.parse(raw) as unknown;
        if (!isObject(body)) {
            return dashboardJson({ code: "INVALID_REQUEST", message: "Invalid callback body" }, 400);
        }
        const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
        if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
            return dashboardJson({ code: "INVALID_REQUEST_ID", message: "Invalid request ID" }, 400);
        }
        const result = await completeAiBusinessAnalysis(env, requestId, body);
        return dashboardJson({ code: 0, message: "ok", request_id: result.request_id });
    } catch (error) {
        const normalized = normalizeError(error);
        return dashboardJson({ code: normalized.code, message: normalized.message }, normalized.status);
    }
}
