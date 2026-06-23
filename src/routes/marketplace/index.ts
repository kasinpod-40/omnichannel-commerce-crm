import type { Env } from "../../config/env";
import {
    handleLazadaAdminRefreshToken,
    handleLazadaAdminStatus,
    handleLazadaAdminSyncOrder,
    handleLazadaOAuthCallback,
    handleLazadaWebhook,
} from "./lazada/live.route";
import {
    handleLazadaAdminPollStatus,
    handleLazadaAdminResetPollCursor,
    handleLazadaAdminSyncRecent,
} from "./lazada/poll.route";
import { handleMarketplaceManualBatch } from "./simulation/batch.route";
import { handleLazadaSimulation } from "./simulation/lazada.route";
import { handleShopeeSimulation } from "./simulation/shopee.route";
import { handleTikTokSimulation } from "./simulation/tiktok.route";
import {
    handleTikTokAdminRefreshToken,
    handleTikTokAdminStatus,
    handleTikTokAdminSyncOrder,
    handleTikTokOAuthCallback,
    handleTikTokWebhook,
} from "./tiktok/live.route";
import { handleMarketplaceOrderUpsert } from "./upsert.route";

export async function handleMarketplaceRoutes(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
    pathname: string
): Promise<Response | null> {
    if (pathname === "/admin/marketplace/orders/upsert") {
        return handleMarketplaceOrderUpsert(request, env);
    }

    if (pathname === "/admin/marketplace/simulate/shopee") {
        return handleShopeeSimulation(request, env);
    }

    if (pathname === "/admin/marketplace/simulate/lazada") {
        return handleLazadaSimulation(request, env);
    }

    if (pathname === "/admin/marketplace/simulate/tiktok") {
        return handleTikTokSimulation(request, env);
    }

    if (
        pathname === "/admin/marketplace/manual/batch" ||
        pathname === "/admin/marketplace/simulate/batch"
    ) {
        return handleMarketplaceManualBatch(request, env);
    }

    if (pathname === "/oauth/tiktok/callback") {
        return handleTikTokOAuthCallback(request, env);
    }

    if (pathname === "/webhooks/tiktok") {
        return handleTikTokWebhook(request, env);
    }

    if (pathname === "/admin/tiktok/status") {
        return handleTikTokAdminStatus(request, env);
    }

    if (pathname === "/admin/tiktok/sync/order") {
        return handleTikTokAdminSyncOrder(request, env);
    }

    if (pathname === "/admin/tiktok/token/refresh") {
        return handleTikTokAdminRefreshToken(request, env);
    }

    if (pathname === "/oauth/lazada/callback") {
        return handleLazadaOAuthCallback(request, env);
    }

    if (pathname === "/webhooks/lazada") {
        return handleLazadaWebhook(request, env, ctx);
    }

    if (pathname === "/admin/lazada/status") {
        return handleLazadaAdminStatus(request, env);
    }

    if (pathname === "/admin/lazada/sync/order") {
        return handleLazadaAdminSyncOrder(request, env);
    }

    if (pathname === "/admin/lazada/sync/recent") {
        return handleLazadaAdminSyncRecent(request, env);
    }

    if (pathname === "/admin/lazada/poll/status") {
        return handleLazadaAdminPollStatus(request, env);
    }

    if (pathname === "/admin/lazada/poll/reset") {
        return handleLazadaAdminResetPollCursor(request, env);
    }

    if (pathname === "/admin/lazada/token/refresh") {
        return handleLazadaAdminRefreshToken(request, env);
    }

    return null;
}
