import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";

const mocks = vi.hoisted(() => ({
    listOrders: vi.fn(),
    notifyLowStockAfterOrderOnce: vi.fn(),
    assertDemoShopSafeMode: vi.fn(),
}));

vi.mock("../orders/order.repository", () => ({
    listOrders: mocks.listOrders,
}));
vi.mock("../production-control/pc.low-stock-alert", () => ({
    notifyLowStockAfterOrderOnce:
        mocks.notifyLowStockAfterOrderOnce,
}));
vi.mock("./demo-shop.service", () => ({
    assertDemoShopSafeMode: mocks.assertDemoShopSafeMode,
}));

import { retryDemoShopLowStockNotification } from "./demo-shop-low-stock-retry.service";

function appliedState() {
    return {
        version: 1,
        phase: "applied",
        fingerprint: "fp-1",
        order_record_id: "order-rec-1",
        order_number: "SP-DEMO-SHP-001",
        allocations: [{ sku: "BNK-LUNA-IV-M", quantity: 2 }],
        transitions: [
            {
                record_id: "product-rec-1",
                sku: "BNK-LUNA-IV-M",
                previous_allocated_qty: 0,
                target_allocated_qty: 2,
                delta_allocated_qty: 2,
                old_stock_on_hand: 7,
                new_stock_on_hand: 5,
            },
        ],
        prepared_at: 1,
        completed_at: 2,
    };
}

function demoOrder() {
    return {
        record_id: "order-rec-1",
        fields: {
            [ORDER_FIELDS.ORDER_NUMBER]: "SP-DEMO-SHP-001",
            [ORDER_FIELDS.CHANNEL]: "Shopee",
            [ORDER_FIELDS.MARKETPLACE_STORE_ID]: "demo-shop-shopee-th",
            [ORDER_FIELDS.EXTERNAL_ORDER_ID]: "DEMO-SHP-001",
            [ORDER_FIELDS.PC_INVENTORY_STATE_JSON]:
                JSON.stringify(appliedState()),
        },
    };
}

describe("Demo Shop low-stock retry", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listOrders.mockResolvedValue([demoOrder()]);
        mocks.notifyLowStockAfterOrderOnce.mockResolvedValue({
            state_ready: true,
            matched: 1,
            dispatched: 1,
            failed: 0,
            errors: [],
            diagnostics: [
                {
                    transition_record_id: "product-rec-1",
                    transition_sku: "BNK-LUNA-IV-M",
                    resolved_sku: "BNK-LUNA-IV-M",
                    old_stock_on_hand: 7,
                    new_stock_on_hand: 5,
                    min_stock: 5,
                    reason: "MATCHED",
                    message: "SKU BNK-LUNA-IV-M: Stock ข้ามเกณฑ์ 7 → 5 (Min 5)",
                },
            ],
        });
    });

    it("replays an applied Demo Order without reconciling stock", async () => {
        const state = appliedState();
        const result = await retryDemoShopLowStockNotification(
            { PC_INVENTORY_ENABLED: "true" } as Env,
            "SP-DEMO-SHP-001"
        );

        expect(mocks.assertDemoShopSafeMode).toHaveBeenCalledWith(
            expect.objectContaining({ PC_INVENTORY_ENABLED: "false" })
        );
        expect(mocks.notifyLowStockAfterOrderOnce).toHaveBeenCalledWith(
            expect.objectContaining({ PC_INVENTORY_ENABLED: "true" }),
            "order-rec-1",
            { inventoryState: state }
        );
        expect(result).toEqual({
            ok: true,
            order_number: "SP-DEMO-SHP-001",
            stock_unchanged: true,
            notification: {
                status: "QUEUED",
                threshold_crossed: true,
                dispatched: 1,
                failed: 0,
                error_messages: [],
                evaluation_messages: [
                    "SKU BNK-LUNA-IV-M: Stock ข้ามเกณฑ์ 7 → 5 (Min 5)",
                ],
            },
        });
    });

    it("returns the exact reason when the Order did not cross Min Stock", async () => {
        mocks.notifyLowStockAfterOrderOnce.mockResolvedValue({
            state_ready: true,
            matched: 0,
            dispatched: 0,
            failed: 0,
            errors: [],
            diagnostics: [
                {
                    transition_record_id: "product-rec-1",
                    transition_sku: "BNK-LUNA-IV-M",
                    resolved_sku: "BNK-LUNA-IV-M",
                    old_stock_on_hand: 5,
                    new_stock_on_hand: 3,
                    min_stock: 5,
                    reason: "ALREADY_AT_OR_BELOW_MIN",
                    message: "SKU BNK-LUNA-IV-M: ก่อน Order มี Stock 5 ซึ่งเท่ากับหรือต่ำกว่า Min 5 อยู่แล้ว",
                },
            ],
        });

        const result = await retryDemoShopLowStockNotification(
            {} as Env,
            "SP-DEMO-SHP-001"
        );

        expect(result.notification).toEqual({
            status: "NOT_REQUIRED",
            threshold_crossed: false,
            dispatched: 0,
            failed: 0,
            error_messages: [],
            evaluation_messages: [
                "SKU BNK-LUNA-IV-M: ก่อน Order มี Stock 5 ซึ่งเท่ากับหรือต่ำกว่า Min 5 อยู่แล้ว",
            ],
        });
    });

    it("does not mislabel an unavailable state as not required", async () => {
        mocks.notifyLowStockAfterOrderOnce.mockResolvedValue({
            state_ready: false,
            matched: 0,
            dispatched: 0,
            failed: 1,
            errors: ["ไม่พบ Inventory state แบบ applied"],
            diagnostics: [],
        });

        const result = await retryDemoShopLowStockNotification(
            {} as Env,
            "SP-DEMO-SHP-001"
        );

        expect(result.ok).toBe(false);
        expect(result.notification.status).toBe("FAILED");
        expect(result.notification.error_messages).toEqual([
            "ไม่พบ Inventory state แบบ applied",
        ]);
    });

    it("rejects a non-Demo Shop order", async () => {
        mocks.listOrders.mockResolvedValue([
            {
                record_id: "order-rec-1",
                fields: {
                    [ORDER_FIELDS.ORDER_NUMBER]: "SP-REAL-001",
                    [ORDER_FIELDS.CHANNEL]: "Shopee",
                    [ORDER_FIELDS.MARKETPLACE_STORE_ID]: "customer-store",
                    [ORDER_FIELDS.EXTERNAL_ORDER_ID]: "REAL-001",
                    [ORDER_FIELDS.PC_INVENTORY_STATE_JSON]:
                        JSON.stringify(appliedState()),
                },
            },
        ]);

        await expect(
            retryDemoShopLowStockNotification(
                {} as Env,
                "SP-REAL-001"
            )
        ).rejects.toThrow("ไม่พบ Shopee Demo Order");

        expect(mocks.notifyLowStockAfterOrderOnce).not.toHaveBeenCalled();
    });
});
