import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import type { PcProduct } from "./pc.types";

const mocks = vi.hoisted(() => ({
    getOrderByRecordId: vi.fn(),
    getPcOverview: vi.fn(),
    notifyPcExceptionOnce: vi.fn(),
}));

vi.mock("../orders/order.repository", () => ({
    getOrderByRecordId: mocks.getOrderByRecordId,
}));

vi.mock("./pc.service", () => ({
    getPcOverview: mocks.getPcOverview,
}));

vi.mock("./pc.alerts", () => ({
    notifyPcExceptionOnce: mocks.notifyPcExceptionOnce,
}));

import { notifyLowStockAfterOrderOnce } from "./pc.low-stock-alert";

function product(overrides: Partial<PcProduct> = {}): PcProduct {
    return {
        record_id: "product-rec-1",
        sku: "BNK-LUNA-IV-M",
        product_id: "LUNA",
        style_code: "LUNA",
        product_name: "Luna Silk Blouse",
        category: "Blouse",
        color: "Ivory",
        size: "M",
        sales_price_thb: 2890,
        stock_on_hand: 5,
        min_stock: 5,
        target_stock: 18,
        stock_status: "LOW_STOCK",
        recommended_production_qty: 13,
        production_lead_days: 7,
        materials_json: "[]",
        active: true,
        ...overrides,
    };
}

function orderState(input: {
    oldStock: number;
    newStock: number;
    phase?: "prepared" | "applied" | "released" | "blocked";
}) {
    return {
        version: 1,
        phase: input.phase ?? "applied",
        fingerprint: "fp-low-stock-1",
        order_record_id: "order-rec-1",
        order_number: "SHP-DEMO-1",
        allocations: [{ sku: "BNK-LUNA-IV-M", quantity: 2 }],
        transitions: [
            {
                record_id: "product-rec-1",
                sku: "BNK-LUNA-IV-M",
                previous_allocated_qty: 0,
                target_allocated_qty: 2,
                delta_allocated_qty: 2,
                old_stock_on_hand: input.oldStock,
                new_stock_on_hand: input.newStock,
            },
        ],
        prepared_at: 1,
        completed_at: 2,
    };
}

function orderWithState(state: ReturnType<typeof orderState>) {
    return {
        record_id: "order-rec-1",
        fields: {
            [ORDER_FIELDS.PC_INVENTORY_STATE_JSON]: JSON.stringify(state),
        },
    };
}

const noDelay = { retryDelaysMs: [0] } as const;

describe("PC low stock notification", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPcOverview.mockResolvedValue({
            summary: {},
            products: [product()],
            materials: [],
            production: [],
        });
    });

    it("notifies once when stock crosses from above Min Stock to the threshold", async () => {
        mocks.getOrderByRecordId.mockResolvedValue(
            orderWithState(orderState({ oldStock: 7, newStock: 5 }))
        );

        await expect(
            notifyLowStockAfterOrderOnce(
                {} as Env,
                "order-rec-1",
                noDelay
            )
        ).resolves.toBe(1);

        expect(mocks.notifyPcExceptionOnce).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                event_id: expect.stringContaining(
                    "pc:low-stock:order-rec-1:fp-low-stock-1:BNK-LUNA-IV-M"
                ),
                type: "PC_STOCK_EXCEPTION",
                reference_id: "BNK-LUNA-IV-M",
                detail: expect.stringContaining("สินค้าใกล้หมด"),
            })
        );
    });

    it("retries when the first Lark read has not exposed the applied inventory state yet", async () => {
        mocks.getOrderByRecordId
            .mockResolvedValueOnce({
                record_id: "order-rec-1",
                fields: {},
            })
            .mockResolvedValueOnce(
                orderWithState(
                    orderState({ oldStock: 7, newStock: 5 })
                )
            );

        await expect(
            notifyLowStockAfterOrderOnce(
                {} as Env,
                "order-rec-1",
                { retryDelaysMs: [0, 0] }
            )
        ).resolves.toBe(1);

        expect(mocks.getOrderByRecordId).toHaveBeenCalledTimes(2);
        expect(mocks.notifyPcExceptionOnce).toHaveBeenCalledTimes(1);
    });

    it("retries a prepared state until the applied state is visible", async () => {
        mocks.getOrderByRecordId
            .mockResolvedValueOnce(
                orderWithState(
                    orderState({
                        oldStock: 7,
                        newStock: 5,
                        phase: "prepared",
                    })
                )
            )
            .mockResolvedValueOnce(
                orderWithState(
                    orderState({ oldStock: 7, newStock: 5 })
                )
            );

        await expect(
            notifyLowStockAfterOrderOnce(
                {} as Env,
                "order-rec-1",
                { retryDelaysMs: [0, 0] }
            )
        ).resolves.toBe(1);

        expect(mocks.getOrderByRecordId).toHaveBeenCalledTimes(2);
    });

    it("does not notify repeatedly while stock was already below the threshold", async () => {
        mocks.getOrderByRecordId.mockResolvedValue(
            orderWithState(orderState({ oldStock: 5, newStock: 3 }))
        );

        await expect(
            notifyLowStockAfterOrderOnce(
                {} as Env,
                "order-rec-1",
                noDelay
            )
        ).resolves.toBe(0);
        expect(mocks.notifyPcExceptionOnce).not.toHaveBeenCalled();
    });

    it("does not notify for stock releases or terminal incomplete inventory state", async () => {
        mocks.getOrderByRecordId.mockResolvedValueOnce(
            orderWithState(orderState({ oldStock: 4, newStock: 6 }))
        );

        await expect(
            notifyLowStockAfterOrderOnce(
                {} as Env,
                "order-rec-1",
                noDelay
            )
        ).resolves.toBe(0);

        mocks.getOrderByRecordId.mockResolvedValueOnce(
            orderWithState(
                orderState({
                    oldStock: 7,
                    newStock: 5,
                    phase: "blocked",
                })
            )
        );

        await expect(
            notifyLowStockAfterOrderOnce(
                {} as Env,
                "order-rec-1",
                noDelay
            )
        ).resolves.toBe(0);
        expect(mocks.notifyPcExceptionOnce).not.toHaveBeenCalled();
    });

    it("returns without alerting when the applied state is still unavailable after bounded retries", async () => {
        mocks.getOrderByRecordId.mockResolvedValue({
            record_id: "order-rec-1",
            fields: {},
        });

        await expect(
            notifyLowStockAfterOrderOnce(
                {} as Env,
                "order-rec-1",
                { retryDelaysMs: [0, 0, 0] }
            )
        ).resolves.toBe(0);

        expect(mocks.getOrderByRecordId).toHaveBeenCalledTimes(3);
        expect(mocks.getPcOverview).not.toHaveBeenCalled();
        expect(mocks.notifyPcExceptionOnce).not.toHaveBeenCalled();
    });
});
