import { jsonResponse } from "../utils/response";

export function handleHealthRoute(env: { ENVIRONMENT?: string }): Response {
    return jsonResponse({
        ok: true,
        service: "omnichannel-commerce-crm",
        version: "demo-shop-production-badge-th-62",
        environment: env.ENVIRONMENT ?? "local",
        timestamp: new Date().toISOString(),
    });
}
