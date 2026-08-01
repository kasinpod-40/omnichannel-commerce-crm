import type { Env } from "../../config/env";
import { AuthError } from "../../modules/auth/auth.error";
import {
    createManualPcProduction,
    getPcOverview,
    reconcileSelectedOrders,
    updatePcProductionStatus,
} from "../../modules/production-control/pc.service";
import {
    enqueuePcMaterialRefresh,
    enqueuePcOrderSync,
    enqueuePcOrderSyncBatch,
    enqueuePcProductionComplete,
} from "../../queues/marketplace-event.producer";
import { OperationalError } from "../../utils/errors";
import {
    addAuthCorsHeaders,
    assertAllowedOrigin,
} from "../auth/auth-http";
import {
    assertDashboardSession,
    dashboardApiErrorResponse,
    dashboardJson,
    dashboardMethodNotAllowed,
} from "../shared/dashboard-api";

function pcErrorResponse(
    request: Request,
    env: Env,
    error: unknown
): Response {
    const normalized =
        error instanceof OperationalError
            ? new AuthError(
                  error.code,
                  error.message,
                  error.status ?? 500,
                  error
              )
            : error;

    return dashboardApiErrorResponse(request, env, normalized, {
        code: "PC_REQUEST_FAILED",
        publicMessage: "Production & Stock data is unavailable",
        logLabel: "Production & Stock API failed",
    });
}

async function assertPcMutationPermission(
    request: Request,
    env: Env
): Promise<{
    user_id: string;
    name: string;
}> {
    assertAllowedOrigin(request, env);
    const session = await assertDashboardSession(request, env);

    if (session.user.role !== "admin" && session.user.role !== "manager") {
        throw new AuthError(
            "PC_PERMISSION_DENIED",
            "This account cannot change production or stock",
            403
        );
    }

    return {
        user_id: session.user.user_id,
        name: session.user.name,
    };
}

async function parseJsonBody(
    request: Request,
    required = false
): Promise<Record<string, unknown>> {
    const raw = await request.text();

    if (!raw.trim()) {
        if (required) {
            throw new AuthError(
                "PC_REQUEST_BODY_REQUIRED",
                "JSON body is required",
                400
            );
        }

        return {};
    }

    const contentType =
        request.headers.get("Content-Type")?.toLowerCase() ?? "";

    if (!contentType.includes("application/json")) {
        throw new AuthError(
            "PC_CONTENT_TYPE_INVALID",
            "Content-Type must be application/json",
            415
        );
    }

    let value: unknown;

    try {
        value = JSON.parse(raw);
    } catch {
        throw new AuthError(
            "PC_REQUEST_BODY_INVALID",
            "Invalid JSON body",
            400
        );
    }

    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new AuthError(
            "PC_REQUEST_BODY_INVALID",
            "Invalid JSON body",
            400
        );
    }

    return value as Record<string, unknown>;
}

export async function handlePcOverview(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return dashboardMethodNotAllowed(request, env);
    }

    try {
        await assertDashboardSession(request, env);
        return addAuthCorsHeaders(
            dashboardJson(await getPcOverview(env)),
            request,
            env
        );
    } catch (error) {
        return pcErrorResponse(request, env, error);
    }
}

export async function handlePcOrderReconcile(
    request: Request,
    env: Env,
    orderRecordId: string
): Promise<Response> {
    if (request.method !== "POST") {
        return dashboardMethodNotAllowed(request, env);
    }

    try {
        await assertPcMutationPermission(request, env);
        const id = decodeURIComponent(orderRecordId).trim();

        if (!id) {
            throw new AuthError(
                "PC_ORDER_RECORD_ID_REQUIRED",
                "order_record_id is required",
                400
            );
        }

        await enqueuePcOrderSync(env, {
            order_record_id: id,
            source: "dashboard",
            event_id:
                request.headers.get("Idempotency-Key")?.trim() ||
                `pc:dashboard:order:${id}:${Date.now()}`,
            mark_queued: true,
        });

        return addAuthCorsHeaders(
            dashboardJson(
                {
                    ok: true,
                    status: "queued",
                    order_record_id: id,
                },
                202
            ),
            request,
            env
        );
    } catch (error) {
        return pcErrorResponse(request, env, error);
    }
}

export async function handlePcOrderReconcileAll(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return dashboardMethodNotAllowed(request, env);
    }

    try {
        await assertPcMutationPermission(request, env);
        const body = await parseJsonBody(request, true);

        if (body.confirm_selected_orders !== true) {
            throw new AuthError(
                "PC_BULK_CONFIRMATION_REQUIRED",
                "confirm_selected_orders must be true",
                400
            );
        }

        if (!Array.isArray(body.order_record_ids)) {
            throw new AuthError(
                "PC_ORDER_RECORD_IDS_REQUIRED",
                "order_record_ids must be a non-empty array",
                400
            );
        }

        const requestedIds = body.order_record_ids.map((value) =>
            typeof value === "string" ? value.trim() : ""
        );

        if (
            requestedIds.length === 0 ||
            requestedIds.length > 100 ||
            requestedIds.some((value) => !value)
        ) {
            throw new AuthError(
                "PC_ORDER_RECORD_IDS_INVALID",
                "order_record_ids must contain 1-100 non-empty strings",
                400
            );
        }

        const reconciliation = await reconcileSelectedOrders(
            env,
            requestedIds
        );
        const queued = await enqueuePcOrderSyncBatch(
            env,
            reconciliation.order_record_ids
        );

        return addAuthCorsHeaders(
            dashboardJson(
                {
                    ok: true,
                    status: "queued",
                    requested: reconciliation.requested,
                    queued,
                },
                202
            ),
            request,
            env
        );
    } catch (error) {
        return pcErrorResponse(request, env, error);
    }
}

export async function handlePcMaterialRefresh(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return dashboardMethodNotAllowed(request, env);
    }

    try {
        await assertPcMutationPermission(request, env);
        await enqueuePcMaterialRefresh(env, {
            event_id:
                request.headers.get("Idempotency-Key")?.trim() ||
                `pc:dashboard:material-refresh:${Date.now()}`,
            source: "dashboard",
        });

        return addAuthCorsHeaders(
            dashboardJson({ ok: true, status: "queued" }, 202),
            request,
            env
        );
    } catch (error) {
        return pcErrorResponse(request, env, error);
    }
}

export async function handlePcProductionCreate(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return dashboardMethodNotAllowed(request, env);
    }

    try {
        const actor = await assertPcMutationPermission(request, env);
        const body = await parseJsonBody(request, true);
        const result = await createManualPcProduction(env, {
            product_sku: String(body.product_sku ?? "").trim(),
            planned_qty: Number(body.planned_qty),
            owner:
                typeof body.owner === "string" && body.owner.trim()
                    ? body.owner.trim()
                    : actor.name,
            notes:
                typeof body.notes === "string"
                    ? body.notes.trim()
                    : undefined,
        });

        return addAuthCorsHeaders(
            dashboardJson(result, 201),
            request,
            env
        );
    } catch (error) {
        return pcErrorResponse(request, env, error);
    }
}

export async function handlePcProductionAction(
    request: Request,
    env: Env,
    productionRecordId: string,
    action: "approve" | "start" | "cancel" | "complete"
): Promise<Response> {
    if (request.method !== "POST") {
        return dashboardMethodNotAllowed(request, env);
    }

    try {
        const actor = await assertPcMutationPermission(request, env);
        const body = await parseJsonBody(request, action === "complete");
        const recordId = decodeURIComponent(productionRecordId).trim();

        if (!recordId) {
            throw new AuthError(
                "PC_PRODUCTION_RECORD_ID_REQUIRED",
                "production_record_id is required",
                400
            );
        }

        if (action === "complete") {
            const idempotencyKey =
                request.headers.get("Idempotency-Key")?.trim() ||
                (typeof body.idempotency_key === "string"
                    ? body.idempotency_key.trim()
                    : "");

            if (!idempotencyKey) {
                throw new AuthError(
                    "PC_IDEMPOTENCY_KEY_REQUIRED",
                    "Idempotency-Key is required",
                    400
                );
            }

            await enqueuePcProductionComplete(env, {
                event_id: `pc:production:${recordId}:${idempotencyKey}`,
                production_record_id: recordId,
                actual_qty: Number(body.actual_qty),
                idempotency_key: idempotencyKey,
                owner:
                    typeof body.owner === "string" && body.owner.trim()
                        ? body.owner.trim()
                        : actor.name,
                source: "dashboard",
            });

            return addAuthCorsHeaders(
                dashboardJson(
                    {
                        ok: true,
                        status: "queued",
                        production_record_id: recordId,
                    },
                    202
                ),
                request,
                env
            );
        }

        const result = await updatePcProductionStatus(env, {
            production_record_id: recordId,
            action,
            planned_qty:
                body.planned_qty === undefined
                    ? undefined
                    : Number(body.planned_qty),
            owner:
                typeof body.owner === "string" && body.owner.trim()
                    ? body.owner.trim()
                    : actor.name,
        });

        return addAuthCorsHeaders(
            dashboardJson(result),
            request,
            env
        );
    } catch (error) {
        return pcErrorResponse(request, env, error);
    }
}
