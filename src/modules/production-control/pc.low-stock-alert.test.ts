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
    orderRecordId?: string;
    transitionSku?: string;
    transitionRecordId?: string;
}): PcOrderInventoryState {
    return {
        version: 1,
        phase: input.phase ?? "applied",
        fingerprint: "fp-low-stock-1",
        order_record_id: input.orderRecordId ?? "order-rec-1",
        order_number: "SHP-DEMO-1",
        allocations: [{ sku: "BNK-LUNA-IV-M", quantity: 2 }],
        transitions: [
            {
                record_id:
                    input.transitionRecordId ?? "product-rec-1",
                sku: input.transitionSku ?? "BNK-LUNA-IV-M",
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

    it("uses a provided applied state and sends a concise team-facing message", async () => {
        const state = orderState({ oldStock: 7, newStock: 5 });

        const result = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            { inventoryState: state }
        );

        expect(result).toMatchObject({
            state_ready: true,
            matched: 1,
            dispatched: 1,
            failed: 0,
            errors: [],
            diagnostics: [
                expect.objectContaining({
                    reason: "MATCHED",
                    transition_sku: "BNK-LUNA-IV-M",
                    resolved_sku: "BNK-LUNA-IV-M",
                    old_stock_on_hand: 7,
                    new_stock_on_hand: 5,
                    min_stock: 5,
                }),
            ],
        });
        expect(mocks.getOrderByRecordId).not.toHaveBeenCalled();
        expect(mocks.notifyPcExceptionOnce).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                product_name: "Luna Silk Blouse",
                detail: [
                    "สี / ไซซ์: Ivory / M",
                    "SKU: BNK-LUNA-IV-M",
                    "คงเหลือ: 5 ชิ้น",
                    "ขั้นต่ำ: 5 ชิ้น",
                    "ควรเติม: 13 ชิ้น",
                    "เป้าหมาย: 18 ชิ้น",
                ].join("\n"),
                next_action:
                    "ตรวจสอบวัตถุดิบและยืนยันแผนผลิตที่ระบบสร้างไว้",
                lark_text: [
                    "[CRM] 📦 สินค้าใกล้หมด",
                    "",
                    "สินค้า: Luna Silk Blouse",
                    "สี / ไซซ์: Ivory / M",
                    "SKU: BNK-LUNA-IV-M",
                    "คงเหลือ: 5 ชิ้น",
                    "ขั้นต่ำ: 5 ชิ้น",
                    "ควรเติม: 13 ชิ้น",
                    "เป้าหมาย: 18 ชิ้น",
                    "",
                    "การดำเนินการ: ตรวจสอบวัตถุดิบและยืนยันแผนผลิตที่ระบบสร้างไว้",
                ].join("\n"),
            })
        );
    });

    it("resolves the Product by transition record id when the stored SKU format differs", async () => {
        const result = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            {
                inventoryState: orderState({
                    oldStock: 7,
                    newStock: 5,
                    transitionSku: "legacy sku alias",
                }),
            }
        );

        expect(result).toMatchObject({
            matched: 1,
            dispatched: 1,
            diagnostics: [
                expect.objectContaining({
                    reason: "MATCHED",
                    transition_sku: "legacy sku alias",
                    resolved_sku: "BNK-LUNA-IV-M",
                }),
            ],
        });
    });

    it("repairs stale order_record_id metadata on a verified provided state", async () => {
        const result = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            {
                inventoryState: orderState({
                    oldStock: 7,
                    newStock: 5,
                    orderRecordId: "legacy-order-record",
                }),
            }
        );

        expect(result.matched).toBe(1);
        expect(mocks.getOrderByRecordId).not.toHaveBeenCalled();
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

    it("reports dispatch failure instead of counting it as success", async () => {
        mocks.notifyPcExceptionOnce.mockResolvedValue(false);

        const result = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            {
                inventoryState: orderState({ oldStock: 7, newStock: 5 }),
            }
        );

        expect(result).toMatchObject({
            state_ready: true,
            matched: 1,
            dispatched: 0,
            failed: 1,
            errors: [
                "ไม่สามารถสร้างหรือส่ง Notification สำหรับ SKU BNK-LUNA-IV-M",
            ],
        });
    });

    it("explains when stock was already at or below Min before the Order", async () => {
        const result = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            {
                inventoryState: orderState({ oldStock: 5, newStock: 3 }),
            }
        );

        expect(result).toMatchObject({
            state_ready: true,
            matched: 0,
            dispatched: 0,
            failed: 0,
            diagnostics: [
                expect.objectContaining({
                    reason: "ALREADY_AT_OR_BELOW_MIN",
                    old_stock_on_hand: 5,
                    new_stock_on_hand: 3,
                    min_stock: 5,
                }),
            ],
        });
        expect(mocks.notifyPcExceptionOnce).not.toHaveBeenCalled();
    });

    it("manually recovers an alert without exposing recovery internals to the group", async () => {
        mocks.getPcOverview.mockResolvedValue({
            summary: {},
            products: [product({ min_stock: 10 })],
            materials: [],
            production: [],
        });

        const result = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            {
                inventoryState: orderState({ oldStock: 7, newStock: 5 }),
                evaluationMode: "current_low_stock_recovery",
            }
        );

        expect(result).toMatchObject({
            state_ready: true,
            matched: 1,
            dispatched: 1,
            failed: 0,
            diagnostics: [
                expect.objectContaining({
                    reason: "RECOVERY_CURRENT_LOW_STOCK",
                    old_stock_on_hand: 7,
                    new_stock_on_hand: 5,
                    min_stock: 10,
                }),
            ],
        });
        expect(mocks.notifyPcExceptionOnce).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                event_id: expect.stringContaining("pc:low-stock-recovery:"),
                detail: expect.not.stringContaining("ส่งซ้ำจาก Order เดิม"),
                lark_text: expect.not.stringContaining("ส่งซ้ำจาก Order เดิม"),
            })
        );
    });

    it("fails visibly when the Product cannot be resolved", async () => {
        mocks.getPcOverview.mockResolvedValue({
            summary: {},
            products: [],
            materials: [],
            production: [],
        });

        const result = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            {
                inventoryState: orderState({ oldStock: 7, newStock: 5 }),
            }
        );

        expect(result).toMatchObject({
            state_ready: true,
            matched: 0,
            dispatched: 0,
            failed: 1,
            diagnostics: [
                expect.objectContaining({
                    reason: "PRODUCT_NOT_FOUND",
                }),
            ],
        });
        expect(result.errors[0]).toContain("หา Product");
    });

    it("marks terminal or unavailable state as a visible failure", async () => {
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
        expect(blocked).toMatchObject({
            state_ready: false,
            failed: 1,
        });
        expect(blocked.errors[0]).toContain("Inventory state");

        mocks.getOrderByRecordId.mockResolvedValue({
            record_id: "order-rec-1",
            fields: {},
        });
        const unavailable = await notifyLowStockAfterOrderOnce(
            {} as Env,
            "order-rec-1",
            { retryDelaysMs: [0, 0] }
        );
        expect(unavailable).toMatchObject({
            state_ready: false,
            failed: 1,
            diagnostics: [],
        });
    });
});
