import type { Env } from "../../config/env";
import { dashboardPreflight } from "../shared/dashboard-api";
import {
    handleDemoShopLowStockRetry,
    handleDemoShopOrderCreate,
    handleDemoShopPage,
    handleDemoShopProducts,
} from "./demo-shop.route";

export async function handleDemoShopRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname !== "/demo-shop" && !pathname.startsWith("/demo-shop/")) {
        return null;
    }

    if (request.method === "OPTIONS") {
        return dashboardPreflight(request, env);
    }

    switch (pathname) {
        case "/demo-shop":
            return handleDemoShopPage(request, env);
        case "/demo-shop/api/products":
            return await handleDemoShopProducts(request, env);
        case "/demo-shop/api/orders":
            return await handleDemoShopOrderCreate(request, env);
        case "/demo-shop/api/notifications/low-stock/retry":
            return await handleDemoShopLowStockRetry(request, env);
        default:
            return null;
    }
}
