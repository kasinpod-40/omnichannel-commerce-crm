import type { Env } from "../../config/env";
import { dashboardPreflight } from "../shared/dashboard-api";
import {
    handlePcMaterialRefresh,
    handlePcOrderReconcile,
    handlePcOrderReconcileAll,
    handlePcOverview,
    handlePcProductionAction,
    handlePcProductionCreate,
} from "./pc.route";

export async function handleProductionControlRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname !== "/pc" && !pathname.startsWith("/pc/")) {
        return null;
    }

    if (request.method === "OPTIONS") {
        return dashboardPreflight(request, env);
    }

    if (pathname === "/pc/overview") {
        return handlePcOverview(request, env);
    }

    if (pathname === "/pc/reconcile/orders") {
        return handlePcOrderReconcileAll(request, env);
    }

    if (pathname === "/pc/materials/refresh") {
        return handlePcMaterialRefresh(request, env);
    }

    if (pathname === "/pc/production") {
        return handlePcProductionCreate(request, env);
    }

    const orderMatch = pathname.match(/^\/pc\/orders\/([^/]+)\/reconcile$/);
    if (orderMatch?.[1]) {
        return handlePcOrderReconcile(request, env, orderMatch[1]);
    }

    const productionMatch = pathname.match(
        /^\/pc\/production\/([^/]+)\/(approve|start|cancel|complete)$/
    );
    if (productionMatch?.[1] && productionMatch[2]) {
        return handlePcProductionAction(
            request,
            env,
            productionMatch[1],
            productionMatch[2] as "approve" | "start" | "cancel" | "complete"
        );
    }

    return null;
}
