import type { Env } from "../../config/env";
import { dashboardPreflight } from "../shared/dashboard-api";
import { handleOrderDetail, handleOrderList } from "./orders.route";

export async function handleOrderRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname !== "/orders" && !pathname.startsWith("/orders/")) return null;
    if (request.method === "OPTIONS") return dashboardPreflight(request, env);
    if (pathname === "/orders") return handleOrderList(request, env);
    const match = pathname.match(/^\/orders\/([^/]+)$/);
    return match?.[1] ? handleOrderDetail(request, env, match[1]) : null;
}
