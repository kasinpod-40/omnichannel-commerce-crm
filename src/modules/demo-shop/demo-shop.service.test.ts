import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import type {
    PcProduct,
    PcProductionBatch,
} from "../production-control/pc.types";

const mocks = vi.hoisted(() => ({
    createCustomer: vi.fn(),
    findCustomerByChannelCustomerId: vi.fn(),
    getCustomerByRecordId: vi.fn(),
    updateCustomer: vi.fn(),
    createOrder: vi.fn(),
    findOrderByChannelAndExternalId: vi.fn(),
    applyManualPaymentVerification: vi.fn(),
    getPipelineByRecordId: vi.fn(),
    createOpenPipelineForCustomer: vi.fn(),
    getPcOverview: vi.fn(),
    reconcileOrderInventory: vi.fn(),
}));

vi.mock("../customers/customer.repository", () => ({
    createCustomer: mocks.createCustomer,
    findCustomerByChannelCustomerId:
        mocks.findCustomerByChannelCustomerId,
    getCustomerByRecordId: mocks.getCustomerByRecordId,
    updateCustomer: mocks.updateCustomer,
}));

vi.mock("../orders/order.repository", () => ({
    createOrder: mocks.createOrder,
    findOrderByChannelAndExternalId:
        mocks.findOrderByChannelAndExternalId,
}));

vi.mock("../payments/payment.service", () => ({
    applyManualPaymentVerification:
        mocks.applyManualPaymentVerification,
}));

vi.mock("../pipeline/pipeline.repository", () => ({
    getPipelineByRecordId: mocks.getPipelineByRecordId,
}));

vi.mock("../pipeline/pipeline.service", () => ({
    createOpenPipelineForCustomer:
        mocks.createOpenPipelineForCustomer,
}));

vi.mock("../production-control/pc.service", () => ({
    getPcOverview: mocks.getPcOverview,
    reconcileOrderInventory: mocks.reconcileOrderInventory,
}));

import {
    assertDemoShopSafeMode,
    createDemoShopOrder,
    getDemoShopCatalog,
} from "./demo-shop.service";

function env(overrides: Partial<Env> = {}): Env {
    return {
        PC_DEMO_SHOP_ENABLED: "true",
        PC_INVENTORY_ENABLED: "false",
        PC_PRODUCTS_TABLE_ID: "products",
        PC_MATERIALS_TABLE_ID: "materials",
        PC_PRODUCTION_TABLE_ID: "production",
        ...overrides,
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
        materials_json:
            '[{"material_sku":"FAB-IV"}]',
        active: true,
        ...overrides,
    };
}

function production(): PcProductionBatch {
    return {
        record_id: "production-rec-1",
        production_id: "PC-STOCK-LUNA",
        source_order_id: "order-rec-1",
        product_sku: "BNK-LUNA-IV-M",
        product_name: "Luna Silk Blouse",
        reason: "MIN_STOCK",
        order_shortage_qty: 0,
        recommended_qty: 12,
        planned_qty: 12,
        actual_qty: 0,
        material_check_status: "SUFFICIENT",
        production_status: "RECOMMENDED",
        material_requirement_summary: "",
        material_risk_summary: "",
        due_date: Date.now(),
        inventory_posted: false,
        inventory_posting_state_json: "",
        created_at: Date.now(),
        completed_at: 0,
        owner: "Unassigned",
        notes: "",
    };
}

function demoItemsJson(
    selected: PcProduct,
    quantity: number
): string {
    return JSON.stringify([
        {
            sku: selected.sku,
            name: selected.product_name,
            product_name: selected.product_name,
            variant: [selected.color, selected.size]
                .filter(Boolean)
                .join(" "),
            product_size: selected.size,
            quantity,
        },
    ]);
}

function linkedCustomer() {
    return {
        record_id: "customer-rec-1",
        fields: {},
    };
}

function linkedPipeline() {
    return {
        record_id: "pipeline-rec-1",
        fields: {},
    };
}

describe("Demo Shop service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("keeps the demo route isolated from the live PC feature flag", () => {
        expect(() =>
            assertDemoShopSafeMode(env())
        ).not.toThrow();
        expect(() =>
            assertDemoShopSafeMode(
                env({ PC_INVENTORY_ENABLED: "true" })
            )
        ).toThrow(
            "cannot run while live PC inventory processing is enabled"
        );
    });

    it("returns active products without internal Lark or BOM fields", async () => {
        mocks.getPcOverview.mockResolvedValue({
            summary: {},
            products: [
                product(),
                product({
                    record_id: "inactive",
                    sku: "INACTIVE",
                    active: false,
                }),
            ],
            materials: [],
            production: [],
        });

        const catalog = await getDemoShopCatalog(env());

        expect(catalog.products).toHaveLength(1);
        expect(catalog.products[0]).toMatchObject({
            sku: "BNK-LUNA-IV-M",
            product_name: "Luna Silk Blouse",
            price_thb: 2890,
            stock_on_hand: 8,
        });
        expect(catalog.products[0]).not.toHaveProperty(
            "record_id"
        );
        expect(catalog.products[0]).not.toHaveProperty(
            "materials_json"
        );
    });

    it("creates a paid demo Order with the exact SKU and runs inventory reconciliation synchronously", async () => {
        const beforeProduct = product();
        const afterProduct = product({
            stock_on_hand: 6,
            stock_status: "LOW_STOCK",
            recommended_production_qty: 12,
        });
        const order = {
            record_id: "order-rec-1",
            fields: {
                [ORDER_FIELDS.ORDER_NUMBER]:
                    "DEMO-ORDER-1",
            },
        };
        const state = {
            version: 1,
            phase: "applied",
            fingerprint: "fingerprint",
            order_record_id: "order-rec-1",
            order_number: "DEMO-ORDER-1",
            allocations: [
                { sku: beforeProduct.sku, quantity: 2 },
            ],
            transitions: [
                {
                    record_id: beforeProduct.record_id,
                    sku: beforeProduct.sku,
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

        mocks.getPcOverview
            .mockResolvedValueOnce({
                summary: {},
                products: [beforeProduct],
                materials: [],
                production: [],
            })
            .mockResolvedValueOnce({
                summary: {},
                products: [afterProduct],
                materials: [],
                production: [production()],
            });
        mocks.findOrderByChannelAndExternalId
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                ...order,
                fields: {
                    ...order.fields,
                    [ORDER_FIELDS.PC_INVENTORY_STATE_JSON]:
                        JSON.stringify(state),
                },
            });
        mocks.findCustomerByChannelCustomerId.mockResolvedValue(
            linkedCustomer()
        );
        mocks.updateCustomer.mockResolvedValue(
            linkedCustomer()
        );
        mocks.getCustomerByRecordId.mockResolvedValue(
            linkedCustomer()
        );
        mocks.createOpenPipelineForCustomer.mockResolvedValue(
            linkedPipeline()
        );
        mocks.createOrder.mockResolvedValue(order);
        mocks.applyManualPaymentVerification.mockResolvedValue({
            order,
        });
        mocks.reconcileOrderInventory.mockResolvedValue({
            status: "APPLIED",
            order_record_id: "order-rec-1",
            fingerprint: "fingerprint",
            allocations: [
                { sku: beforeProduct.sku, quantity: 2 },
            ],
            production_ids: ["PC-STOCK-LUNA"],
            duplicate: false,
        });

        const result = await createDemoShopOrder(env(), {
            sku: beforeProduct.sku,
            quantity: 2,
            idempotency_key: "demo-shop-request-001",
        });

        expect(mocks.createOrder).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                channel: "LINE",
                product_name: "Luna Silk Blouse",
                product_size: "M",
                quantity: 2,
                total_amount: 5780,
                payment_verified: false,
                marketplace_items_json: demoItemsJson(
                    beforeProduct,
                    2
                ),
            })
        );
        expect(
            mocks.applyManualPaymentVerification
        ).toHaveBeenCalledTimes(1);
        expect(
            mocks.reconcileOrderInventory
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                PC_INVENTORY_ENABLED: "true",
                PC_DEMO_SHOP_ENABLED: "true",
            }),
            "order-rec-1"
        );
        expect(result).toMatchObject({
            duplicate: false,
            inventory: {
                status: "APPLIED",
                stock_before: 8,
                stock_after: 6,
                stock_delta: -2,
            },
            production: {
                created_or_updated: true,
                production_ids: ["PC-STOCK-LUNA"],
            },
        });
    });

    it("resumes payment and stock safely without creating a second Order for the same idempotency key", async () => {
        const selected = product({ stock_on_hand: 6 });
        const existing = {
            record_id: "order-rec-1",
            fields: {
                [ORDER_FIELDS.ORDER_NUMBER]:
                    "DEMO-ORDER-1",
                [ORDER_FIELDS.CUSTOMER]: [
                    { record_id: "customer-rec-1" },
                ],
                [ORDER_FIELDS.PIPELINE]: [
                    { record_id: "pipeline-rec-1" },
                ],
                [ORDER_FIELDS.PRODUCT_NAME]:
                    selected.product_name,
                [ORDER_FIELDS.PRODUCT_SIZE]: selected.size,
                [ORDER_FIELDS.QUANTITY]: 2,
                [ORDER_FIELDS.MARKETPLACE_ITEMS_JSON]:
                    demoItemsJson(selected, 2),
                [ORDER_FIELDS.PC_INVENTORY_STATE_JSON]:
                    JSON.stringify({
                        version: 1,
                        phase: "applied",
                        fingerprint: "same",
                        order_record_id: "order-rec-1",
                        order_number: "DEMO-ORDER-1",
                        allocations: [
                            {
                                sku: selected.sku,
                                quantity: 2,
                            },
                        ],
                        transitions: [],
                        prepared_at: Date.now(),
                    }),
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
        mocks.findOrderByChannelAndExternalId
            .mockResolvedValueOnce(existing)
            .mockResolvedValueOnce(existing);
        mocks.getCustomerByRecordId.mockResolvedValue(
            linkedCustomer()
        );
        mocks.getPipelineByRecordId.mockResolvedValue(
            linkedPipeline()
        );
        mocks.applyManualPaymentVerification.mockResolvedValue({
            order: existing,
        });
        mocks.reconcileOrderInventory.mockResolvedValue({
            status: "APPLIED",
            order_record_id: "order-rec-1",
            fingerprint: "same",
            allocations: [
                { sku: selected.sku, quantity: 2 },
            ],
            production_ids: [],
            duplicate: true,
        });

        const result = await createDemoShopOrder(env(), {
            sku: selected.sku,
            quantity: 2,
            idempotency_key: "demo-shop-request-001",
        });

        expect(result.duplicate).toBe(true);
        expect(mocks.createOrder).not.toHaveBeenCalled();
        expect(
            mocks.applyManualPaymentVerification
        ).toHaveBeenCalledWith(
            expect.anything(),
            existing,
            expect.objectContaining({
                record_id: "customer-rec-1",
            }),
            expect.objectContaining({
                record_id: "pipeline-rec-1",
            })
        );
        expect(
            mocks.reconcileOrderInventory
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                PC_INVENTORY_ENABLED: "true",
            }),
            "order-rec-1"
        );
    });

    it("rejects reuse of an idempotency key with a different quantity before payment or stock mutation", async () => {
        const selected = product();
        mocks.getPcOverview.mockResolvedValue({
            summary: {},
            products: [selected],
            materials: [],
            production: [],
        });
        mocks.findOrderByChannelAndExternalId.mockResolvedValue({
            record_id: "order-rec-1",
            fields: {
                [ORDER_FIELDS.ORDER_NUMBER]:
                    "DEMO-ORDER-1",
                [ORDER_FIELDS.PRODUCT_NAME]:
                    selected.product_name,
                [ORDER_FIELDS.PRODUCT_SIZE]: selected.size,
                [ORDER_FIELDS.QUANTITY]: 1,
                [ORDER_FIELDS.MARKETPLACE_ITEMS_JSON]:
                    demoItemsJson(selected, 1),
            },
        });

        await expect(
            createDemoShopOrder(env(), {
                sku: selected.sku,
                quantity: 2,
                idempotency_key: "demo-shop-request-001",
            })
        ).rejects.toThrow("สินค้า หรือจำนวนต่างกัน");

        expect(
            mocks.applyManualPaymentVerification
        ).not.toHaveBeenCalled();
        expect(
            mocks.reconcileOrderInventory
        ).not.toHaveBeenCalled();
        expect(mocks.createOrder).not.toHaveBeenCalled();
    });
});
