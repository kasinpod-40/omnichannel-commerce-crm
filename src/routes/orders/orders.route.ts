import type { Env } from "../../config/env";
import {
    getOrderDetail,
    getOrderList,
    type OrderDateBasis,
    type OrderListQuery,
    type OrderStatusResponse,
    type PaymentStatusResponse,
    type PaymentDisplayStatusResponse,
} from "../../modules/orders/order-dashboard.service";
import { updateOrderAmount } from "../../modules/orders/order-amount.service";
import { AuthError } from "../../modules/auth/auth.error";
import type { OrderWorkQueue } from "../../modules/orders/order-work-queue";
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
const PAYMENT_STATES = new Set<PaymentDisplayStatusResponse>(["unpaid", "payment_review", "paid", "overdue"]);
const WORK_QUEUES = new Set<OrderWorkQueue>([
    "payment_review",
    "waiting_new_slip",
    "waiting_payment",
    "missing_delivery",
    "ready_to_ship",
    "marketplace_ready_to_ship",
]);
const DATE_BASES = new Set<OrderDateBasis>(["created_at", "paid_at", "updated_at"]);

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

function parseDate(value: string | null, endExclusive = false): number | null {
    if (!value?.trim()) return null;
    const trimmed = value.trim();
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnly) {
        const year = Number(dateOnly[1]);
        const month = Number(dateOnly[2]);
        const day = Number(dateOnly[3]);
        const check = new Date(Date.UTC(year, month - 1, day));
        if (
            check.getUTCFullYear() !== year ||
            check.getUTCMonth() !== month - 1 ||
            check.getUTCDate() !== day
        ) return null;
        const start = Date.UTC(year, month - 1, day) - BANGKOK_OFFSET_MS;
        return endExclusive ? start + DAY_MS : start;
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseListQuery(request: Request): OrderListQuery {
    const params = new URL(request.url).searchParams;
    const channel = params.get("channel") as DashboardChannel | null;
    const orderStatus = params.get("order_status") as OrderStatusResponse | null;
    const paymentStatus = params.get("payment_status") as PaymentStatusResponse | null;
    const paymentState = params.get("payment_state") as PaymentDisplayStatusResponse | null;
    const workQueue = params.get("work_queue") as OrderWorkQueue | null;
    const dateBasis = params.get("date_basis") as OrderDateBasis | null;
    const rawSort = params.get("sort");
    const sort = rawSort === "amount_desc" || rawSort === "created_desc"
        ? rawSort
        : "updated_desc";

    return {
        search: params.get("search") ?? "",
        channel: channel && CHANNELS.has(channel) ? channel : null,
        order_status: orderStatus && ORDER_STATUSES.has(orderStatus) ? orderStatus : null,
        payment_status: paymentStatus && PAYMENT_STATUSES.has(paymentStatus) ? paymentStatus : null,
        payment_state: paymentState && PAYMENT_STATES.has(paymentState) ? paymentState : null,
        work_queue: workQueue && WORK_QUEUES.has(workQueue) ? workQueue : null,
        date_basis: dateBasis && DATE_BASES.has(dateBasis) ? dateBasis : null,
        date_from_ms: parseDate(params.get("date_from")),
        date_to_ms: parseDate(params.get("date_to"), true),
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


export async function handleOrderAmountUpdate(
    request: Request,
    env: Env,
    orderId: string
): Promise<Response> {
    if (request.method !== "POST") return dashboardMethodNotAllowed(request, env);
    try {
        const session = await assertDashboardSession(request, env);
        if (!(["admin", "manager"] as const).includes(session.user.role as "admin" | "manager")) {
            throw new AuthError(
                "ORDER_AMOUNT_PERMISSION_DENIED",
                "This account cannot edit order amounts",
                403
            );
        }
        const body = (await request.json()) as {
            total_amount?: unknown;
            expected_updated_at?: unknown;
            reason?: unknown;
            idempotency_key?: unknown;
        };
        const idempotencyKey =
            request.headers.get("Idempotency-Key")?.trim() ||
            (typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "");
        const result = await updateOrderAmount(env, {
            orderId: decodeURIComponent(orderId),
            amount: typeof body.total_amount === "string"
                ? body.total_amount
                : String(body.total_amount ?? ""),
            expectedUpdatedAt: typeof body.expected_updated_at === "string"
                ? body.expected_updated_at
                : "",
            idempotencyKey,
            reason: typeof body.reason === "string" ? body.reason : undefined,
            actor: {
                userId: session.user.user_id,
                name: session.user.name,
                role: session.user.role,
            },
        });
        return addAuthCorsHeaders(dashboardJson(result), request, env);
    } catch (error) {
        return errorResponse(request, env, error);
    }
}
