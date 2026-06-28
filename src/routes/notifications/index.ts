import type { Env } from "../../config/env";
import { dashboardPreflight } from "../shared/dashboard-api";
import {
    handleNotificationList,
    handleNotificationRead,
    handleNotificationsReadAll,
    handleNotificationUnreadCount,
} from "./notifications.route";

export async function handleNotificationRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname !== "/notifications" && !pathname.startsWith("/notifications/")) {
        return null;
    }
    if (request.method === "OPTIONS") return dashboardPreflight(request, env);
    if (pathname === "/notifications") return handleNotificationList(request, env);
    if (pathname === "/notifications/unread-count") {
        return handleNotificationUnreadCount(request, env);
    }
    if (pathname === "/notifications/read-all") {
        return handleNotificationsReadAll(request, env);
    }
    const readMatch = pathname.match(/^\/notifications\/([^/]+)\/read$/);
    return readMatch?.[1]
        ? handleNotificationRead(request, env, readMatch[1])
        : null;
}
