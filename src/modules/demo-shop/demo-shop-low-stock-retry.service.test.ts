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
                    min_stock: 10,
                    reason: "RECOVERY_CURRENT_LOW_STOCK",
                    message: "SKU BNK-LUNA-IV-M: ส่ง Recovery จาก Stock หลัง Order 5 ซึ่งเท่ากับหรือต่ำกว่า Min 10 (ก่อน Order 7)",
                },
            ],
        });
    });

    it("replays a current low-stock Demo Order without reconciling stock", async () => {
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
            {
                inventoryState: state,
                evaluationMode: "current_low_stock_recovery",
            }
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
                    "SKU BNK-LUNA-IV-M: ส่ง Recovery จาก Stock หลัง Order 5 ซึ่งเท่ากับหรือต่ำกว่า Min 10 (ก่อน Order 7)",
                ],
            },
        });
    });

    it("does not send recovery when stock after the Order remains above Min", async () => {
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
                    old_stock_on_hand: 14,
                    new_stock_on_hand: 12,
                    min_stock: 10,
                    reason: "STILL_ABOVE_MIN",
                    message: "SKU BNK-LUNA-IV-M: หลัง Order ยังเหลือ 12 มากกว่า Min 10",
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
                "SKU BNK-LUNA-IV-M: หลัง Order ยังเหลือ 12 มากกว่า Min 10",
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
