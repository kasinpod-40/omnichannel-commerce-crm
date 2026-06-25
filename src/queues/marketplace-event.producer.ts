import type { Env } from "../config/env";
import type { MarketplaceEventQueueMessage } from "./marketplace-event.types";

/**
 * ส่งเหตุการณ์ Marketplace เข้า Queue เพื่อให้ประมวลผลเรียงลำดับ
 * ป้องกันหลาย Webhook ของ Order เดียวกันแก้ Order และสร้าง Notification พร้อมกัน
 */
export async function enqueueMarketplaceEvent(
    env: Env,
    event: MarketplaceEventQueueMessage
): Promise<void> {
    await env.MARKETPLACE_EVENTS_QUEUE.send(event, {
        contentType: "json",
    });
}
