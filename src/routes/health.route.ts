import { jsonResponse } from "../utils/response";

export function handleHealthRoute(env: { ENVIRONMENT?: string }): Response {
    return jsonResponse({
        ok: true,
        service: "omnichannel-commerce-crm",
        version: "lark-payment-review-applink-th-35",
        environment: env.ENVIRONMENT ?? "local",
        timestamp: new Date().toISOString(),
    });
}