import type { Env } from "../../config/env";
import {
    enqueuePcMaterialRefresh,
    enqueuePcOrderSync,
    enqueuePcProductionComplete,
} from "../../queues/marketplace-event.producer";
import { jsonResponse } from "../../utils/response";
import { asRecord, firstText } from "../shared/value";
import {
    getOrderRecordId,
    getWorkflowToken,
    isWorkflowRequestBody,
    type WorkflowRequestBody,
} from "./workflow-request";

function configuredWorkflowToken(env: Env): string {
    return env.LARK_WORKFLOW_TOKEN?.trim() ?? "";
}

function authorizeWorkflow(
    request: Request,
    env: Env,
    body: WorkflowRequestBody
): Response | null {
    const configured = configuredWorkflowToken(env);

    if (!configured) {
        return jsonResponse(
            {
                ok: false,
                code: "WORKFLOW_TOKEN_NOT_CONFIGURED",
                message: "LARK_WORKFLOW_TOKEN is not configured",
            },
            503
        );
    }

    const supplied = getWorkflowToken(request, body);

    if (!supplied || supplied !== configured) {
        return jsonResponse(
            {
                ok: false,
                code: "UNAUTHORIZED",
                message: "Invalid workflow token",
            },
            401
        );
    }

    return null;
}

async function parseWorkflowBody(
    request: Request
): Promise<WorkflowRequestBody | Response> {
    if (request.method !== "POST") {
        return jsonResponse(
            { ok: false, message: "Method not allowed" },
            405
        );
    }

    let value: unknown;

    try {
        value = await request.json();
    } catch {
        return jsonResponse(
            { ok: false, message: "Invalid JSON" },
            400
        );
    }

    return isWorkflowRequestBody(value)
        ? value
        : jsonResponse(
              { ok: false, message: "Invalid request body" },
              400
          );
}

function productionRecordId(body: WorkflowRequestBody): string {
    const fields = asRecord(body.fields);

    return firstText(
        body.production_record_id,
        body.productionRecordId,
        body.record_id,
        fields.production_record_id,
        fields.productionRecordId,
        fields.record_id
    );
}

function actualQuantity(body: WorkflowRequestBody): number {
    const fields = asRecord(body.fields);
    const raw =
        body.actual_qty ??
        body.actualQty ??
        fields.actual_qty ??
        fields.actualQty;
    const parsed = Number(raw);

    return Number.isFinite(parsed) ? parsed : 0;
}

function idempotencyKey(
    request: Request,
    body: WorkflowRequestBody,
    fallback: string
): string {
    return firstText(
        request.headers.get("Idempotency-Key"),
        body.idempotency_key,
        body.idempotencyKey,
        fallback
    );
}

export async function handlePcOrderSyncWorkflow(
    request: Request,
    env: Env
): Promise<Response> {
    const parsed = await parseWorkflowBody(request);
    if (parsed instanceof Response) return parsed;
    const unauthorized = authorizeWorkflow(request, env, parsed);
    if (unauthorized) return unauthorized;

    const orderRecordId = getOrderRecordId(parsed);

    if (!orderRecordId) {
        return jsonResponse(
            {
                ok: false,
                code: "ORDER_RECORD_ID_REQUIRED",
                message: "กรุณาระบุ order_record_id",
            },
            400
        );
    }

    await enqueuePcOrderSync(env, {
        order_record_id: orderRecordId,
        source: "lark_workflow",
        event_id: idempotencyKey(
            request,
            parsed,
            `pc:lark:order:${orderRecordId}:${Date.now()}`
        ),
        mark_queued: true,
    });

    return jsonResponse(
        {
            ok: true,
            status: "queued",
            order_record_id: orderRecordId,
        },
        202
    );
}

export async function handlePcMaterialRefreshWorkflow(
    request: Request,
    env: Env
): Promise<Response> {
    const parsed = await parseWorkflowBody(request);
    if (parsed instanceof Response) return parsed;
    const unauthorized = authorizeWorkflow(request, env, parsed);
    if (unauthorized) return unauthorized;

    await enqueuePcMaterialRefresh(env, {
        event_id: idempotencyKey(
            request,
            parsed,
            `pc:lark:material-refresh:${Date.now()}`
        ),
        source: "lark_workflow",
    });

    return jsonResponse({ ok: true, status: "queued" }, 202);
}

export async function handlePcProductionCompleteWorkflow(
    request: Request,
    env: Env
): Promise<Response> {
    const parsed = await parseWorkflowBody(request);
    if (parsed instanceof Response) return parsed;
    const unauthorized = authorizeWorkflow(request, env, parsed);
    if (unauthorized) return unauthorized;

    const recordId = productionRecordId(parsed);
    const quantity = actualQuantity(parsed);

    if (!recordId) {
        return jsonResponse(
            {
                ok: false,
                code: "PRODUCTION_RECORD_ID_REQUIRED",
                message: "กรุณาระบุ production_record_id",
            },
            400
        );
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
        return jsonResponse(
            {
                ok: false,
                code: "ACTUAL_QTY_INVALID",
                message: "actual_qty ต้องมากกว่า 0",
            },
            400
        );
    }

    const key = idempotencyKey(
        request,
        parsed,
        `pc:lark:production:${recordId}:${quantity}`
    );
    await enqueuePcProductionComplete(env, {
        event_id: `pc:lark:production:${recordId}:${key}`,
        production_record_id: recordId,
        actual_qty: quantity,
        idempotency_key: key,
        owner: firstText(parsed.owner, asRecord(parsed.fields).owner),
        source: "lark_workflow",
    });

    return jsonResponse(
        {
            ok: true,
            status: "queued",
            production_record_id: recordId,
        },
        202
    );
}
