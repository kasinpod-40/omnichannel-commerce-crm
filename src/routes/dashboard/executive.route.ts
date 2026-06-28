import type { Env } from "../../config/env";
import { buildDashboardSummary } from "../../modules/dashboard/dashboard.service";
import { jsonResponse } from "../../utils/response";
import { isAdminAuthorized } from "../shared/admin-auth";

export async function handleDashboardSummary(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
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

    const result = await buildDashboardSummary(env);

    return jsonResponse({ ok: true, result });
}
