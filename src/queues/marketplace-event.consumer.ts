import type { Env } from "../config/env";
import { processLazadaMarketplaceEvent } from "../modules/marketplace/lazada/lazada.webhook-processor";
import { classifyOperationalError } from "../utils/errors";
import type {
    QueueBatchLike,
    QueueMessageLike,
} from "./line-event.types";
import type { MarketplaceEventQueueMessage } from "./marketplace-event.types";

type MarketplaceMessage = QueueMessageLike<MarketplaceEventQueueMessage>;

type MarketplaceOrderGroup = {
    selected: MarketplaceMessage;
    messages: MarketplaceMessage[];
};

/**
 * สร้าง Key ระดับร้านและ Order เพื่อรวม Webhook หลายรายการที่ Lazada ยิงมาพร้อมกัน
 * Lazada อาจยิงหนึ่ง Event ต่อ Order Item แต่ระบบ CRM ต้อง Sync เพียงหนึ่งครั้งต่อ Order
 */
function marketplaceOrderKey(message: MarketplaceMessage): string {
    return [
        message.body.channel,
        message.body.seller_id,
        message.body.order_id,
    ].join(":");
}

/**
 * เลือก Event ล่าสุดของ Order เดียวกันมาเป็นตัวกระตุ้นการ Sync
 * ตัวประมวลผลจะดึง Order ล่าสุดจาก Lazada API อีกครั้ง จึงไม่ต้องประมวลผลทุก Item Event
 */
function groupMarketplaceMessages(
    messages: MarketplaceMessage[]
): MarketplaceOrderGroup[] {
    const groups = new Map<string, MarketplaceOrderGroup>();

    for (const message of messages) {
        const key = marketplaceOrderKey(message);
        const current = groups.get(key);

        if (!current) {
            groups.set(key, {
                selected: message,
                messages: [message],
            });
            continue;
        }

        current.messages.push(message);

        const selectedReceivedAt = current.selected.body.received_at;
        const candidateReceivedAt = message.body.received_at;

        if (
            candidateReceivedAt > selectedReceivedAt ||
            (candidateReceivedAt === selectedReceivedAt &&
                message.timestamp.getTime() >=
                    current.selected.timestamp.getTime())
        ) {
            current.selected = message;
        }
    }

    return [...groups.values()];
}

/**
 * รับ Marketplace Event จาก Queue แล้วรวม Event ที่เป็น Order เดียวกันก่อนประมวลผล
 * หน้า Webhook เรียก Queue Producer จาก routes/marketplace/lazada/webhook.route.ts
 * จากนั้น runtime/queue.ts จะส่ง Batch มาที่ฟังก์ชันนี้
 */
export async function handleMarketplaceQueueBatch(
    batch: QueueBatchLike<MarketplaceEventQueueMessage>,
    env: Env
): Promise<void> {
    const groups = groupMarketplaceMessages(batch.messages);

    for (const group of groups) {
        const selected = group.selected;

        try {
            await processLazadaMarketplaceEvent(env, selected.body);

            for (const message of group.messages) {
                message.ack();
            }
        } catch (error) {
            const classification = classifyOperationalError(error);

            console.error(
                classification.retryable
                    ? "MARKETPLACE_QUEUE_TRANSIENT_FAILURE"
                    : "MARKETPLACE_QUEUE_PERMANENT_FAILURE",
                {
                    queue_message_id: selected.id,
                    grouped_message_count: group.messages.length,
                    attempts: selected.attempts,
                    channel: selected.body?.channel,
                    seller_id: selected.body?.seller_id,
                    order_id: selected.body?.order_id,
                    message_type: selected.body?.message_type,
                    code: classification.code,
                    retryable: classification.retryable,
                    status: classification.status,
                    error: classification.message,
                }
            );

            if (!classification.retryable) {
                for (const message of group.messages) {
                    message.ack();
                }
                continue;
            }

            /*
             * เมื่อ Event ซ้ำของ Order เดียวกันล้มเหลว ให้ Retry เพียงตัวล่าสุดหนึ่งรายการ
             * และ Ack ตัวซ้ำที่เหลือ เพื่อไม่ให้ Queue ยิง Order เดิมกลับมาหลายครั้งอีก
             */
            for (const message of group.messages) {
                if (message.id !== selected.id) {
                    message.ack();
                }
            }

            selected.retry({
                delaySeconds: Math.min(
                    30 * Math.max(selected.attempts, 1),
                    300
                ),
            });
        }
    }
}
