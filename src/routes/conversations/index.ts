import type { Env } from "../../config/env";
import { dashboardPreflight } from "../shared/dashboard-api";
import {
    handleConversationDetail,
    handleConversationImage,
    handleConversationList,
    handleConversationMessages,
} from "./conversations.route";

export async function handleConversationRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname !== "/conversations" && !pathname.startsWith("/conversations/")) return null;
    if (request.method === "OPTIONS") return dashboardPreflight(request, env);
    if (pathname === "/conversations") return handleConversationList(request, env);

    const imageMatch = pathname.match(/^\/conversations\/images\/([^/]+)$/);
    if (imageMatch?.[1]) return handleConversationImage(request, env, imageMatch[1]);

    const messagesMatch = pathname.match(/^\/conversations\/([^/]+)\/messages$/);
    if (messagesMatch?.[1]) return handleConversationMessages(request, env, messagesMatch[1]);

    const detailMatch = pathname.match(/^\/conversations\/([^/]+)$/);
    return detailMatch?.[1]
        ? handleConversationDetail(request, env, detailMatch[1])
        : null;
}
