import type { Env } from "../../config/env";
import { parseMarketplaceOrderInput } from "../../modules/marketplace/marketplace-normalizer";
import { upsertMarketplaceOrder } from "../../modules/marketplace/marketplace.service";
import { jsonResponse } from "../../utils/response";

import { isAdminAuthorized } from "../shared/admin-auth";

export async function handleMarketplaceOrderUpsert(
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
            { ok: false, code: "INVALID_JSON" },
            400
        );
    }

    try {
        const input = parseMarketplaceOrderInput(body);
        const result = await upsertMarketplaceOrder(
            env,
            input
        );

        return jsonResponse({ ok: true, result });
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : String(error);
        const badRequest =
            message.startsWith("MARKETPLACE_INVALID_") ||
            message.startsWith("MARKETPLACE_MISSING_FIELDS") ||
            message === "MARKETPLACE_ITEMS_REQUIRED";

        return jsonResponse(
            {
                ok: false,
                code: badRequest
                    ? "INVALID_MARKETPLACE_ORDER"
                    : "MARKETPLACE_ORDER_UPSERT_FAILED",
                message,
            },
            badRequest ? 400 : 500
        );
    }
}
