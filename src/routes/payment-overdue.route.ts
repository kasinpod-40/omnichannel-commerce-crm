import type { Env } from "../config/env";
import {
    markOrderPaymentOverdue,
    runPaymentOverdueSweep,
} from "../modules/payments/payment-overdue.service";
import { jsonResponse } from "../utils/response";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function getString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function getBearerToken(request: Request): string {
    const authorization =
        request.headers.get("Authorization") ?? "";

    return /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : request.headers
              .get("X-Admin-Token")
              ?.trim() ?? "";
}

function getWorkflowToken(
    request: Request,
    body: UnknownRecord
): string {
    const authorization =
        request.headers.get("Authorization")?.trim() ?? "";

    if (/^Bearer\s+/i.test(authorization)) {
        return authorization.replace(/^Bearer\s+/i, "").trim();
    }

    return (
        request.headers.get("X-Lark-Workflow-Token")?.trim() ||
        request.headers.get("X-Workflow-Token")?.trim() ||
        getString(body.token) ||
        getString(body.workflow_token)
    );
}

function getOrderRecordId(body: UnknownRecord): string {
    const direct =
        getString(body.order_record_id) ||
        getString(body.orderRecordId) ||
        getString(body.record_id);

    if (direct) {
        return direct;
    }

    if (isRecord(body.fields)) {
        return (
            getString(body.fields.order_record_id) ||
            getString(body.fields.orderRecordId) ||
            getString(body.fields.record_id)
        );
    }

    return "";
}

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

    if (!isRecord(body)) {
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

    const configuredToken =
        env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "";

    if (
        !configuredToken ||
        getBearerToken(request) !== configuredToken
    ) {
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
