import type { Env } from "../../config/env";
import { AuthError } from "../../modules/auth/auth.error";
import {
    approvePaymentReview,
    getPaymentReviewDetail,
    getPaymentReviewImage,
    PaymentReviewError,
    rejectPaymentReview,
} from "../../modules/payments/payment-review.service";
import { addAuthCorsHeaders } from "../auth/auth-http";
import {
    assertDashboardSession,
    dashboardApiErrorResponse,
    dashboardJson,
    dashboardMethodNotAllowed,
} from "../shared/dashboard-api";

function assertReviewer(role: string): void {
    if (role !== "admin" && role !== "manager") {
        throw new AuthError(
            "PAYMENT_REVIEW_FORBIDDEN",
            "Only Admin or Manager can review payments",
            403
        );
    }
}

async function parseActionBody(request: Request): Promise<Record<string, unknown>> {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
        throw new PaymentReviewError(
            "INVALID_REQUEST_BODY",
            "Request body must be JSON",
            400
        );
    }
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new PaymentReviewError(
            "INVALID_REQUEST_BODY",
            "Request body is invalid",
            400
        );
    }
    return parsed as Record<string, unknown>;
}

function readIdempotencyKey(request: Request, body: Record<string, unknown>): string {
    const header = request.headers.get("Idempotency-Key")?.trim();
    const bodyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
    return header || bodyKey;
}

function errorResponse(request: Request, env: Env, error: unknown): Response {
    if (error instanceof PaymentReviewError) {
        return addAuthCorsHeaders(
            dashboardJson({ code: error.code, message: error.message }, error.status),
            request,
            env
        );
    }
    return dashboardApiErrorResponse(request, env, error, {
        code: "PAYMENT_REVIEW_FAILED",
        publicMessage: "Payment review is unavailable",
        logLabel: "Payment Review API failed",
    });
}

export async function handlePaymentReviewDetail(
    request: Request,
    env: Env,
    orderId: string
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        return addAuthCorsHeaders(
            dashboardJson(await getPaymentReviewDetail(env, decodeURIComponent(orderId))),
            request,
            env
        );
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

export async function handlePaymentReviewImage(
    request: Request,
    env: Env,
    orderId: string
): Promise<Response> {
    if (request.method !== "GET") return dashboardMethodNotAllowed(request, env);
    try {
        await assertDashboardSession(request, env);
        const image = await getPaymentReviewImage(env, decodeURIComponent(orderId));
        if (!image) {
            return addAuthCorsHeaders(
                dashboardJson(
                    { code: "PAYMENT_SLIP_NOT_FOUND", message: "Payment slip was not found" },
                    404
                ),
                request,
                env
            );
        }
        return addAuthCorsHeaders(
            new Response(image.bytes, {
                headers: {
                    "Content-Type": image.mime_type,
                    "Cache-Control": "private, max-age=300",
                    "Content-Disposition": "inline",
                    "X-Content-Type-Options": "nosniff",
                },
            }),
            request,
            env
        );
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

export async function handlePaymentReviewApprove(
    request: Request,
    env: Env,
    orderId: string
): Promise<Response> {
    if (request.method !== "POST") return dashboardMethodNotAllowed(request, env);
    try {
        const session = await assertDashboardSession(request, env);
        assertReviewer(session.user.role);
        const body = await parseActionBody(request);
        return addAuthCorsHeaders(
            dashboardJson(
                await approvePaymentReview(env, {
                    order_record_id: decodeURIComponent(orderId),
                    idempotency_key: readIdempotencyKey(request, body),
                    actor: session.user,
                })
            ),
            request,
            env
        );
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

export async function handlePaymentReviewReject(
    request: Request,
    env: Env,
    orderId: string
): Promise<Response> {
    if (request.method !== "POST") return dashboardMethodNotAllowed(request, env);
    try {
        const session = await assertDashboardSession(request, env);
        assertReviewer(session.user.role);
        const body = await parseActionBody(request);
        const reason = typeof body.reason === "string" ? body.reason : "";
        return addAuthCorsHeaders(
            dashboardJson(
                await rejectPaymentReview(env, {
                    order_record_id: decodeURIComponent(orderId),
                    idempotency_key: readIdempotencyKey(request, body),
                    reason,
                    actor: session.user,
                })
            ),
            request,
            env
        );
    } catch (error) {
        return errorResponse(request, env, error);
    }
}
