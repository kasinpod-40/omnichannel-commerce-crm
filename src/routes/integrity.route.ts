import type { Env } from "../config/env";
import { auditAndRepairCustomerIntegrity } from "../modules/maintenance/customer-integrity.service";
import { jsonResponse } from "../utils/response";

function getBearerToken(request: Request): string {
    const authorization =
        request.headers.get("Authorization") ?? "";

    return /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : request.headers
              .get("X-Admin-Token")
              ?.trim() ?? "";
}

export async function handleCustomerIntegrity(
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
            ? (body as Record<string, unknown>)
            : {};
    const customerRecordId =
        typeof record.customer_record_id === "string"
            ? record.customer_record_id.trim()
            : "";
    const repair = record.repair === true;

    if (!customerRecordId) {
        return jsonResponse(
            {
                ok: false,
                message:
                    "กรุณาระบุ customer_record_id",
            },
            400
        );
    }

    const result =
        await auditAndRepairCustomerIntegrity(
            env,
            customerRecordId,
            repair
        );

    return jsonResponse({
        ok: result.ok,
        result,
    });
}
