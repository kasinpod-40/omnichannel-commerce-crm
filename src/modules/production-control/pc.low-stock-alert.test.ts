import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import type {
    PcOrderInventoryState,
    PcProduct,
} from "./pc.types";

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
    phase?: PcOrderInventoryState["phase"];
}): PcOrderInventoryState {
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

function orderWithState(state: PcOrderInventoryState) {
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
        mocks.notifyPcExceptionOnce.mockResolvedValue(true);
        mocks.getPcOverview.mockResolvedValue({
            summary: {},
            products: [product()],
            materials: [],
            production: [],
        });
    });

    it("uses a provided applied state without re-reading Lark", async () => {
        const state = orderState({ oldStock: 7, newStock: 5 });

        await expect(
            notifyLowStockAfterOrderOnce({} as Env, "order-rec-1", {
                inventoryState: state,
            })
        ).resolves.toEqual({
            state_ready: true,
            matched: 1,
            dispatched: 1,
            failed: 0,
            errors: [],
        });

        expect(mocks.getOrderByRecordId).not.toHaveBeenCalled();
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

    it("retries when the first Lark read has not exposed the applied state", async () => {
        mocks.getOrderByRecordId
            .mockResolvedValueOnce({ record_id: "order-rec-1", fields: {} })
            .mockResolvedValueOnce(
                orderWithState(orderState({ oldStock: 7, newStock: 5 }))
            );

        const result = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            { retryDelaysMs: [0, 0] }
        );

        expect(result.dispatched).toBe(1);
        expect(result.state_ready).toBe(true);
        expect(mocks.getOrderByRecordId).toHaveBeenCalledTimes(2);
    });

    it("retries a prepared state until applied is visible", async () => {
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
                orderWithState(orderState({ oldStock: 7, newStock: 5 }))
            );

        const result = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            { retryDelaysMs: [0, 0] }
        );

        expect(result.dispatched).toBe(1);
        expect(mocks.getOrderByRecordId).toHaveBeenCalledTimes(2);
    });

    it("reports dispatch failure instead of counting it as success", async () => {
        mocks.notifyPcExceptionOnce.mockResolvedValue(false);

        await expect(
            notifyLowStockAfterOrderOnce({} as Env, "order-rec-1", {
                inventoryState: orderState({ oldStock: 7, newStock: 5 }),
            })
        ).resolves.toEqual({
            state_ready: true,
            matched: 1,
            dispatched: 0,
            failed: 1,
            errors: [
                "ไม่สามารถสร้างหรือส่ง Notification สำหรับ SKU BNK-LUNA-IV-M",
            ],
        });
    });

    it("does not notify repeatedly while stock was already low", async () => {
        mocks.getOrderByRecordId.mockResolvedValue(
            orderWithState(orderState({ oldStock: 5, newStock: 3 }))
        );

        const result = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            noDelay
        );

        expect(result).toMatchObject({
            state_ready: true,
            matched: 0,
            dispatched: 0,
            failed: 0,
        });
        expect(mocks.notifyPcExceptionOnce).not.toHaveBeenCalled();
    });

    it("does not notify for stock releases or terminal states", async () => {
        mocks.getOrderByRecordId.mockResolvedValueOnce(
            orderWithState(orderState({ oldStock: 4, newStock: 6 }))
        );

        const release = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            noDelay
        );
        expect(release.matched).toBe(0);

        mocks.getOrderByRecordId.mockResolvedValueOnce(
            orderWithState(
                orderState({
                    oldStock: 7,
                    newStock: 5,
                    phase: "blocked",
                })
            )
        );

        const blocked = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            noDelay
        );
        expect(blocked.state_ready).toBe(false);
        expect(mocks.notifyPcExceptionOnce).not.toHaveBeenCalled();
    });

    it("marks state as not ready after bounded retries", async () => {
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
        ).resolves.toEqual({
            state_ready: false,
            matched: 0,
            dispatched: 0,
            failed: 0,
            errors: [],
        });

        expect(mocks.getOrderByRecordId).toHaveBeenCalledTimes(3);
        expect(mocks.getPcOverview).not.toHaveBeenCalled();
    });
});
