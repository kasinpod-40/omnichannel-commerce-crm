import type { Env } from "../../config/env";
import {
    getMarketplaceDetail,
    getMarketplaceStatus,
    getMarketplaceSyncHistory,
} from "../../modules/marketplace/marketplace-dashboard-status.service";
import { addAuthCorsHeaders } from "../auth/auth-http";
import {
    assertDashboardSession,
    dashboardApiErrorResponse,
    dashboardJson,
    dashboardMethodNotAllowed,
    parseDashboardLanguage,
} from "../shared/dashboard-api";

const PAGE_SIZES = new Set([10, 20, 50]);

function positiveInteger(value: string | null, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function withCors(response: Response, request: Request, env: Env): Response {
    return addAuthCorsHeaders(response, request, env);
}

/** GET /marketplaces/status: สถานะ Connection เท่านั้น ไม่ผูกกับหน้าของ History */
export async function handleMarketplaceStatus(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        return withCors(
            dashboardJson(await getMarketplaceStatus(env, parseDashboardLanguage(request))),
            request,
            env
        );
    } catch (error) {
        return dashboardApiErrorResponse(request, env, error, {
            code: "MARKETPLACES_READ_FAILED",
            publicMessage: "Marketplace status is unavailable",
            logLabel: "Marketplace status API failed",
        });
    }
}

/** GET /marketplaces/sync-history: ประวัติแยก Query/Cache และแบ่งหน้าที่ Backend */
export async function handleMarketplaceSyncHistory(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        const params = new URL(request.url).searchParams;
        const requestedPageSize = positiveInteger(params.get("page_size"), 10);
        const pageSize = PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 10;
        return withCors(
            dashboardJson(await getMarketplaceSyncHistory(
                env,
                parseDashboardLanguage(request),
                {
                    page: positiveInteger(params.get("page"), 1),
                    page_size: pageSize,
                }
            )),
            request,
            env
        );
    } catch (error) {
        return dashboardApiErrorResponse(request, env, error, {
            code: "MARKETPLACE_HISTORY_READ_FAILED",
            publicMessage: "Marketplace sync history is unavailable",
            logLabel: "Marketplace history API failed",
        });
    }
}

/** GET /marketplaces/:marketplaceId: Drawer แยกจากหน้าตารางหลัก */
export async function handleMarketplaceDetail(
    request: Request,
    env: Env,
    marketplaceId: string
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        const detail = await getMarketplaceDetail(
            env,
            decodeURIComponent(marketplaceId),
            parseDashboardLanguage(request)
        );
        if (!detail) {
            return withCors(
                dashboardJson({ code: "MARKETPLACE_NOT_FOUND", message: "Marketplace was not found" }, 404),
                request,
                env
            );
        }
        return withCors(dashboardJson(detail), request, env);
    } catch (error) {
        return dashboardApiErrorResponse(request, env, error, {
            code: "MARKETPLACE_DETAIL_READ_FAILED",
            publicMessage: "Marketplace detail is unavailable",
            logLabel: "Marketplace detail API failed",
        });
    }
}
