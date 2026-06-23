import type { Env } from "../../config/env";

/** Extracts the admin bearer token while preserving X-Admin-Token compatibility. */
export function getAdminToken(request: Request): string {
    const authorization = request.headers.get("Authorization") ?? "";

    return /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : request.headers.get("X-Admin-Token")?.trim() ?? "";
}

/** Uses the existing notification dispatch secret as the admin API token. */
export function isAdminAuthorized(request: Request, env: Env): boolean {
    const configured = env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "";
    return Boolean(configured && getAdminToken(request) === configured);
}
