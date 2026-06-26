import type { Env } from "../config/env";
import { handleAuthRoutes } from "../routes/auth";
import { handleDashboardRoutes } from "../routes/dashboard";
import { handleDocumentRoutes } from "../routes/documents";
import { handleHealthRoute } from "../routes/health.route";
import { handleLarkOperationalRoutes } from "../routes/lark";
import { handleLineRoutes } from "../routes/line";
import { handleMarketplaceRoutes } from "../routes/marketplace";
import { handleTestingRoutes } from "../routes/testing";
import { jsonResponse } from "../utils/response";

type FeatureRouteHandler = () => Promise<Response | null>;

export async function handleHttpRequest(
    request: Request,
    env: Env,
    ctx: ExecutionContext
): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    if (pathname === "/health") {
        return handleHealthRoute(env);
    }

    const featureHandlers: FeatureRouteHandler[] = [
        () => handleAuthRoutes(request, env, pathname),
        () => handleLineRoutes(request, env, pathname),
        () => handleLarkOperationalRoutes(request, env, pathname),
        () => handleDashboardRoutes(request, env, pathname),
        () => handleDocumentRoutes(request, env, pathname),
        () => handleMarketplaceRoutes(request, env, ctx, pathname),
        () => handleTestingRoutes(request, env, pathname),
    ];

    for (const handleFeatureRoute of featureHandlers) {
        const response = await handleFeatureRoute();

        if (response) {
            return response;
        }
    }

    return jsonResponse(
        {
            ok: false,
            message: "Route not found",
            path: pathname,
        },
        404
    );
}
