import type { Env } from "../../config/env";
import { dashboardPreflight } from "../shared/dashboard-api";
import { handlePipelineDetail, handlePipelineList } from "./pipelines.route";

export async function handlePipelineRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname !== "/pipelines" && !pathname.startsWith("/pipelines/")) return null;
    if (request.method === "OPTIONS") return dashboardPreflight(request, env);
    if (pathname === "/pipelines") return handlePipelineList(request, env);
    const match = pathname.match(/^\/pipelines\/([^/]+)$/);
    return match?.[1] ? handlePipelineDetail(request, env, match[1]) : null;
}
