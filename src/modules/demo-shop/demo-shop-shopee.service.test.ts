import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import type { PcProduct } from "../production-control/pc.types";

const mocks = vi.hoisted(() => ({
    assertDemoShopSafeMode: vi.fn(),
    upsertMarketplaceOrder: vi.fn(),
    getOrderByRecordId: vi.fn(),
    getPcOverview: vi.fn(),
    reconcileOrderInventory: vi.fn(),
    notifyLowStockAfterOrderOnce: vi.fn(),
}));

vi.mock("./demo-shop.service", () => ({
    assertDemoShopSafeMode: mocks.assertDemoShopSafeMode,
}));
vi.mock("../marketplace/marketplace.service", () => ({
    upsertMarketplaceOrder: mocks.upsertMarketplaceOrder,
}));
vi.mock("../orders/order.repository", () => ({
    getOrderByRecordId: mocks.getOrderByRecordId,
}));
vi.mock("../production-control/pc.low-stock-alert", () => ({
    notifyLowStockAfterOrderOnce: mocks.notifyLowStockAfterOrderOnce,
}));
vi.mock("../production-control/pc.service", () => ({
    getPcOverview: mocks.getPcOverview,
    reconcileOrderInventory: mocks.reconcileOrderInventory,
}));

import { createDemoShopShopeeOrder } from "./demo-shop-shopee.service";

function env(): Env {
    return {
        PC_INVENTORY_ENABLED: "true",
        PC_DEMO_SHOP_ENABLED: "true",
    } as unknown as Env;
}

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
        stock_on_hand: 8,
        min_stock: 5,
        target_stock: 18,
        stock_status: "NORMAL",
        recommended_production_qty: 0,
        production_lead_days: 7,
        materials_json: "[]",
        active: true,
        ...overrides,
    };
}

const notificationOk = {
    state_ready: true,
    matched: 1,
    dispatched: 1,
    failed: 0,
    errors: [],
};

describe("Demo Shop Shopee order service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.notifyLowStockAfterOrderOnce.mockResolvedValue(notificationOk);
    });

    it("uses the final applied state directly and exposes notification outcome", async () => {
        const before = product();
        const after = product({
            stock_on_hand: 5,
            stock_status: "LOW_STOCK",
            recommended_production_qty: 13,
        });
        const inventoryState = {
            version: 1 as const,
            phase: "applied" as const,
            fingerprint: "fp-1",
            order_record_id: "order-rec-1",
            order_number: "SHP-DEMO-1",
            allocations: [{ sku: before.sku, quantity: 3 }],
            transitions: [
                {
                    record_id: before.record_id,
                    sku: before.sku,
                    previous_allocated_qty: 0,
                    target_allocated_qty: 3,
                    delta_allocated_qty: 3,
                    old_stock_on_hand: 8,
                    new_stock_on_hand: 5,
                },
            ],
            prepared_at: 1,
            completed_at: 2,
        };
        const order = {
            record_id: "order-rec-1",
            fields: {
                [ORDER_FIELDS.ORDER_NUMBER]: "SHP-DEMO-1",
                [ORDER_FIELDS.PC_INVENTORY_STATE_JSON]:
                    JSON.stringify(inventoryState),
            },
        };

        mocks.getPcOverview
            .mockResolvedValueOnce({
                summary: {},
                products: [before],
                materials: [],
                production: [],
            })
            .mockResolvedValueOnce({
                summary: {},
                products: [after],
                materials: [],
                production: [
                    {
                        source_order_id: "order-rec-1",
                        production_id: "PROD-001",
                        production_status: "RECOMMENDED",
                        recommended_qty: 13,
                        planned_qty: 13,
                        material_check_status: "SUFFICIENT",
                        material_risk_summary: "",
                    },
                ],
            });
        mocks.upsertMarketplaceOrder.mockResolvedValue({
            action: "created",
            order_record_id: "order-rec-1",
        });
        mocks.getOrderByRecordId.mockResolvedValue(order);
        mocks.reconcileOrderInventory.mockResolvedValue({
            status: "APPLIED",
            production_ids: ["PROD-001"],
            duplicate: false,
        });

        const result = await createDemoShopShopeeOrder(env(), {
            sku: before.sku,
            quantity: 3,
            idempotency_key: "demo-shop-request-001",
        });

        expect(mocks.notifyLowStockAfterOrderOnce).toHaveBeenCalledWith(
            expect.objectContaining({ PC_INVENTORY_ENABLED: "true" }),
            "order-rec-1",
            { inventoryState }
        );
        expect(result).toMatchObject({
            inventory: {
                stock_before: 8,
                stock_after: 5,
                stock_delta: -3,
            },
            notification: {
                status: "QUEUED",
                threshold_crossed: true,
                dispatched: 1,
                failed: 0,
            },
        });
    });

    it("exposes a failed notification without rolling back stock", async () => {
        const selected = product({ stock_on_hand: 5 });
        const order = {
            record_id: "order-rec-1",
            fields: {
                [ORDER_FIELDS.ORDER_NUMBER]: "SHP-DEMO-1",
                [ORDER_FIELDS.PC_INVENTORY_STATE_JSON]: "",
            },
        };
        mocks.getPcOverview.mockResolvedValue({
            summary: {},
            products: [selected],
            materials: [],
            production: [],
        });
        mocks.upsertMarketplaceOrder.mockResolvedValue({
            action: "duplicate",
            order_record_id: "order-rec-1",
        });
        mocks.getOrderByRecordId.mockResolvedValue(order);
        mocks.reconcileOrderInventory.mockResolvedValue({
            status: "APPLIED",
            production_ids: [],
            duplicate: true,
        });
        mocks.notifyLowStockAfterOrderOnce.mockResolvedValue({
            state_ready: false,
            matched: 0,
            dispatched: 0,
            failed: 0,
            errors: [],
        });

        const result = await createDemoShopShopeeOrder(env(), {
            sku: selected.sku,
            quantity: 2,
            idempotency_key: "demo-shop-request-001",
        });

        expect(result.notification).toMatchObject({
            status: "FAILED",
            failed: 1,
        });
        expect(result.duplicate).toBe(true);
    });
});
