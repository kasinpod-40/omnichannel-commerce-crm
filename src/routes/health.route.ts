import { jsonResponse } from "../utils/response";

export function handleHealthRoute(env: { ENVIRONMENT?: string }): Response {
    return jsonResponse({
        ok: true,
        service: "omnichannel-commerce-crm",
        version: "pc-description-script-guard-th-71",
        environment: env.ENVIRONMENT ?? "local",
        timestamp: new Date().toISOString(),
    });
}
