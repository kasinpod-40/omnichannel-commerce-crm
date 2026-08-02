import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config/env";
import { OperationalError } from "../utils/errors";
import type {
    QueueBatchLike,
    QueueMessageLike,
} from "./line-event.types";
import type { MarketplaceEventQueueMessage } from "./marketplace-event.types";

const {
    processLazadaMarketplaceEvent,
    reconcileOrderInventory,
    completePcProduction,
    refreshPcMaterialPlan,
    markPcProductionBlocked,
    notifyLowStockAfterOrderOnce,
} = vi.hoisted(() => ({
    processLazadaMarketplaceEvent: vi.fn(),
    reconcileOrderInventory: vi.fn(),
    completePcProduction: vi.fn(),
    refreshPcMaterialPlan: vi.fn(),
    markPcProductionBlocked: vi.fn(),
    notifyLowStockAfterOrderOnce: vi.fn(),
}));

vi.mock(
    "../modules/marketplace/lazada/lazada.webhook-processor",
    () => ({ processLazadaMarketplaceEvent })
);

vi.mock("../modules/production-control/pc.low-stock-alert", () => ({
    notifyLowStockAfterOrderOnce,
}));

vi.mock("../modules/production-control/pc.service", () => ({
    reconcileOrderInventory,
    completePcProduction,
    refreshPcMaterialPlan,
    markPcProductionBlocked,
}));

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

function pcQueueMessage(
    body:
        | {
              kind: "pc_order_sync";
              order_record_id: string;
          }
        | {
              kind: "pc_production_complete";
              production_record_id: string;
              actual_qty: number;
              idempotency_key: string;
          }
        | { kind: "pc_material_refresh" },
    id = `msg-${body.kind}`
): QueueMessageLike<MarketplaceEventQueueMessage> {
    const common = {
        schema_version: 1 as const,
        event_id: `event-${id}`,
        requested_at: 1,
    };
    const queueBody: MarketplaceEventQueueMessage =
        body.kind === "pc_order_sync"
            ? {
                  ...common,
                  kind: body.kind,
                  order_record_id: body.order_record_id,
                  source: "reconcile",
              }
            : body.kind === "pc_production_complete"
              ? {
                    ...common,
                    kind: body.kind,
                    production_record_id: body.production_record_id,
                    actual_qty: body.actual_qty,
                    idempotency_key: body.idempotency_key,
                    source: "dashboard",
                }
              : {
                    ...common,
                    kind: body.kind,
                    source: "reconcile",
                };

    return {
        id,
        timestamp: new Date(1),
        attempts: 1,
        body: queueBody,
        ack: vi.fn(),
        retry: vi.fn(),
    };
}

describe("marketplace event queue consumer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        notifyLowStockAfterOrderOnce.mockResolvedValue(0);
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

    it("processes PC stock messages sequentially, checks low stock and acknowledges each success", async () => {
        reconcileOrderInventory.mockResolvedValue({ status: "APPLIED" });
        completePcProduction.mockResolvedValue({ inventory_posted: true });
        refreshPcMaterialPlan.mockResolvedValue({ materials_updated: 1 });
        const order = pcQueueMessage({
            kind: "pc_order_sync",
            order_record_id: "order-rec-1",
        });
        const production = pcQueueMessage({
            kind: "pc_production_complete",
            production_record_id: "production-rec-1",
            actual_qty: 12,
            idempotency_key: "complete-1",
        });
        const material = pcQueueMessage({ kind: "pc_material_refresh" });

        await handleMarketplaceQueueBatch(
            {
                queue: "crm-marketplace-events",
                messages: [order, production, material],
            },
            {} as Env
        );

        expect(reconcileOrderInventory).toHaveBeenCalledWith(
            expect.anything(),
            "order-rec-1"
        );
        expect(notifyLowStockAfterOrderOnce).toHaveBeenCalledWith(
            expect.anything(),
            "order-rec-1"
        );
        expect(completePcProduction).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                production_record_id: "production-rec-1",
                actual_qty: 12,
                idempotency_key: "complete-1",
            })
        );
        expect(refreshPcMaterialPlan).toHaveBeenCalledOnce();
        for (const message of [order, production, material]) {
            expect(message.ack).toHaveBeenCalledOnce();
            expect(message.retry).not.toHaveBeenCalled();
        }
    });

    it("does not run the low stock check when inventory was released", async () => {
        reconcileOrderInventory.mockResolvedValue({ status: "RELEASED" });
        const message = pcQueueMessage({
            kind: "pc_order_sync",
            order_record_id: "order-rec-1",
        });

        await handleMarketplaceQueueBatch(
            {
                queue: "crm-marketplace-events",
                messages: [message],
            },
            {} as Env
        );

        expect(notifyLowStockAfterOrderOnce).not.toHaveBeenCalled();
        expect(message.ack).toHaveBeenCalledOnce();
    });

    it("retries a transient PC failure without acknowledging it", async () => {
        reconcileOrderInventory.mockRejectedValue(
            new Error("temporary network failure")
        );
        const message = pcQueueMessage({
            kind: "pc_order_sync",
            order_record_id: "order-rec-1",
        });

        await handleMarketplaceQueueBatch(
            {
                queue: "crm-marketplace-events",
                messages: [message],
            },
            {} as Env
        );

        expect(message.retry).toHaveBeenCalledOnce();
        expect(message.ack).not.toHaveBeenCalled();
    });

    it("retries the order message when the low stock check fails after an idempotent reconcile", async () => {
        reconcileOrderInventory.mockResolvedValue({
            status: "APPLIED",
            duplicate: true,
        });
        notifyLowStockAfterOrderOnce.mockRejectedValue(
            new Error("temporary notification read failure")
        );
        const message = pcQueueMessage({
            kind: "pc_order_sync",
            order_record_id: "order-rec-1",
        });

        await handleMarketplaceQueueBatch(
            {
                queue: "crm-marketplace-events",
                messages: [message],
            },
            {} as Env
        );

        expect(message.retry).toHaveBeenCalledOnce();
        expect(message.ack).not.toHaveBeenCalled();
    });

    it("acknowledges a disabled completion without changing the Production record", async () => {
        completePcProduction.mockRejectedValue(
            new OperationalError(
                "PC_INVENTORY_DISABLED",
                "Production & Stock Control is disabled",
                { retryable: false, status: 503 }
            )
        );
        const message = pcQueueMessage({
            kind: "pc_production_complete",
            production_record_id: "production-rec-1",
            actual_qty: 12,
            idempotency_key: "complete-disabled-1",
        });

        await handleMarketplaceQueueBatch(
            {
                queue: "crm-marketplace-events",
                messages: [message],
            },
            {} as Env
        );

        expect(markPcProductionBlocked).not.toHaveBeenCalled();
        expect(message.ack).toHaveBeenCalledOnce();
        expect(message.retry).not.toHaveBeenCalled();
    });

    it("acknowledges and marks a permanently blocked production completion", async () => {
        completePcProduction.mockRejectedValue(
            new OperationalError(
                "PC_PRODUCTION_MATERIAL_INSUFFICIENT",
                "material is insufficient",
                { retryable: false, status: 409 }
            )
        );
        markPcProductionBlocked.mockResolvedValue(undefined);
        const message = pcQueueMessage({
            kind: "pc_production_complete",
            production_record_id: "production-rec-1",
            actual_qty: 12,
            idempotency_key: "complete-1",
        });

        await handleMarketplaceQueueBatch(
            {
                queue: "crm-marketplace-events",
                messages: [message],
            },
            {} as Env
        );

        expect(markPcProductionBlocked).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                production_record_id: "production-rec-1",
                code: "PC_PRODUCTION_MATERIAL_INSUFFICIENT",
            })
        );
        expect(message.ack).toHaveBeenCalledOnce();
        expect(message.retry).not.toHaveBeenCalled();
    });
});
