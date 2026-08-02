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

vi.mock("../production-control/pc.service", () => ({
    getPcOverview: mocks.getPcOverview,
    reconcileOrderInventory: mocks.reconcileOrderInventory,
}));

import { createDemoShopShopeeOrder } from "./demo-shop-shopee.service";

function env(): Env {
    return {
        PC_INVENTORY_ENABLED: "false",
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

describe("Demo Shop Shopee order service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("uses the existing Shopee marketplace flow before scoped stock reconciliation", async () => {
        const before = product();
        const after = product({
            stock_on_hand: 6,
            stock_status: "LOW_STOCK",
            recommended_production_qty: 12,
        });
        const inventoryState = {
            version: 1,
            phase: "applied",
            fingerprint: "fp-1",
            order_record_id: "order-rec-1",
            order_number: "SHP-DEMO-1",
            allocations: [{ sku: before.sku, quantity: 2 }],
            transitions: [
                {
                    record_id: before.record_id,
                    sku: before.sku,
                    previous_allocated_qty: 0,
                    target_allocated_qty: 2,
                    delta_allocated_qty: 2,
                    old_stock_on_hand: 8,
                    new_stock_on_hand: 6,
                },
            ],
            prepared_at: Date.now(),
            completed_at: Date.now(),
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
                        recommended_qty: 12,
                        planned_qty: 12,
                        material_check_status: "SUFFICIENT",
                        material_risk_summary: "",
                    },
                ],
            });
        mocks.upsertMarketplaceOrder.mockResolvedValue({
            action: "created",
            customer_record_id: "customer-rec-1",
            order_record_id: "order-rec-1",
            channel: "Shopee",
            external_order_id: "DEMO-SHP-001",
            order_status: "Ready to Ship",
            payment_status: "Paid",
        });
        mocks.getOrderByRecordId.mockResolvedValue(order);
        mocks.reconcileOrderInventory.mockResolvedValue({
            status: "APPLIED",
            order_record_id: "order-rec-1",
            fingerprint: "fp-1",
            allocations: [{ sku: before.sku, quantity: 2 }],
            production_ids: ["PROD-001"],
            duplicate: false,
        });

        const result = await createDemoShopShopeeOrder(env(), {
            sku: before.sku,
            quantity: 2,
            idempotency_key: "demo-shop-request-001",
        });

        expect(mocks.assertDemoShopSafeMode).toHaveBeenCalledWith(
            expect.objectContaining({ PC_INVENTORY_ENABLED: "false" })
        );
        expect(mocks.upsertMarketplaceOrder).toHaveBeenCalledWith(
            expect.objectContaining({ PC_INVENTORY_ENABLED: "false" }),
            expect.objectContaining({
                channel: "Shopee",
                marketplace_status: "READY_TO_SHIP",
                marketplace_payment_status: "PAID",
                items: [
                    expect.objectContaining({
                        sku: "BNK-LUNA-IV-M",
                        quantity: 2,
                    }),
                ],
            })
        );
        expect(mocks.reconcileOrderInventory).toHaveBeenCalledWith(
            expect.objectContaining({
                PC_INVENTORY_ENABLED: "true",
                PC_DEMO_SHOP_ENABLED: "true",
            }),
            "order-rec-1"
        );
        expect(result).toMatchObject({
            duplicate: false,
            inventory: {
                stock_before: 8,
                stock_after: 6,
                stock_delta: -2,
            },
            production: {
                created_or_updated: true,
                production_ids: ["PROD-001"],
            },
        });
    });

    it("keeps the same Marketplace event and Order on an idempotent retry", async () => {
        const selected = product({ stock_on_hand: 6 });
        const order = {
            record_id: "order-rec-1",
            fields: {
                [ORDER_FIELDS.ORDER_NUMBER]: "SHP-DEMO-1",
            },
        };

        mocks.getPcOverview
            .mockResolvedValueOnce({
                summary: {},
                products: [selected],
                materials: [],
                production: [],
            })
            .mockResolvedValueOnce({
                summary: {},
                products: [selected],
                materials: [],
                production: [],
            });
        mocks.upsertMarketplaceOrder.mockResolvedValue({
            action: "duplicate",
            customer_record_id: "customer-rec-1",
            order_record_id: "order-rec-1",
            channel: "Shopee",
            external_order_id: "DEMO-SHP-001",
            order_status: "Ready to Ship",
            payment_status: "Paid",
        });
        mocks.getOrderByRecordId.mockResolvedValue(order);
        mocks.reconcileOrderInventory.mockResolvedValue({
            status: "APPLIED",
            order_record_id: "order-rec-1",
            fingerprint: "fp-1",
            allocations: [{ sku: selected.sku, quantity: 2 }],
            production_ids: [],
            duplicate: true,
        });

        const result = await createDemoShopShopeeOrder(env(), {
            sku: selected.sku,
            quantity: 2,
            idempotency_key: "demo-shop-request-001",
        });

        expect(result.duplicate).toBe(true);
        expect(mocks.upsertMarketplaceOrder).toHaveBeenCalledTimes(1);
        expect(mocks.reconcileOrderInventory).toHaveBeenCalledTimes(1);
    });
});
