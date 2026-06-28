import type { Env } from "../../config/env";
import type { NotificationType } from "../../modules/notifications/notification.types";
import {
    getNotificationList,
    getNotificationUnreadCount,
    markAllNotificationsRead,
    markNotificationRead,
    type NotificationListQuery,
    type NotificationReadFilter,
} from "../../modules/notifications/notification-dashboard.service";
import { addAuthCorsHeaders } from "../auth/auth-http";
import {
    assertDashboardSession,
    dashboardApiErrorResponse,
    dashboardJson,
    dashboardMethodNotAllowed,
    parsePositiveInteger,
} from "../shared/dashboard-api";

const TYPES = new Set<NotificationType>([
    "NEW_LEAD",
    "HOT_LEAD",
    "PAYMENT_REVIEW",
    "PAYMENT_VERIFIED",
    "SALE_WON",
    "SALE_LOST",
    "PAYMENT_OVERDUE",
]);
const READ_FILTERS = new Set<NotificationReadFilter>(["all", "unread", "read"]);

function parseListQuery(request: Request): NotificationListQuery {
    const params = new URL(request.url).searchParams;
    const type = params.get("type") as NotificationType | null;
    const read = params.get("read") as NotificationReadFilter | null;
    return {
        search: params.get("search") ?? "",
        type: type && TYPES.has(type) ? type : null,
        read: read && READ_FILTERS.has(read) ? read : "all",
        page: parsePositiveInteger(params.get("page"), 1, 100_000),
        page_size: parsePositiveInteger(params.get("page_size"), 10, 100),
    };
}

function errorResponse(request: Request, env: Env, error: unknown): Response {
    return dashboardApiErrorResponse(request, env, error, {
        code: "NOTIFICATIONS_READ_FAILED",
        publicMessage: "Notification data is unavailable",
        logLabel: "Notifications API failed",
    });
}

export async function handleNotificationList(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        return addAuthCorsHeaders(
            dashboardJson(await getNotificationList(env, parseListQuery(request))),
            request,
            env
        );
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

export async function handleNotificationUnreadCount(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        return addAuthCorsHeaders(
            dashboardJson({ unread: await getNotificationUnreadCount(env) }),
            request,
            env
        );
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

export async function handleNotificationRead(
    request: Request,
    env: Env,
    notificationId: string
): Promise<Response> {
    if (request.method !== "POST") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        return addAuthCorsHeaders(
            dashboardJson(
                await markNotificationRead(env, decodeURIComponent(notificationId))
            ),
            request,
            env
        );
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

export async function handleNotificationsReadAll(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        return addAuthCorsHeaders(
            dashboardJson(await markAllNotificationsRead(env)),
            request,
            env
        );
    } catch (error) {
        return errorResponse(request, env, error);
    }
}
