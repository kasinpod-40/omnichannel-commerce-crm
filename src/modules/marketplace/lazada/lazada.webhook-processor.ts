import type { Env } from "../../../config/env";
import type { MarketplaceEventQueueMessage } from "../../../queues/marketplace-event.types";
import {
    asRecord,
    firstText,
    text,
} from "../adapters/adapter.utils";
import { adaptLazadaThailand } from "../adapters/lazada.adapter";
import { upsertMarketplaceOrder } from "../marketplace.service";
import { resolveLazadaCredential } from "./lazada.token-store";
import { fetchLazadaOrderBundle } from "./lazada.order-bundle";

/**
 * อ่าน Order Object จาก Response ของ Lazada โดยรองรับ Shape ที่ API ส่งกลับได้หลายแบบ
 */
function extractOrderRecord(value: unknown): Record<string, unknown> {
    const root = asRecord(value);
    const data = asRecord(root.data);
    const candidates = [
        data.order,
        data.orders,
        root.order,
        root.orders,
        data,
        root,
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            const first = asRecord(candidate[0]);

            if (Object.keys(first).length > 0) {
                return first;
            }
        }

        const record = asRecord(candidate);

        if (Object.keys(record).length > 0) {
            return record;
        }
    }

    return {};
}

/**
 * ใช้สถานะล่าสุดจาก GetOrder ของ Lazada เป็นแหล่งข้อมูลหลัก
 * Webhook มีหน้าที่บอกว่ามีการเปลี่ยนแปลง แต่ Lazada อาจยิงหลาย Item Event ที่สถานะไม่ตรงกัน
 */
function authoritativeOrderState(orderDetail: unknown): {
    status: string;
    updatedAt: string | number;
} {
    const order = extractOrderRecord(orderDetail);
    const statuses = Array.isArray(order.statuses)
        ? order.statuses.map(text).filter(Boolean)
        : [];

    return {
        status: firstText(statuses[0], order.status),
        updatedAt: firstText(
            order.updated_at,
            order.update_time,
            order.created_at,
            order.create_time,
            Date.now()
        ),
    };
}

/**
 * ประมวลผล Lazada Webhook หลังออกจาก Queue แล้ว
 * ลำดับคือหา Credential → ดึง Order ล่าสุด → ใช้สถานะจาก Order API → Upsert เข้า CRM
 */
export async function processLazadaMarketplaceEvent(
    env: Env,
    event: MarketplaceEventQueueMessage
): Promise<void> {
    if (event.channel !== "Lazada") {
        throw new Error(
            `MARKETPLACE_QUEUE_CHANNEL_NOT_SUPPORTED:${event.channel}`
        );
    }

    const credential = await resolveLazadaCredential(env, {
        sellerId: event.seller_id,
    });

    if (!credential) {
        throw new Error(
            `LAZADA_SELLER_CREDENTIAL_NOT_FOUND:${event.seller_id || "unknown"}`
        );
    }

    const bundle = await fetchLazadaOrderBundle(
        env,
        credential,
        event.order_id
    );
    const latest = authoritativeOrderState(bundle.orderDetail);
    const originalData = asRecord(event.webhook.data);
    const authoritativeWebhook = {
        ...event.webhook,
        data: {
            ...originalData,
            order_status: latest.status || event.order_status,
            status_update_time: latest.updatedAt,
        },
    };
    const adapted = adaptLazadaThailand({
        webhook: authoritativeWebhook,
        order_detail_response: bundle.orderDetail,
        order_items_response: bundle.orderItems,
        store_name:
            credential.account ||
            `Lazada ${credential.seller_id}`,
    });
    const result = await upsertMarketplaceOrder(
        env,
        adapted.normalized
    );

    console.log("LAZADA_WEBHOOK_PROCESS_COMPLETED", {
        seller_id: event.seller_id,
        order_id: event.order_id,
        message_type: event.message_type,
        webhook_order_status: event.order_status,
        authoritative_order_status:
            adapted.normalized.marketplace_status,
        result,
    });
}
