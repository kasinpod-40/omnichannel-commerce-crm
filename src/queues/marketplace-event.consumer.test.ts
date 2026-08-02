import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config/env";
import { OperationalError } from "../utils/errors";
import type {
    QueueBatchLike,
    QueueMessageLike,
} from "./line-event.types";
import type { MarketplaceEventQueueMessage } from "./marketplace-event.types";

const mocks = vi.hoisted(() => ({
    processLazadaMarketplaceEvent: vi.fn(),
    reconcileOrderInventory: vi.fn(),
    completePcProduction: vi.fn(),
    refreshPcMaterialPlan: vi.fn(),
    markPcProductionBlocked: vi.fn(),
    notifyLowStockAfterOrderOnce: vi.fn(),
}));

vi.mock(
    "../modules/marketplace/lazada/lazada.webhook-processor",
    () => ({
        processLazadaMarketplaceEvent:
            mocks.processLazadaMarketplaceEvent,
    })
);
vi.mock("../modules/production-control/pc.low-stock-alert", () => ({
    notifyLowStockAfterOrderOnce:
        mocks.notifyLowStockAfterOrderOnce,
}));
vi.mock("../modules/production-control/pc.service", () => ({
    reconcileOrderInventory: mocks.reconcileOrderInventory,
    completePcProduction: mocks.completePcProduction,
    refreshPcMaterialPlan: mocks.refreshPcMaterialPlan,
    markPcProductionBlocked: mocks.markPcProductionBlocked,
}));

import { handleMarketplaceQueueBatch } from "./marketplace-event.consumer";

function queueMessage(input: {
    id: string;
    orderId?: string;
    orderStatus: string;
    receivedAt?: number;
}): QueueMessageLike<MarketplaceEventQueueMessage> {
    const orderId = input.orderId ?? "order-1";
    const receivedAt = input.receivedAt ?? Date.now();

    return {
        id: input.id,
        timestamp: new Date(receivedAt),
        attempts: 1,
        body: {
            schema_version: 1,
            channel: "Lazada",
            seller_id: "seller-1",
            order_id: orderId,
            order_status: input.orderStatus,
            message_type: "0",
            received_at: receivedAt,
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
        | { kind: "pc_material_refresh" }
): QueueMessageLike<MarketplaceEventQueueMessage> {
    const id = `msg-${body.kind}`;
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

const alertOk = {
    state_ready: true,
    matched: 0,
    dispatched: 0,
    failed: 0,
    errors: [],
};

describe("marketplace event queue consumer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.notifyLowStockAfterOrderOnce.mockResolvedValue(alertOk);
    });

    it("coalesces a Lazada burst and acknowledges all messages", async () => {
        mocks.processLazadaMarketplaceEvent.mockResolvedValue(undefined);
        const messages = [
            queueMessage({ id: "msg-1", orderStatus: "unpaid", receivedAt: 1 }),
            queueMessage({ id: "msg-2", orderStatus: "pending", receivedAt: 2 }),
        ];

        await handleMarketplaceQueueBatch(
            { queue: "crm-marketplace-events", messages },
            {} as Env
        );

        expect(mocks.processLazadaMarketplaceEvent).toHaveBeenCalledTimes(1);
        expect(mocks.processLazadaMarketplaceEvent).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ received_at: 2 })
        );
        messages.forEach((message) => {
            expect(message.ack).toHaveBeenCalledOnce();
            expect(message.retry).not.toHaveBeenCalled();
        });
    });

    it("retries only the newest Lazada message on transient failure", async () => {
        mocks.processLazadaMarketplaceEvent.mockRejectedValue(
            new Error("temporary failure")
        );
        const messages = [
            queueMessage({ id: "msg-1", orderStatus: "pending", receivedAt: 1 }),
            queueMessage({ id: "msg-2", orderStatus: "pending", receivedAt: 2 }),
        ];

        await handleMarketplaceQueueBatch(
            { queue: "crm-marketplace-events", messages },
            {} as Env
        );

        expect(messages[0]?.ack).toHaveBeenCalledOnce();
        expect(messages[1]?.retry).toHaveBeenCalledOnce();
        expect(messages[1]?.ack).not.toHaveBeenCalled();
    });

    it("checks low stock after applied reconciliation and acknowledges", async () => {
        mocks.reconcileOrderInventory.mockResolvedValue({ status: "APPLIED" });
        const message = pcQueueMessage({
            kind: "pc_order_sync",
            order_record_id: "order-rec-1",
        });

        await handleMarketplaceQueueBatch(
            { queue: "crm-marketplace-events", messages: [message] },
            {} as Env
        );

        expect(mocks.notifyLowStockAfterOrderOnce).toHaveBeenCalledWith(
            expect.anything(),
            "order-rec-1"
        );
        expect(message.ack).toHaveBeenCalledOnce();
    });

    it("skips low stock for released reconciliation", async () => {
        mocks.reconcileOrderInventory.mockResolvedValue({ status: "RELEASED" });
        const message = pcQueueMessage({
            kind: "pc_order_sync",
            order_record_id: "order-rec-1",
        });

        await handleMarketplaceQueueBatch(
            { queue: "crm-marketplace-events", messages: [message] },
            {} as Env
        );

        expect(mocks.notifyLowStockAfterOrderOnce).not.toHaveBeenCalled();
        expect(message.ack).toHaveBeenCalledOnce();
    });

    it("retries when applied state is not ready for notification", async () => {
        mocks.reconcileOrderInventory.mockResolvedValue({
            status: "APPLIED",
            duplicate: true,
        });
        mocks.notifyLowStockAfterOrderOnce.mockResolvedValue({
            ...alertOk,
            state_ready: false,
        });
        const message = pcQueueMessage({
            kind: "pc_order_sync",
            order_record_id: "order-rec-1",
        });

        await handleMarketplaceQueueBatch(
            { queue: "crm-marketplace-events", messages: [message] },
            {} as Env
        );

        expect(message.retry).toHaveBeenCalledOnce();
        expect(message.ack).not.toHaveBeenCalled();
    });

    it("retries when notification dispatch failed", async () => {
        mocks.reconcileOrderInventory.mockResolvedValue({ status: "APPLIED" });
        mocks.notifyLowStockAfterOrderOnce.mockResolvedValue({
            state_ready: true,
            matched: 1,
            dispatched: 0,
            failed: 1,
            errors: ["queue unavailable"],
        });
        const message = pcQueueMessage({
            kind: "pc_order_sync",
            order_record_id: "order-rec-1",
        });

        await handleMarketplaceQueueBatch(
            { queue: "crm-marketplace-events", messages: [message] },
            {} as Env
        );

        expect(message.retry).toHaveBeenCalledOnce();
        expect(message.ack).not.toHaveBeenCalled();
    });

    it("processes production completion and material refresh", async () => {
        mocks.completePcProduction.mockResolvedValue({ inventory_posted: true });
        mocks.refreshPcMaterialPlan.mockResolvedValue({ materials_updated: 1 });
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
                messages: [production, material],
            },
            {} as Env
        );

        expect(mocks.completePcProduction).toHaveBeenCalledOnce();
        expect(mocks.refreshPcMaterialPlan).toHaveBeenCalledOnce();
        expect(production.ack).toHaveBeenCalledOnce();
        expect(material.ack).toHaveBeenCalledOnce();
    });

    it("marks a permanently blocked production completion", async () => {
        mocks.completePcProduction.mockRejectedValue(
            new OperationalError(
                "PC_PRODUCTION_MATERIAL_INSUFFICIENT",
                "material is insufficient",
                { retryable: false, status: 409 }
            )
        );
        mocks.markPcProductionBlocked.mockResolvedValue(undefined);
        const message = pcQueueMessage({
            kind: "pc_production_complete",
            production_record_id: "production-rec-1",
            actual_qty: 12,
            idempotency_key: "complete-1",
        });

        await handleMarketplaceQueueBatch(
            { queue: "crm-marketplace-events", messages: [message] },
            {} as Env
        );

        expect(mocks.markPcProductionBlocked).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                production_record_id: "production-rec-1",
                code: "PC_PRODUCTION_MATERIAL_INSUFFICIENT",
            })
        );
        expect(message.ack).toHaveBeenCalledOnce();
    });
});
