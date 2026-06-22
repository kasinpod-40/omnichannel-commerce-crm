import type { Env } from "../config/env";
import { buildDashboardSummary } from "../modules/dashboard/dashboard.service";
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

    const result = await buildDashboardSummary(env);

    return jsonResponse({ ok: true, result });
}
