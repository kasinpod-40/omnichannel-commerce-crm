import type { Env } from "../../config/env";
import { AuthError } from "../../modules/auth/auth.error";
import {
    createDashboardDocument,
    getDashboardDocumentByNumber,
    getDashboardDocumentList,
    previewDashboardDocument,
    type DashboardDocumentStatus,
} from "../../modules/documents/document-dashboard.service";
import type { DocumentType } from "../../modules/documents/document.types";
import { addAuthCorsHeaders } from "../auth/auth-http";
import {
    assertDashboardSession,
    dashboardApiErrorResponse,
    dashboardJson,
    dashboardMethodNotAllowed,
    dashboardPreflight,
    parsePositiveInteger,
} from "../shared/dashboard-api";
import { parseDocumentType } from "./document-route.shared";

const DOCUMENT_STATUSES = new Set<DashboardDocumentStatus>(["ready", "expired"]);
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

function parseDate(value: string | null, endExclusive = false): number | null {
    if (!value?.trim()) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
        check.getUTCFullYear() !== year ||
        check.getUTCMonth() !== month - 1 ||
        check.getUTCDate() !== day
    ) return null;
    const start = Date.UTC(year, month - 1, day) - BANGKOK_OFFSET_MS;
    return endExclusive ? start + DAY_MS : start;
}

function normalizeDocumentError(error: unknown): unknown {
    if (error instanceof AuthError) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("TAX_DATA_INCOMPLETE:")) {
        return new AuthError(
            "TAX_DATA_INCOMPLETE",
            "Tax information is incomplete",
            422,
            { missing: message.slice("TAX_DATA_INCOMPLETE:".length).split(",") }
        );
    }
    if (message === "DOCUMENT_LINK_SECRET_MISSING") {
        return new AuthError(
            "DOCUMENT_LINK_SECRET_MISSING",
            "Document link service is not configured",
            503
        );
    }
    if (message.includes("FieldNameNotFound")) {
        return new AuthError(
            "DOCUMENT_URL_FIELD_MISSING",
            "Document URL fields are missing from Orders",
            422
        );
    }
    if (message.includes("URLFieldConvFail")) {
        return new AuthError(
            "DOCUMENT_URL_FIELD_INVALID",
            "Document URL fields must be URL/Hyperlink fields",
            422
        );
    }
    return error;
}

function errorResponse(request: Request, env: Env, error: unknown): Response {
    const normalized = normalizeDocumentError(error);
    // เปิดเผยเฉพาะชื่อ field ภาษีที่ขาด ซึ่งเป็น validation contract ที่ UI ต้องใช้แก้ข้อมูล
    // ส่วน AuthError อื่นยังผ่าน error handler กลางและไม่ส่ง cause จาก Lark ออกไป
    if (normalized instanceof AuthError && normalized.code === "TAX_DATA_INCOMPLETE") {
        const cause = normalized.cause as { missing?: unknown } | undefined;
        const missing = Array.isArray(cause?.missing)
            ? cause.missing.filter((item): item is string => typeof item === "string")
            : [];
        return addAuthCorsHeaders(
            dashboardJson({
                code: normalized.code,
                message: normalized.message,
                details: { missing },
            }, normalized.status),
            request,
            env
        );
    }
    return dashboardApiErrorResponse(request, env, normalized, {
        code: "DOCUMENTS_API_FAILED",
        publicMessage: "Document data is unavailable",
        logLabel: "Documents API failed",
    });
}

async function readDocumentBody(request: Request): Promise<{
    orderId: string;
    type: DocumentType;
    idempotencyKey: string;
}> {
    const body = (await request.json()) as {
        order_id?: unknown;
        document_type?: unknown;
        idempotency_key?: unknown;
    };
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    const type = parseDocumentType(
        typeof body.document_type === "string" ? body.document_type.trim() : ""
    );
    const idempotencyKey =
        request.headers.get("Idempotency-Key")?.trim() ||
        (typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "");
    if (!orderId || !type) {
        throw new AuthError(
            "INVALID_DOCUMENT_REQUEST",
            "Order ID and document type are required",
            400
        );
    }
    return { orderId, type, idempotencyKey };
}

export async function handleDashboardDocumentRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (!pathname.startsWith("/dashboard/documents")) return null;
    if (request.method === "OPTIONS") return dashboardPreflight(request, env);

    try {
        const session = await assertDashboardSession(request, env);

        if (pathname === "/dashboard/documents" && request.method === "GET") {
            const params = new URL(request.url).searchParams;
            const type = parseDocumentType(params.get("type") ?? "");
            const rawStatus = params.get("status") as DashboardDocumentStatus | null;
            const response = await getDashboardDocumentList(env, {
                search: params.get("search") ?? "",
                type,
                status: rawStatus && DOCUMENT_STATUSES.has(rawStatus) ? rawStatus : null,
                date_from_ms: parseDate(params.get("date_from")),
                date_to_ms: parseDate(params.get("date_to"), true),
                order_id: params.get("order_id")?.trim() ?? "",
                order_number: params.get("order_number")?.trim() ?? "",
                page: parsePositiveInteger(params.get("page"), 1, 100_000),
                page_size: parsePositiveInteger(params.get("page_size"), 10, 100),
            });
            return addAuthCorsHeaders(dashboardJson(response), request, env);
        }

        const numberMatch = pathname.match(
            /^\/dashboard\/documents\/number\/([^/]+)$/
        );
        if (numberMatch?.[1] && request.method === "GET") {
            const response = await getDashboardDocumentByNumber(
                env,
                request.url,
                decodeURIComponent(numberMatch[1])
            );
            if (!response) {
                throw new AuthError(
                    "DOCUMENT_NOT_FOUND",
                    "Document was not found",
                    404
                );
            }
            return addAuthCorsHeaders(dashboardJson(response), request, env);
        }

        const detailMatch = pathname.match(
            /^\/dashboard\/documents\/order\/([^/]+)\/(quotation|invoice|tax-invoice)$/
        );
        if (detailMatch?.[1] && detailMatch[2] && request.method === "GET") {
            const response = await previewDashboardDocument(
                env,
                request.url,
                decodeURIComponent(detailMatch[1]),
                detailMatch[2] as DocumentType
            );
            return addAuthCorsHeaders(dashboardJson(response), request, env);
        }

        if (pathname === "/dashboard/documents/preview" && request.method === "POST") {
            const body = await readDocumentBody(request);
            const response = await previewDashboardDocument(
                env,
                request.url,
                body.orderId,
                body.type
            );
            return addAuthCorsHeaders(dashboardJson(response), request, env);
        }

        if (pathname === "/dashboard/documents" && request.method === "POST") {
            if (session.user.role !== "admin" && session.user.role !== "manager") {
                throw new AuthError(
                    "DOCUMENT_PERMISSION_DENIED",
                    "This account cannot create documents",
                    403
                );
            }
            const body = await readDocumentBody(request);
            const response = await createDashboardDocument({
                env,
                requestUrl: request.url,
                orderId: body.orderId,
                type: body.type,
                idempotencyKey: body.idempotencyKey,
                actor: {
                    userId: session.user.user_id,
                    name: session.user.name,
                    role: session.user.role,
                },
            });
            return addAuthCorsHeaders(dashboardJson(response, 201), request, env);
        }

        return dashboardMethodNotAllowed(request, env);
    } catch (error) {
        return errorResponse(request, env, error);
    }
}
