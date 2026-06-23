import type { Env } from "../../config/env";
import { handleMarketplaceDashboard } from "../marketplace/dashboard.route";
import { handleDashboardSummary } from "./executive.route";

export async function handleDashboardRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname === "/admin/dashboard/summary") {
        return handleDashboardSummary(request, env);
    }

    if (pathname === "/admin/dashboard/marketplace") {
        return handleMarketplaceDashboard(request, env);
    }

    return null;
}
