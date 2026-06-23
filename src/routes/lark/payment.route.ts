import type { Env } from "../../config/env";
import { verifyPayment } from "../../usecases/verify-payment.usecase";
import { jsonResponse } from "../../utils/response";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function getString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function getWorkflowToken(
    request: Request,
    body: UnknownRecord
): string {
    const authorization =
        request.headers.get("authorization")?.trim() ?? "";

    if (/^Bearer\s+/i.test(authorization)) {
        return authorization.replace(/^Bearer\s+/i, "").trim();
    }

    return (
        request.headers.get("x-lark-workflow-token")?.trim() ||
        request.headers.get("x-workflow-token")?.trim() ||
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

export async function handlePaymentVerifiedWebhook(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse(
            {
                ok: false,
                message: "Method not allowed",
            },
            405
        );
    }

    const configuredToken =
        env.LARK_WORKFLOW_TOKEN?.trim() ?? "";

    if (!configuredToken) {
        return jsonResponse(
            {
                ok: false,
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
            {
                ok: false,
                message: "Invalid JSON",
            },
            400
        );
    }

    if (!isRecord(body)) {
        return jsonResponse(
            {
                ok: false,
                message: "Invalid request body",
            },
            400
        );
    }

    const workflowToken = getWorkflowToken(request, body);

    if (!workflowToken || workflowToken !== configuredToken) {
        return jsonResponse(
            {
                ok: false,
                message: "Invalid workflow token",
            },
            401
        );
    }

    const orderRecordId = getOrderRecordId(body);

    if (!orderRecordId) {
        return jsonResponse(
            {
                ok: false,
                message: "กรุณาระบุ order_record_id",
            },
            400
        );
    }

    const result = await verifyPayment(env, {
        order_record_id: orderRecordId,
    });

    return jsonResponse(
        {
            ok: result.ok,
            result,
        },
        result.ok ? 200 : 400
    );
}

export async function handleVerifyPaymentTest(
    request: Request,
    env: Env
): Promise<Response> {
    const url = new URL(request.url);

    const orderRecordId =
        url.searchParams
            .get("order_record_id")
            ?.trim() ?? "";

    if (!orderRecordId) {
        return jsonResponse(
            {
                ok: false,
                message:
                    "กรุณาระบุ order_record_id",
                example:
                    "/payment/verify-test?order_record_id=recxxxxxxxx",
            },
            400
        );
    }

    const result = await verifyPayment(env, {
        order_record_id: orderRecordId,
    });

    return jsonResponse(
        {
            ok: result.ok,
            result,
        },
        result.ok ? 200 : 400
    );
}
