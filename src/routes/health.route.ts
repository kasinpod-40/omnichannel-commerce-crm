import { jsonResponse } from "../utils/response";

export function handleHealthRoute(env: { ENVIRONMENT?: string }): Response {
    return jsonResponse({
        ok: true,
        service: "omnichannel-commerce-crm",
        version: "low-stock-state-read-retry-th-53",
        environment: env.ENVIRONMENT ?? "local",
        timestamp: new Date().toISOString(),
    });
}
