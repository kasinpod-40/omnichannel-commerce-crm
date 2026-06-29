import type { Env } from "../../config/env";
import { isAuthError } from "../../modules/auth/auth.error";
import {
    AiBusinessAnalysisError,
    generateAiBusinessAnalysis,
    type AiAnalysisScope,
} from "../../modules/dashboard/ai-business-analysis.service";
import {
    defaultDashboardPeriod,
    parseDashboardPeriod,
    type DashboardPeriodMode,
} from "../../modules/dashboard/dashboard-period";
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

export async function handleAiBusinessAnalysis(
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
        const mode: DashboardPeriodMode = body.period_mode === "month" || body.period_mode === "year"
            ? body.period_mode
            : "day";
        const rawValue = typeof body.period_value === "string" ? body.period_value.trim() : "";
        let period;
        try {
            period = rawValue
                ? parseDashboardPeriod(mode, rawValue)
                : defaultDashboardPeriod(mode);
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
        const result = await generateAiBusinessAnalysis(env, {
            language,
            scope,
            period,
        });
        return addAuthCorsHeaders(dashboardJson(result), request, env);
    } catch (error) {
        if (isAuthError(error)) {
            return dashboardApiErrorResponse(request, env, error, {
                code: "AI_ANALYSIS_AUTH_FAILED",
                publicMessage: "AI business analysis is unavailable",
                logLabel: "AI business analysis authentication failed",
            });
        }
        const normalized = error instanceof AiBusinessAnalysisError
            ? error
            : new AiBusinessAnalysisError(
                "AI_ANALYSIS_FAILED",
                "AI business analysis is unavailable",
                500
            );
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
}
