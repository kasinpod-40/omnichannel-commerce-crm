import type { Env } from "../../config/env";
import {
    getOrderDetail,
    getOrderList,
    type OrderListQuery,
    type OrderStatusResponse,
    type PaymentStatusResponse,
} from "../../modules/orders/order-dashboard.service";
import type { DashboardChannel } from "../../modules/dashboard-read/dashboard-read.types";
import { addAuthCorsHeaders } from "../auth/auth-http";
import {
    assertDashboardSession,
    dashboardApiErrorResponse,
    dashboardJson,
    dashboardMethodNotAllowed,
    parsePositiveInteger,
} from "../shared/dashboard-api";

const CHANNELS = new Set<DashboardChannel>(["LINE", "Shopee", "Lazada", "TikTok Shop"]);
const ORDER_STATUSES = new Set<OrderStatusResponse>(["Draft", "Confirmed", "Completed", "Cancelled"]);
const PAYMENT_STATUSES = new Set<PaymentStatusResponse>(["Pending", "Paid", "Overdue"]);

function parseListQuery(request: Request): OrderListQuery {
    const params = new URL(request.url).searchParams;
    const channel = params.get("channel") as DashboardChannel | null;
    const orderStatus = params.get("order_status") as OrderStatusResponse | null;
    const paymentStatus = params.get("payment_status") as PaymentStatusResponse | null;
    const rawSort = params.get("sort");
    const sort = rawSort === "amount_desc" || rawSort === "created_desc"
        ? rawSort
        : "updated_desc";

    return {
        search: params.get("search") ?? "",
        channel: channel && CHANNELS.has(channel) ? channel : null,
        order_status: orderStatus && ORDER_STATUSES.has(orderStatus) ? orderStatus : null,
        payment_status: paymentStatus && PAYMENT_STATUSES.has(paymentStatus) ? paymentStatus : null,
        sort,
        page: parsePositiveInteger(params.get("page"), 1, 100_000),
        page_size: parsePositiveInteger(params.get("page_size"), 10, 100),
    };
}

function errorResponse(request: Request, env: Env, error: unknown): Response {
    return dashboardApiErrorResponse(request, env, error, {
        code: "ORDERS_READ_FAILED",
        publicMessage: "Order data is unavailable",
        logLabel: "Orders API failed",
    });
}

export async function handleOrderList(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        return addAuthCorsHeaders(
            dashboardJson(await getOrderList(env, parseListQuery(request))),
            request,
            env
        );
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

export async function handleOrderDetail(
    request: Request,
    env: Env,
    orderId: string
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        const result = await getOrderDetail(env, decodeURIComponent(orderId));
        if (!result) {
            return addAuthCorsHeaders(
                dashboardJson({ code: "ORDER_NOT_FOUND", message: "Order was not found" }, 404),
                request,
                env
            );
        }
        return addAuthCorsHeaders(dashboardJson(result), request, env);
    } catch (error) {
        return errorResponse(request, env, error);
    }
}
