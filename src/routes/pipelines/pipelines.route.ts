import type { Env } from "../../config/env";
import {
    getPipelineDetail,
    getPipelineList,
    type PipelineListQuery,
    type PipelineStatusResponse,
} from "../../modules/pipeline/pipeline-dashboard.service";
import { addAuthCorsHeaders } from "../auth/auth-http";
import {
    assertDashboardSession,
    dashboardApiErrorResponse,
    dashboardJson,
    dashboardMethodNotAllowed,
} from "../shared/dashboard-api";

const STATUSES = new Set<PipelineStatusResponse>(["open", "won", "lost"]);

function parseListQuery(request: Request): PipelineListQuery {
    const params = new URL(request.url).searchParams;
    const status = params.get("status") as PipelineStatusResponse | null;
    return {
        search: params.get("search") ?? "",
        status: status && STATUSES.has(status) ? status : null,
    };
}

function errorResponse(request: Request, env: Env, error: unknown): Response {
    return dashboardApiErrorResponse(request, env, error, {
        code: "PIPELINES_READ_FAILED",
        publicMessage: "Pipeline data is unavailable",
        logLabel: "Pipelines API failed",
    });
}

export async function handlePipelineList(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        return addAuthCorsHeaders(
            dashboardJson(await getPipelineList(env, parseListQuery(request))),
            request,
            env
        );
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

export async function handlePipelineDetail(
    request: Request,
    env: Env,
    pipelineId: string
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        const result = await getPipelineDetail(env, decodeURIComponent(pipelineId));
        if (!result) {
            return addAuthCorsHeaders(
                dashboardJson({ code: "PIPELINE_NOT_FOUND", message: "Pipeline was not found" }, 404),
                request,
                env
            );
        }
        return addAuthCorsHeaders(dashboardJson(result), request, env);
    } catch (error) {
        return errorResponse(request, env, error);
    }
}
