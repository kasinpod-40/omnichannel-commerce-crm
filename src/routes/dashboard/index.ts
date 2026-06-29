import type { Env } from "../../config/env";
import { handleMarketplaceDashboard } from "../marketplace/dashboard.route";
import { handleDashboardSummary } from "./executive.route";
import { handleCommerceDashboardSummary } from "./summary.route";
import {
    handleAiBusinessAnalysisCallback,
    handleAiBusinessAnalysisStart,
    handleAiBusinessAnalysisStatus,
} from "./ai-analysis.route";
import { handleAuthPreflight } from "../auth/auth-http";

export async function handleDashboardRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    // Frontend Dashboard ใช้ Cookie ข้าม pages.dev -> workers.dev จึงรองรับ CORS preflight ไว้ด้วย
    if (
        pathname.startsWith("/dashboard/") &&
        request.method === "OPTIONS"
    ) {
        try {
            return handleAuthPreflight(request, env);
        } catch {
            return Response.json(
                {
                    code: "AUTH_ORIGIN_FORBIDDEN",
                    message: "Request origin is not allowed",
                },
                { status: 403 }
            );
        }
    }

    if (pathname === "/dashboard/summary") {
        return handleCommerceDashboardSummary(request, env);
    }

    if (pathname === "/dashboard/ai-analysis") {
        return handleAiBusinessAnalysisStart(request, env);
    }

    if (pathname === "/dashboard/ai-analysis/callback") {
        return handleAiBusinessAnalysisCallback(request, env);
    }

    const aiStatusMatch = /^\/dashboard\/ai-analysis\/([0-9a-f-]{36})$/i.exec(pathname);
    if (aiStatusMatch) {
        return handleAiBusinessAnalysisStatus(request, env, aiStatusMatch[1] ?? "");
    }

    if (pathname === "/admin/dashboard/summary") {
        return handleDashboardSummary(request, env);
    }

    if (pathname === "/admin/dashboard/marketplace") {
        return handleMarketplaceDashboard(request, env);
    }

    return null;
}
