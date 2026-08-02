import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import type {
    PcMaterial,
    PcProduct,
    PcProductionBatch,
} from "./pc.types";

const mocks = vi.hoisted(() => ({
    listPcMaterials: vi.fn(),
    listPcProduction: vi.fn(),
    listPcProducts: vi.fn(),
    createPcWorkflowActionUrl: vi.fn(),
}));

vi.mock("./pc.repository", () => ({
    listPcMaterials: mocks.listPcMaterials,
    listPcProduction: mocks.listPcProduction,
    listPcProducts: mocks.listPcProducts,
}));

vi.mock("./pc.action-token", () => ({
    createPcWorkflowActionUrl: mocks.createPcWorkflowActionUrl,
}));

import {
    buildPcNotificationActionCard,
    buildProductionCompletedCard,
    buildProductionProgressCard,
} from "./pc.workflow-card";

function env(): Env {
    return {} as Env;
}

function batch(
    status: PcProductionBatch["production_status"]
): PcProductionBatch {
    return {
        record_id: "production-rec-1",
        production_id: "PROD-1",
        source_order_id: "order-rec-1",
        product_sku: "BNK-LUNA-IV-M",
        product_name: "Luna",
        reason: "MIN_STOCK",
        order_shortage_qty: 0,
        recommended_qty: 16,
        planned_qty: 16,
        actual_qty: 0,
        material_check_status:
            status === "BLOCKED_MATERIAL" ? "SHORTAGE" : "SUFFICIENT",
        production_status: status,
        material_requirement_summary: "FAB-IV 24 m",
        material_risk_summary: "FAB-IV ขาด 6 m",
        due_date: Date.now(),
        inventory_posted: false,
        inventory_posting_state_json: "",
        created_at: 100,
        completed_at: 0,
        owner: "Production",
        notes: "",
    };
}

function product(): PcProduct {
    return {
        record_id: "product-rec-1",
        sku: "BNK-LUNA-IV-M",
        product_id: "LUNA",
        style_code: "LUNA",
        product_name: "Luna",
        category: "Dress",
        color: "Ivory",
        size: "M",
        sales_price_thb: 1590,
        stock_on_hand: 4,
        min_stock: 7,
        target_stock: 20,
        stock_status: "LOW_STOCK",
        recommended_production_qty: 16,
        production_lead_days: 7,
        materials_json: JSON.stringify([
            { material_sku: "FAB-IV", quantity_per_unit: 1.5 },
        ]),
        active: true,
    };
}

function material(): PcMaterial {
    return {
        record_id: "material-rec-1",
        material_sku: "FAB-IV",
        material_name: "ผ้าสีไอวอรี่",
        unit: "m",
        stock_on_hand: 18,
        min_stock: 5,
        target_stock: 40,
        planned_requirement: 24,
        available_after_plan: -6,
        shortage_qty: 6,
        alert_level: "CRITICAL",
        recommended_reorder_qty: 22,
        source_type: "PURCHASED",
        lead_time_days: 5,
        active: true,
    };
}

describe("Production workflow cards", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listPcProduction.mockResolvedValue([]);
        mocks.listPcProducts.mockResolvedValue([product()]);
        mocks.listPcMaterials.mockResolvedValue([material()]);
        mocks.createPcWorkflowActionUrl.mockImplementation(
            async (_env: Env, input: { action: string }) =>
                `https://worker.example.com/action/${input.action}`
        );
    });

    it("always starts a low-stock flow with production approval even when material planning pre-blocked the batch", async () => {
        mocks.listPcProduction.mockResolvedValue([
            batch("BLOCKED_MATERIAL"),
        ]);

        const card = await buildPcNotificationActionCard(env(), {
            notification_type: "PC_STOCK_EXCEPTION",
            reference_id: "BNK-LUNA-IV-M",
            fallback_text: "คงเหลือ 4 ชิ้น",
        });

        expect(card).toMatchObject({
            title: "📦 สินค้าใกล้หมด",
            template: "orange",
            actions: [
                {
                    text: "อนุมัติผลิตสินค้า",
                    url: "https://worker.example.com/action/approve-production",
                },
            ],
        });
        expect(card?.markdown).toContain(
            "เมื่อกดอนุมัติ ระบบจะตรวจวัตถุดิบก่อนเริ่มผลิต"
        );
        expect(card?.actions?.[0]?.url).not.toContain("purchase-materials");
    });

    it("shows exact shortages and a purchase approval only after material shortage notification", async () => {
        mocks.listPcProduction.mockResolvedValue([
            batch("BLOCKED_MATERIAL"),
        ]);

        const card = await buildPcNotificationActionCard(env(), {
            notification_type: "PC_MATERIAL_SHORTAGE",
            reference_id: "PROD-1",
            fallback_text: "วัตถุดิบไม่พร้อม",
        });

        expect(card).toMatchObject({
            title: "🧵 วัตถุดิบไม่เพียงพอ",
            template: "red",
            actions: [
                {
                    text: "อนุมัติสั่งซื้อวัตถุดิบ",
                    url: "https://worker.example.com/action/purchase-materials",
                },
            ],
        });
        expect(card?.markdown).toContain("ต้องใช้ 24 m");
        expect(card?.markdown).toContain("มี 18 m");
        expect(card?.markdown).toContain("ขาด 6 m");
    });

    it("offers completion for a production batch already in progress", async () => {
        const card = await buildProductionProgressCard(
            env(),
            batch("IN_PROGRESS")
        );

        expect(card).toMatchObject({
            title: "🏭 เริ่มผลิตสินค้าแล้ว",
            template: "green",
            actions: [
                {
                    text: "ผลิตเสร็จครบตามแผน",
                    url: "https://worker.example.com/action/complete-production",
                },
            ],
        });
    });

    it("renders a terminal completion card without another action", () => {
        const card = buildProductionCompletedCard({
            batch: {
                ...batch("COMPLETED"),
                actual_qty: 16,
                inventory_posted: true,
            },
            actual_qty: 16,
            stock_on_hand: 20,
        });

        expect(card.title).toBe("✅ ผลิตเสร็จและรับสินค้าเข้าสต็อกแล้ว");
        expect(card.actions).toEqual([]);
        expect(card.markdown).toContain("Stock ปัจจุบัน:** 20 ชิ้น");
    });
});
