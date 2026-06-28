import type { Env } from "../../config/env";
import {
    markOrderPaymentOverdue,
    runPaymentOverdueSweep,
} from "../../modules/payments/payment-overdue.service";
import { jsonResponse } from "../../utils/response";
import {
    getOrderRecordId,
    getWorkflowToken,
    isWorkflowRequestBody,
} from "./workflow-request";
import { isAdminAuthorized } from "../shared/admin-auth";

export async function handlePaymentOverdueWebhook(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse(
            { ok: false, message: "Method not allowed" },
            405
        );
    }

    const configuredToken =
        env.LARK_WORKFLOW_TOKEN?.trim() ?? "";

    if (!configuredToken) {
        return jsonResponse(
            {
                ok: false,
                code: "WORKFLOW_TOKEN_NOT_CONFIGURED",
                message:
                    "LARK_WORKFLOW_TOKEN is not configured",
            },
            503
        );
    }

    let body: unknown;

    try {
        body = await request.json();
    } catch {
        return jsonResponse(
            { ok: false, message: "Invalid JSON" },
            400
        );
    }

    if (!isWorkflowRequestBody(body)) {
        return jsonResponse(
            { ok: false, message: "Invalid request body" },
            400
        );
    }

    const workflowToken = getWorkflowToken(
        request,
        body
    );

    if (
        !workflowToken ||
        workflowToken !== configuredToken
    ) {
        return jsonResponse(
            {
                ok: false,
                code: "UNAUTHORIZED",
                message: "Workflow token ไม่ถูกต้อง",
            },
            401
        );
    }

    const orderRecordId = getOrderRecordId(body);

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

    try {
        const result = await markOrderPaymentOverdue(
            env,
            orderRecordId
        );

        return jsonResponse({ ok: true, result });
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : String(error);
        const code = message.split(":")[0];
        const status =
            code === "ORDER_RECORD_NOT_FOUND"
                ? 404
                : code === "ORDER_RECORD_ID_REQUIRED"
                  ? 400
                  : 500;

        return jsonResponse(
            {
                ok: false,
                code,
                message,
            },
            status
        );
    }
}

export async function handlePaymentOverdueRun(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse(
            { ok: false, message: "Method not allowed" },
            405
        );
    }

    if (!isAdminAuthorized(request, env)) {
        return jsonResponse(
            {
                ok: false,
                code: "UNAUTHORIZED",
                message: "Admin token ไม่ถูกต้อง",
            },
            401
        );
    }

    let now = Date.now();

    try {
        const body = (await request.json()) as {
            now?: unknown;
        };

        if (
            typeof body.now === "number" &&
            Number.isFinite(body.now)
        ) {
            now = body.now;
        }
    } catch {
        // Body is optional. Use current time when absent/empty.
    }

    const result = await runPaymentOverdueSweep(
        env,
        now
    );

    return jsonResponse({ ok: true, result });
}
