import type { Env } from "../config/env";
import { processLazadaMarketplaceEvent } from "../modules/marketplace/lazada/lazada.webhook-processor";
import {
    completePcProduction,
    markPcProductionBlocked,
    reconcileOrderInventory,
    refreshPcMaterialPlan,
} from "../modules/production-control/pc.service";
import { classifyOperationalError } from "../utils/errors";
import type {
    QueueBatchLike,
    QueueMessageLike,
} from "./line-event.types";
import {
    isPcInventoryQueueMessage,
    type LazadaMarketplaceQueueMessage,
    type MarketplaceEventQueueMessage,
    type PcInventoryQueueMessage,
} from "./marketplace-event.types";

type MarketplaceMessage = QueueMessageLike<MarketplaceEventQueueMessage>;
type LazadaMessage = QueueMessageLike<LazadaMarketplaceQueueMessage>;
type PcMessage = QueueMessageLike<PcInventoryQueueMessage>;

type MarketplaceOrderGroup = {
    selected: LazadaMessage;
    messages: LazadaMessage[];
};

function isLazadaMessage(message: MarketplaceMessage): message is LazadaMessage {
    return !isPcInventoryQueueMessage(message.body);
}

function marketplaceOrderKey(message: LazadaMessage): string {
    return [
        message.body.channel,
        message.body.seller_id,
        message.body.order_id,
    ].join(":");
}

function groupMarketplaceMessages(
    messages: LazadaMessage[]
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

        if (
            message.body.received_at > current.selected.body.received_at ||
            (message.body.received_at === current.selected.body.received_at &&
                message.timestamp.getTime() >=
                    current.selected.timestamp.getTime())
        ) {
            current.selected = message;
        }
    }

    return [...groups.values()];
}

function retryDelaySeconds(attempts: number): number {
    return Math.min(30 * Math.max(attempts, 1), 300);
}

function handlePermanentOrRetry(
    message: MarketplaceMessage,
    error: unknown,
    context: Record<string, unknown>
): void {
    const classification = classifyOperationalError(error);

    console.error(
        classification.retryable
            ? "MARKETPLACE_QUEUE_TRANSIENT_FAILURE"
            : "MARKETPLACE_QUEUE_PERMANENT_FAILURE",
        {
            queue_message_id: message.id,
            attempts: message.attempts,
            ...context,
            code: classification.code,
            retryable: classification.retryable,
            status: classification.status,
            error: classification.message,
        }
    );

    if (classification.retryable) {
        message.retry({
            delaySeconds: retryDelaySeconds(message.attempts),
        });
    } else {
        message.ack();
    }
}

async function processPcMessage(
    message: PcMessage,
    env: Env
): Promise<void> {
    const body = message.body;

    if (body.kind === "pc_order_sync") {
        await reconcileOrderInventory(env, body.order_record_id);
        return;
    }

    if (body.kind === "pc_production_complete") {
        await completePcProduction(env, {
            production_record_id: body.production_record_id,
            actual_qty: body.actual_qty,
            idempotency_key: body.idempotency_key,
            owner: body.owner,
        });
        return;
    }

    await refreshPcMaterialPlan(env);
}

async function handlePcMessages(
    messages: PcMessage[],
    env: Env
): Promise<void> {
    for (const message of messages) {
        try {
            await processPcMessage(message, env);
            message.ack();
        } catch (error) {
            const classification = classifyOperationalError(error);

            if (
                !classification.retryable &&
                classification.code !== "PC_INVENTORY_DISABLED" &&
                message.body.kind === "pc_production_complete"
            ) {
                try {
                    await markPcProductionBlocked(env, {
                        production_record_id:
                            message.body.production_record_id,
                        code: classification.code,
                        message: classification.message,
                    });
                } catch (markError) {
                    console.error("PC_PRODUCTION_BLOCK_MARK_FAILED", {
                        production_record_id:
                            message.body.production_record_id,
                        error:
                            markError instanceof Error
                                ? markError.message
                                : String(markError),
                    });
                }
            }

            handlePermanentOrRetry(message, error, {
                subsystem: "production_control",
                kind: message.body.kind,
                event_id: message.body.event_id,
                order_record_id:
                    message.body.kind === "pc_order_sync"
                        ? message.body.order_record_id
                        : undefined,
                production_record_id:
                    message.body.kind === "pc_production_complete"
                        ? message.body.production_record_id
                        : undefined,
            });
        }
    }
}

async function handleLazadaMessages(
    messages: LazadaMessage[],
    env: Env
): Promise<void> {
    const groups = groupMarketplaceMessages(messages);

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
                    channel: selected.body.channel,
                    seller_id: selected.body.seller_id,
                    order_id: selected.body.order_id,
                    message_type: selected.body.message_type,
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

            for (const message of group.messages) {
                if (message.id !== selected.id) {
                    message.ack();
                }
            }

            selected.retry({
                delaySeconds: retryDelaySeconds(selected.attempts),
            });
        }
    }
}

/**
 * Marketplace และ PC ใช้ Queue เดียวกันแบบ max_concurrency=1
 * เพื่อ serialize การแก้ Order/Product/Material stock และลด lost-update ระหว่าง Worker isolates
 */
export async function handleMarketplaceQueueBatch(
    batch: QueueBatchLike<MarketplaceEventQueueMessage>,
    env: Env
): Promise<void> {
    const lazadaMessages = batch.messages.filter(isLazadaMessage);
    const pcMessages = batch.messages.filter(
        (message): message is PcMessage =>
            isPcInventoryQueueMessage(message.body)
    );

    await handleLazadaMessages(lazadaMessages, env);
    await handlePcMessages(pcMessages, env);
}
