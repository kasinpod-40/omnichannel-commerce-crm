import type { Env } from "../../../config/env";
import { adaptLazadaThailand } from "../../../modules/marketplace/adapters/lazada.adapter";
import { verifyLazadaWebhookSignature } from "../../../modules/marketplace/lazada/lazada.crypto";
import { resolveLazadaCredential } from "../../../modules/marketplace/lazada/lazada.token-store";
import type { LazadaWebhookEnvelope } from "../../../modules/marketplace/lazada/lazada.types";
import { upsertMarketplaceOrder } from "../../../modules/marketplace/marketplace.service";
import { jsonResponse } from "../../../utils/response";
import { firstText } from "../../shared/value";
import { extractWebhookIdentity, fetchLazadaOrderBundle } from "./live.shared";

type LazadaWebhookContext = Pick<ExecutionContext, "waitUntil">;

function isLazadaVerificationProbe(identity: {
    sellerId: string;
    orderId: string;
    messageType: string;
}): boolean {
    return (
        identity.sellerId === "9999" &&
        identity.orderId === "123456" &&
        identity.messageType === "0"
    );
}

async function processLazadaWebhookEvent(input: {
    env: Env;
    webhook: LazadaWebhookEnvelope;
    identity: ReturnType<typeof extractWebhookIdentity>;
}): Promise<void> {
    try {
        const credential = await resolveLazadaCredential(input.env, {
            sellerId: input.identity.sellerId,
        });

        if (!credential) {
            throw new Error(
                `LAZADA_SELLER_CREDENTIAL_NOT_FOUND:${input.identity.sellerId || "unknown"}`
            );
        }

        const bundle = await fetchLazadaOrderBundle(
            input.env,
            credential,
            input.identity.orderId
        );
        const adapted = adaptLazadaThailand({
            webhook: input.webhook,
            order_detail_response: bundle.orderDetail,
            order_items_response: bundle.orderItems,
            store_name: credential.account || `Lazada ${credential.seller_id}`,
        });
        const result = await upsertMarketplaceOrder(
            input.env,
            adapted.normalized
        );

        console.log("LAZADA_WEBHOOK_PROCESS_COMPLETED", {
            seller_id: input.identity.sellerId,
            order_id: input.identity.orderId,
            message_type: input.identity.messageType,
            order_status: input.identity.orderStatus,
            result,
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error("LAZADA_WEBHOOK_PROCESS_FAILED", {
            seller_id: input.identity.sellerId,
            order_id: input.identity.orderId,
            message_type: input.identity.messageType,
            error: message,
        });
    }
}

export async function handleLazadaWebhook(
    request: Request,
    env: Env,
    context?: LazadaWebhookContext
): Promise<Response> {
    if (request.method === "GET") {
        return jsonResponse({
            ok: true,
            service: "lazada-webhook",
            region: "TH",
        });
    }

    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    const rawBody = await request.text();
    const configuredAppKey = env.LAZADA_APP_KEY?.trim() ?? "";
    const configuredAppSecret = env.LAZADA_APP_SECRET?.trim() ?? "";

    if (!configuredAppKey || !configuredAppSecret) {
        return jsonResponse(
            {
                ok: false,
                code: !configuredAppKey
                    ? "LAZADA_APP_KEY_NOT_CONFIGURED"
                    : "LAZADA_APP_SECRET_NOT_CONFIGURED",
            },
            503
        );
    }

    const signatureHeader = firstText(
        request.headers.get("Authorization"),
        request.headers.get("X-Lazada-Signature"),
        request.headers.get("X-Lazop-Signature")
    );
    const signatureValid = await verifyLazadaWebhookSignature({
        appKey: configuredAppKey,
        appSecret: configuredAppSecret,
        rawBody,
        authorizationHeader: signatureHeader,
    });

    if (!signatureValid) {
        return jsonResponse(
            { ok: false, code: "LAZADA_WEBHOOK_SIGNATURE_INVALID" },
            401
        );
    }

    let webhook: LazadaWebhookEnvelope;

    try {
        webhook = JSON.parse(rawBody) as LazadaWebhookEnvelope;
    } catch {
        return jsonResponse({ ok: false, code: "INVALID_JSON" }, 400);
    }

    const identity = extractWebhookIdentity(webhook);

    // Lazada sends a signed synthetic order during Push Mechanism verification.
    // It must be acknowledged without trying to load a real seller credential.
    if (isLazadaVerificationProbe(identity)) {
        console.log("LAZADA_WEBHOOK_VERIFICATION_ACCEPTED", {
            seller_id: identity.sellerId,
            order_id: identity.orderId,
            message_type: identity.messageType,
        });

        return jsonResponse({
            ok: true,
            verified: true,
            service: "lazada-webhook",
        });
    }

    if (!identity.orderId) {
        return jsonResponse({
            ok: true,
            ignored: true,
            reason: "EVENT_HAS_NO_TRADE_ORDER_ID",
            message_type: identity.messageType,
        });
    }

    const processing = processLazadaWebhookEvent({
        env,
        webhook,
        identity,
    });

    if (context) {
        context.waitUntil(processing);

        return jsonResponse({
            ok: true,
            accepted: true,
            message_type: identity.messageType,
            order_id: identity.orderId,
            order_status: identity.orderStatus,
        });
    }

    await processing;

    return jsonResponse({
        ok: true,
        accepted: true,
        processed: true,
        message_type: identity.messageType,
        order_id: identity.orderId,
        order_status: identity.orderStatus,
    });
}

