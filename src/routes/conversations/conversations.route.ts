import type { Env } from "../../config/env";
import {
    getConversationDetail,
    getConversationList,
    getConversationMessages,
    type ConversationIntentResponse,
    type ConversationListQuery,
    type ConversationMessageQuery,
    type ConversationProcessStatusResponse,
} from "../../modules/conversations/conversation-dashboard.service";
import { getConversationImage } from "../../modules/conversations/conversation-image.service";
import { addAuthCorsHeaders } from "../auth/auth-http";
import {
    assertDashboardSession,
    dashboardApiErrorResponse,
    dashboardJson,
    dashboardMethodNotAllowed,
} from "../shared/dashboard-api";

const INTENTS = new Set<ConversationIntentResponse>([
    "Just Browsing",
    "Interested",
    "Purchase Intent",
    "Ready To Buy",
    "Payment",
    "Support",
]);
const STATUSES = new Set<ConversationProcessStatusResponse>([
    "processed",
    "pending",
    "failed",
]);
const PAGE_SIZES = new Set([10, 20, 50]);

function positiveInteger(value: string | null, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseListQuery(request: Request): ConversationListQuery {
    const params = new URL(request.url).searchParams;
    const intent = params.get("intent") as ConversationIntentResponse | null;
    const status = params.get("process_status") as ConversationProcessStatusResponse | null;
    const requestedPageSize = positiveInteger(params.get("page_size"), 10);

    return {
        search: params.get("search") ?? "",
        intent: intent && INTENTS.has(intent) ? intent : null,
        process_status: status && STATUSES.has(status) ? status : null,
        page: positiveInteger(params.get("page"), 1),
        page_size: PAGE_SIZES.has(requestedPageSize) ? requestedPageSize : 10,
    };
}

function parseMessageQuery(request: Request): ConversationMessageQuery {
    const params = new URL(request.url).searchParams;
    return {
        limit: Math.min(positiveInteger(params.get("limit"), 20), 50),
        before: params.get("before")?.trim() || null,
    };
}

function errorResponse(request: Request, env: Env, error: unknown): Response {
    return dashboardApiErrorResponse(request, env, error, {
        code: "CONVERSATIONS_READ_FAILED",
        publicMessage: "Conversation data is unavailable",
        logLabel: "Conversations API failed",
    });
}

function notFound(request: Request, env: Env): Response {
    return addAuthCorsHeaders(
        dashboardJson({
            code: "CONVERSATION_NOT_FOUND",
            message: "Conversation was not found",
        }, 404),
        request,
        env
    );
}

/** GET /conversations: รวมข้อความขาเข้า LINE เป็น Timeline ต่อ Customer */
export async function handleConversationList(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);

    try {
        await assertDashboardSession(request, env);
        const result = await getConversationList(env, parseListQuery(request));
        return addAuthCorsHeaders(dashboardJson(result), request, env);
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

/** GET /conversations/:conversationId: ข้อมูล Customer และข้อความชุดล่าสุด */
export async function handleConversationDetail(
    request: Request,
    env: Env,
    conversationId: string
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);

    try {
        await assertDashboardSession(request, env);
        const result = await getConversationDetail(env, decodeURIComponent(conversationId));
        if (!result) return notFound(request, env);
        return addAuthCorsHeaders(dashboardJson(result), request, env);
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

/** GET /conversations/:conversationId/messages: cursor pagination สำหรับโหลดข้อความเก่าด้านบน */
export async function handleConversationMessages(
    request: Request,
    env: Env,
    conversationId: string
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);

    try {
        await assertDashboardSession(request, env);
        const result = await getConversationMessages(
            env,
            decodeURIComponent(conversationId),
            parseMessageQuery(request)
        );
        if (!result) return notFound(request, env);
        return addAuthCorsHeaders(dashboardJson(result), request, env);
    } catch (error) {
        if (error instanceof Error && error.message === "INVALID_MESSAGE_CURSOR") {
            return addAuthCorsHeaders(
                dashboardJson({
                    code: "INVALID_MESSAGE_CURSOR",
                    message: "Message cursor is invalid",
                }, 400),
                request,
                env
            );
        }
        return errorResponse(request, env, error);
    }
}

/** GET /conversations/images/:messageRecordId: image proxy ที่ตรวจ Dashboard session ก่อนส่งไฟล์ */
export async function handleConversationImage(
    request: Request,
    env: Env,
    messageRecordId: string
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);

    try {
        await assertDashboardSession(request, env);
        const image = await getConversationImage(env, decodeURIComponent(messageRecordId));
        if (!image) {
            return addAuthCorsHeaders(
                dashboardJson({
                    code: "CONVERSATION_IMAGE_NOT_FOUND",
                    message: "Conversation image was not found",
                }, 404),
                request,
                env
            );
        }

        const response = new Response(image.bytes, {
            headers: {
                "Content-Type": image.mime_type,
                "Cache-Control": "private, max-age=300",
                "Content-Disposition": "inline",
                "X-Content-Type-Options": "nosniff",
            },
        });
        return addAuthCorsHeaders(response, request, env);
    } catch (error) {
        return errorResponse(request, env, error);
    }
}
