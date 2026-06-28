import type { Env } from "../../config/env";
import { verifyPayment } from "../../usecases/verify-payment.usecase";
import { jsonResponse } from "../../utils/response";
import {
    getOrderRecordId,
    getWorkflowToken,
    isWorkflowRequestBody,
} from "./workflow-request";

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

    if (!isWorkflowRequestBody(body)) {
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
