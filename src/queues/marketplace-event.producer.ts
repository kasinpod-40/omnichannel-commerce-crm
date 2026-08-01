import type { Env } from "../config/env";
import { updateOrderPcStatus } from "../modules/production-control/pc.repository";
import type {
    MarketplaceEventQueueMessage,
    PcInventoryQueueMessage,
} from "./marketplace-event.types";

/**
 * ส่งเหตุการณ์ Marketplace/PC เข้า Queue เดียวกันเพื่อให้การแก้ Stock เรียงลำดับ
 * Queue crm-marketplace-events กำหนด max_concurrency=1 อยู่แล้ว
 */
export async function enqueueMarketplaceEvent(
    env: Env,
    event: MarketplaceEventQueueMessage
): Promise<void> {
    await env.MARKETPLACE_EVENTS_QUEUE.send(event, {
        contentType: "json",
    });
}

export async function enqueuePcOrderSync(
    env: Env,
    input: {
        order_record_id: string;
        source: Extract<
            PcInventoryQueueMessage,
            { kind: "pc_order_sync" }
        >["source"];
        event_id?: string;
        mark_queued?: boolean;
    }
): Promise<void> {
    const event: PcInventoryQueueMessage = {
        schema_version: 1,
        kind: "pc_order_sync",
        event_id:
            input.event_id?.trim() ||
            `pc:order:${input.order_record_id}:${Date.now()}`,
        order_record_id: input.order_record_id,
        requested_at: Date.now(),
        source: input.source,
    };

    await enqueueMarketplaceEvent(env, event);

    if (input.mark_queued === true) {
        try {
            await updateOrderPcStatus(
                env,
                input.order_record_id,
                "QUEUED"
            );
        } catch (error) {
            console.warn("PC_ORDER_QUEUE_STATUS_WRITE_FAILED", {
                order_record_id: input.order_record_id,
                event_id: event.event_id,
                error:
                    error instanceof Error
                        ? error.message
                        : String(error),
            });
        }
    }
}

/**
 * ใช้หลัง Business write สำเร็จแล้ว เพื่อไม่ให้ Queue outage ย้อนกลับไปทำให้
 * Payment/Marketplace/Order API ตอบล้มเหลวทั้งที่ข้อมูลหลักถูกบันทึกแล้ว
 * Dashboard manual reconcile ยังใช้ enqueuePcOrderSync โดยตรงและ fail closed ตามเดิม
 */
export async function enqueuePcOrderSyncAfterBusinessWrite(
    env: Env,
    input: Parameters<typeof enqueuePcOrderSync>[1]
): Promise<boolean> {
    try {
        await enqueuePcOrderSync(env, input);
        return true;
    } catch (error) {
        console.error("PC_ORDER_ENQUEUE_AFTER_WRITE_FAILED", {
            order_record_id: input.order_record_id,
            source: input.source,
            event_id: input.event_id ?? "",
            error:
                error instanceof Error
                    ? error.message
                    : String(error),
        });

        try {
            await updateOrderPcStatus(env, input.order_record_id, "BLOCKED");
        } catch (statusError) {
            console.error("PC_ORDER_ENQUEUE_BLOCKED_STATUS_FAILED", {
                order_record_id: input.order_record_id,
                error:
                    statusError instanceof Error
                        ? statusError.message
                        : String(statusError),
            });
        }

        return false;
    }
}

export async function enqueuePcOrderSyncBatch(
    env: Env,
    orderRecordIds: string[],
    source: Extract<
        PcInventoryQueueMessage,
        { kind: "pc_order_sync" }
    >["source"] = "reconcile"
): Promise<number> {
    const uniqueIds = [...new Set(orderRecordIds.map((id) => id.trim()).filter(Boolean))];
    const events: PcInventoryQueueMessage[] = uniqueIds.map(
        (orderRecordId, index) => ({
            schema_version: 1,
            kind: "pc_order_sync",
            event_id: `pc:reconcile:${Date.now()}:${index}:${orderRecordId}`,
            order_record_id: orderRecordId,
            requested_at: Date.now(),
            source,
        })
    );

    if (events.length === 0) {
        return 0;
    }

    if (env.MARKETPLACE_EVENTS_QUEUE.sendBatch) {
        for (let index = 0; index < events.length; index += 100) {
            await env.MARKETPLACE_EVENTS_QUEUE.sendBatch(
                events.slice(index, index + 100).map((body) => ({
                    body,
                    contentType: "json",
                }))
            );
        }
    } else {
        for (const event of events) {
            await enqueueMarketplaceEvent(env, event);
        }
    }

    return events.length;
}

export async function enqueuePcProductionComplete(
    env: Env,
    input: Omit<
        Extract<
            PcInventoryQueueMessage,
            { kind: "pc_production_complete" }
        >,
        "schema_version" | "kind" | "requested_at"
    >
): Promise<void> {
    await enqueueMarketplaceEvent(env, {
        schema_version: 1,
        kind: "pc_production_complete",
        ...input,
        requested_at: Date.now(),
    });
}

export async function enqueuePcMaterialRefresh(
    env: Env,
    input: Omit<
        Extract<
            PcInventoryQueueMessage,
            { kind: "pc_material_refresh" }
        >,
        "schema_version" | "kind" | "requested_at"
    >
): Promise<void> {
    await enqueueMarketplaceEvent(env, {
        schema_version: 1,
        kind: "pc_material_refresh",
        ...input,
        requested_at: Date.now(),
    });
}
