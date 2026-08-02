import { jsonResponse } from "../utils/response";

export function handleHealthRoute(env: { ENVIRONMENT?: string }): Response {
    return jsonResponse({
        ok: true,
        service: "omnichannel-commerce-crm",
        version: "production-completion-shortage-th-64",
        environment: env.ENVIRONMENT ?? "local",
        timestamp: new Date().toISOString(),
    });
}
