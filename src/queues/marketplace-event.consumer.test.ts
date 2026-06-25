import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config/env";
import type {
    QueueBatchLike,
    QueueMessageLike,
} from "./line-event.types";
import type { MarketplaceEventQueueMessage } from "./marketplace-event.types";

const { processLazadaMarketplaceEvent } = vi.hoisted(() => ({
    processLazadaMarketplaceEvent: vi.fn(),
}));

vi.mock(
    "../modules/marketplace/lazada/lazada.webhook-processor",
    () => ({ processLazadaMarketplaceEvent })
);

import { handleMarketplaceQueueBatch } from "./marketplace-event.consumer";

function queueMessage(input: {
    id: string;
    orderId?: string;
    orderStatus: string;
    receivedAt?: number;
    attempts?: number;
}): QueueMessageLike<MarketplaceEventQueueMessage> {
    const orderId = input.orderId ?? "order-1";

    return {
        id: input.id,
        timestamp: new Date(input.receivedAt ?? Date.now()),
        attempts: input.attempts ?? 1,
        body: {
            schema_version: 1,
            channel: "Lazada",
            seller_id: "seller-1",
            order_id: orderId,
            order_status: input.orderStatus,
            message_type: "0",
            received_at: input.receivedAt ?? Date.now(),
            webhook: {
                seller_id: "seller-1",
                message_type: 0,
                data: {
                    trade_order_id: orderId,
                    order_status: input.orderStatus,
                },
            },
        },
        ack: vi.fn(),
        retry: vi.fn(),
    };
}

describe("marketplace event queue consumer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("coalesces a burst of Lazada item events into one order sync", async () => {
        processLazadaMarketplaceEvent.mockResolvedValue(undefined);

        const messages = [
            queueMessage({ id: "msg-1", orderStatus: "unpaid", receivedAt: 1 }),
            queueMessage({ id: "msg-2", orderStatus: "pending", receivedAt: 2 }),
            queueMessage({ id: "msg-3", orderStatus: "pending", receivedAt: 3 }),
            queueMessage({ id: "msg-4", orderStatus: "unpaid", receivedAt: 4 }),
        ];
        const batch: QueueBatchLike<MarketplaceEventQueueMessage> = {
            queue: "crm-marketplace-events",
            messages,
        };

        await handleMarketplaceQueueBatch(batch, {} as Env);

        expect(processLazadaMarketplaceEvent).toHaveBeenCalledTimes(1);
        expect(processLazadaMarketplaceEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                order_id: "order-1",
                received_at: 4,
            })
        );
        for (const message of messages) {
            expect(message.ack).toHaveBeenCalledTimes(1);
            expect(message.retry).not.toHaveBeenCalled();
        }
    });

    it("processes different Lazada orders separately", async () => {
        processLazadaMarketplaceEvent.mockResolvedValue(undefined);

        const messages = [
            queueMessage({ id: "msg-1", orderId: "order-1", orderStatus: "pending" }),
            queueMessage({ id: "msg-2", orderId: "order-2", orderStatus: "pending" }),
        ];

        await handleMarketplaceQueueBatch(
            {
                queue: "crm-marketplace-events",
                messages,
            },
            {} as Env
        );

        expect(processLazadaMarketplaceEvent).toHaveBeenCalledTimes(2);
        for (const message of messages) {
            expect(message.ack).toHaveBeenCalledTimes(1);
        }
    });

    it("retries only the latest event when a grouped order fails transiently", async () => {
        processLazadaMarketplaceEvent.mockRejectedValue(
            new Error("temporary failure")
        );
        const messages = [
            queueMessage({ id: "msg-1", orderStatus: "pending", receivedAt: 1 }),
            queueMessage({ id: "msg-2", orderStatus: "pending", receivedAt: 2 }),
        ];

        await handleMarketplaceQueueBatch(
            {
                queue: "crm-marketplace-events",
                messages,
            },
            {} as Env
        );

        expect(processLazadaMarketplaceEvent).toHaveBeenCalledTimes(1);
        expect(messages[0]?.ack).toHaveBeenCalledTimes(1);
        expect(messages[0]?.retry).not.toHaveBeenCalled();
        expect(messages[1]?.retry).toHaveBeenCalledTimes(1);
        expect(messages[1]?.ack).not.toHaveBeenCalled();
    });
});
