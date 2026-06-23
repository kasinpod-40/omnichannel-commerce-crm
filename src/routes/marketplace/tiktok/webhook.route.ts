import type { Env } from "../../../config/env";
import { adaptTikTokThailand } from "../../../modules/marketplace/adapters/tiktok.adapter";
import { upsertMarketplaceOrder } from "../../../modules/marketplace/marketplace.service";
import { verifyTikTokWebhookSignature } from "../../../modules/marketplace/tiktok/tiktok.crypto";
import { resolveTikTokCredential } from "../../../modules/marketplace/tiktok/tiktok.token-store";
import type { TikTokWebhookEnvelope } from "../../../modules/marketplace/tiktok/tiktok.types";
import { jsonResponse } from "../../../utils/response";
import {
    extractWebhookIdentity,
    fetchTikTokOrderWithPackage,
} from "./live.shared";

export async function handleTikTokWebhook(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method === "GET") {
        return jsonResponse({
            ok: true,
            service: "tiktok-shop-webhook",
            region: "TH",
        });
    }

    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    const rawBody = await request.text();
    const authorization = request.headers.get("Authorization") ?? "";
    const appSecret = env.TIKTOK_APP_SECRET?.trim() ?? "";

    if (!appSecret) {
        return jsonResponse(
            { ok: false, code: "TIKTOK_APP_SECRET_NOT_CONFIGURED" },
            503
        );
    }

    const signatureValid = await verifyTikTokWebhookSignature({
        appSecret,
        rawBody,
        authorizationHeader: authorization,
    });

    if (!signatureValid) {
        return jsonResponse(
            { ok: false, code: "TIKTOK_WEBHOOK_SIGNATURE_INVALID" },
            401
        );
    }

    let webhook: TikTokWebhookEnvelope;

    try {
        webhook = JSON.parse(rawBody) as TikTokWebhookEnvelope;
    } catch {
        return jsonResponse({ ok: false, code: "INVALID_JSON" }, 400);
    }

    if (webhook.challenge) {
        return jsonResponse({ challenge: webhook.challenge });
    }

    const identity = extractWebhookIdentity(webhook);

    if (!identity.orderId) {
        return jsonResponse({
            ok: true,
            ignored: true,
            reason: "EVENT_HAS_NO_ORDER_ID",
            event: identity.eventName,
        });
    }

    try {
        const credential = await resolveTikTokCredential(env, {
            shopCipher: identity.shopCipher,
            shopId: identity.shopId,
        });

        if (!credential) {
            throw new Error(
                `TIKTOK_SHOP_CREDENTIAL_NOT_FOUND:${identity.shopId || identity.shopCipher || "unknown"}`
            );
        }

        const orderDetail = await fetchTikTokOrderWithPackage(
            env,
            credential,
            identity.orderId
        );
        const adapted = adaptTikTokThailand({
            webhook,
            order_detail_response: orderDetail,
            store_name: credential.shop_name,
        });
        const result = await upsertMarketplaceOrder(
            env,
            adapted.normalized
        );

        return jsonResponse({
            ok: true,
            event: identity.eventName,
            order_id: identity.orderId,
            result,
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error("TIKTOK_WEBHOOK_PROCESS_FAILED", {
            event: identity.eventName,
            order_id: identity.orderId,
            error: message,
        });

        return jsonResponse(
            {
                ok: false,
                code: "TIKTOK_WEBHOOK_PROCESS_FAILED",
                message,
            },
            503
        );
    }
}

