import type { Env } from "../../../config/env";
import { verifyLazadaWebhookSignature } from "../../../modules/marketplace/lazada/lazada.crypto";
import type { LazadaWebhookEnvelope } from "../../../modules/marketplace/lazada/lazada.types";
import { jsonResponse } from "../../../utils/response";
import { firstText } from "../../shared/value";
import { enqueueMarketplaceEvent } from "../../../queues/marketplace-event.producer";
import { extractWebhookIdentity } from "./live.shared";

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

export async function handleLazadaWebhook(
    request: Request,
    env: Env,
    _context?: LazadaWebhookContext
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

    // Lazada ส่ง Order จำลองที่มี Signature มาใช้ตรวจสอบ Push Mechanism
    // ต้องตอบรับทันทีโดยไม่พยายามค้นหา Credential ของร้านจริง
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

    /*
     * Lazada อาจส่งหลาย Event ของ Order เดียวกันเข้ามาพร้อมกัน
     * จึงรับ Webhook แล้วส่งเข้า Queue ก่อน เพื่อให้ประมวลผลเรียงทีละรายการ
     * และตอบกลับ Lazada ให้เร็วโดยไม่รอการดึง Order API กับการเขียน Lark
     */
    await enqueueMarketplaceEvent(env, {
        schema_version: 1,
        channel: "Lazada",
        seller_id: identity.sellerId,
        order_id: identity.orderId,
        order_status: identity.orderStatus,
        message_type: identity.messageType,
        received_at: Date.now(),
        webhook,
    });

    return jsonResponse({
        ok: true,
        accepted: true,
        queued: true,
        message_type: identity.messageType,
        order_id: identity.orderId,
        order_status: identity.orderStatus,
    });
}

