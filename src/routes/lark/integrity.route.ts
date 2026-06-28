import type { Env } from "../../config/env";
import { auditAndRepairCustomerIntegrity } from "../../modules/maintenance/customer-integrity.service";
import { jsonResponse } from "../../utils/response";
import { isAdminAuthorized } from "../shared/admin-auth";

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
