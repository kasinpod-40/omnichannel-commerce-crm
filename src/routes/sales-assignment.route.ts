import type { Env } from "../config/env";
import { assignSalesOwner } from "../modules/sales/sales-assignment.service";
import { jsonResponse } from "../utils/response";

type UnknownRecord = Record<string, unknown>;

function getString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function getBearerToken(request: Request): string {
    const authorization =
        request.headers.get("Authorization")?.trim() ?? "";

    return /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : "";
}

function isAuthorized(request: Request, env: Env): boolean {
    const provided =
        getBearerToken(request) ||
        request.headers
            .get("X-Lark-Workflow-Token")
            ?.trim() ||
        request.headers.get("X-Admin-Token")?.trim() ||
        "";

    const allowed = [
        env.LARK_WORKFLOW_TOKEN?.trim() ?? "",
        env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "",
    ].filter(Boolean);

    return Boolean(provided && allowed.includes(provided));
}

export async function handleSalesOwnerAssignment(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse(
            { ok: false, message: "Method not allowed" },
            405
        );
    }

    if (!isAuthorized(request, env)) {
        return jsonResponse(
            {
                ok: false,
                code: "UNAUTHORIZED",
                message: "Workflow/Admin token ไม่ถูกต้อง",
            },
            401
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

    const record =
        body && typeof body === "object"
            ? (body as UnknownRecord)
            : {};
    const customerRecordId =
        getString(record.customer_record_id) ||
        getString(record.customerRecordId) ||
        getString(record.record_id);
    const salesOwner =
        getString(record.sales_owner) ||
        getString(record.salesOwner) ||
        "Unassigned";
    const eventId =
        getString(record.event_id) ||
        getString(record.eventId);

    if (!customerRecordId) {
        return jsonResponse(
            {
                ok: false,
                message: "กรุณาระบุ customer_record_id",
            },
            400
        );
    }

    try {
        const result = await assignSalesOwner(env, {
            customer_record_id: customerRecordId,
            sales_owner: salesOwner,
            event_id: eventId || undefined,
        });

        return jsonResponse({ ok: true, result });
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : String(error);
        const status = message.includes(
            "CUSTOMER_RECORD_NOT_FOUND"
        )
            ? 404
            : 409;

        return jsonResponse(
            {
                ok: false,
                code: message.split(":")[0],
                message,
            },
            status
        );
    }
}
