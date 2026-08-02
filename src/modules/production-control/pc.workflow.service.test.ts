import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { PC_MATERIAL_FIELDS } from "../../core/lark-fields";
import { OperationalError } from "../../utils/errors";
import type {
    PcMaterial,
    PcProduct,
    PcProductionBatch,
} from "./pc.types";

const mocks = vi.hoisted(() => ({
    assertPcInventoryEnabled: vi.fn(),
    batchUpdatePcMaterials: vi.fn(),
    getPcProductionByRecordId: vi.fn(),
    listPcMaterials: vi.fn(),
    listPcProducts: vi.fn(),
    completePcProduction: vi.fn(),
    refreshPcMaterialPlan: vi.fn(),
    updatePcProductionStatus: vi.fn(),
    sendPcLarkActionCard: vi.fn(),
    buildPcNotificationActionCard: vi.fn(),
    buildProductionCompletedCard: vi.fn(),
    buildProductionProgressCard: vi.fn(),
}));

vi.mock("./pc.repository", () => ({
    assertPcInventoryEnabled: mocks.assertPcInventoryEnabled,
    batchUpdatePcMaterials: mocks.batchUpdatePcMaterials,
    getPcProductionByRecordId: mocks.getPcProductionByRecordId,
    listPcMaterials: mocks.listPcMaterials,
    listPcProducts: mocks.listPcProducts,
}));

vi.mock("./pc.service", () => ({
    completePcProduction: mocks.completePcProduction,
    refreshPcMaterialPlan: mocks.refreshPcMaterialPlan,
    updatePcProductionStatus: mocks.updatePcProductionStatus,
}));

vi.mock("./pc.lark-card", () => ({
    sendPcLarkActionCard: mocks.sendPcLarkActionCard,
}));

vi.mock("./pc.workflow-card", () => ({
    buildPcNotificationActionCard: mocks.buildPcNotificationActionCard,
    buildProductionCompletedCard: mocks.buildProductionCompletedCard,
    buildProductionProgressCard: mocks.buildProductionProgressCard,
}));

import { runPcWorkflowAction } from "./pc.workflow.service";

function env(demo = true): Env {
    return {
        PC_INVENTORY_ENABLED: "true",
        PC_DEMO_SHOP_ENABLED: demo ? "true" : "false",
    } as Env;
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
        actual_qty: status === "COMPLETED" ? 16 : 0,
        material_check_status:
            status === "BLOCKED_MATERIAL" ? "INSUFFICIENT" : "SUFFICIENT",
        production_status: status,
        material_requirement_summary: "FAB-IV 24 m",
        material_risk_summary: "FAB-IV ขาด 6 m",
        due_date: Date.now(),
        inventory_posted: status === "COMPLETED",
        inventory_posting_state_json: "",
        created_at: 1,
        completed_at: status === "COMPLETED" ? Date.now() : 0,
        owner: "Production",
        notes: "",
    };
}

function product(stockOnHand = 4): PcProduct {
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
        stock_on_hand: stockOnHand,
        min_stock: 7,
        target_stock: 20,
        stock_status: stockOnHand <= 7 ? "LOW_STOCK" : "NORMAL",
        recommended_production_qty: Math.max(0, 20 - stockOnHand),
        production_lead_days: 7,
        materials_json: JSON.stringify([
            {
                material_sku: "FAB-IV",
                quantity_per_unit: 1.5,
                unit: "m",
            },
        ]),
        active: true,
    };
}

function material(): PcMaterial {
    return {
        record_id: "material-rec-1",
        material_sku: "FAB-IV",
        material_name: "ผ้าสีไอวอรี่",
        category: "Fabric",
        unit: "m",
        source_type: "DOMESTIC",
        supplier_name: "Demo Supplier",
        supplier_country: "Thailand",
        lead_time_days: 5,
        stock_on_hand: 18,
        min_stock: 5,
        target_stock: 40,
        planned_requirement: 24,
        projected_stock: -6,
        shortage_qty: 6,
        material_status: "OUT_OF_STOCK",
        recommended_reorder_qty: 22,
        alert_level: "CRITICAL",
        active: true,
        notes: "",
    };
}

describe("Production workflow service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getPcProductionByRecordId.mockResolvedValue(
            batch("RECOMMENDED")
        );
        mocks.listPcProducts.mockResolvedValue([product()]);
        mocks.listPcMaterials.mockResolvedValue([material()]);
        mocks.refreshPcMaterialPlan.mockResolvedValue({
            materials_updated: 1,
            production_updated: 1,
            critical_materials: 0,
        });
        mocks.buildProductionProgressCard.mockResolvedValue({
            title: "progress",
            markdown: "progress",
            actions: [],
        });
        mocks.buildPcNotificationActionCard.mockResolvedValue({
            title: "shortage",
            markdown: "shortage",
            actions: [],
        });
        mocks.buildProductionCompletedCard.mockReturnValue({
            title: "completed",
            markdown: "completed",
            actions: [],
        });
    });

    it("approves, starts and sends a progress card when materials are sufficient", async () => {
        mocks.updatePcProductionStatus
            .mockResolvedValueOnce(batch("APPROVED"))
            .mockResolvedValueOnce(batch("IN_PROGRESS"));

        const result = await runPcWorkflowAction(env(), {
            action: "approve-production",
            production_record_id: "production-rec-1",
            actor_name: "Manager A",
        });

        expect(mocks.updatePcProductionStatus).toHaveBeenNthCalledWith(
            1,
            env(),
            {
                production_record_id: "production-rec-1",
                action: "approve",
                owner: "Manager A",
            }
        );
        expect(mocks.updatePcProductionStatus).toHaveBeenNthCalledWith(
            2,
            env(),
            {
                production_record_id: "production-rec-1",
                action: "start",
                owner: "Manager A",
            }
        );
        expect(mocks.sendPcLarkActionCard).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            production_status: "IN_PROGRESS",
            message: "อนุมัติและเริ่มผลิตสินค้าแล้ว",
            duplicate: false,
        });
    });

    it("keeps the batch blocked and sends a material purchase card after approval finds a shortage", async () => {
        mocks.getPcProductionByRecordId
            .mockResolvedValueOnce(batch("BLOCKED_MATERIAL"))
            .mockResolvedValueOnce(batch("BLOCKED_MATERIAL"));
        mocks.updatePcProductionStatus.mockRejectedValueOnce(
            new OperationalError(
                "PC_PRODUCTION_MATERIAL_BLOCKED",
                "FAB-IV ขาด 6 m",
                { retryable: false, status: 409 }
            )
        );

        const result = await runPcWorkflowAction(env(), {
            action: "approve-production",
            production_record_id: "production-rec-1",
            actor_name: "Manager A",
        });

        expect(mocks.buildPcNotificationActionCard).toHaveBeenCalledWith(
            env(),
            expect.objectContaining({
                notification_type: "PC_MATERIAL_SHORTAGE",
                reference_id: "PROD-1",
            })
        );
        expect(mocks.sendPcLarkActionCard).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({
            production_status: "BLOCKED_MATERIAL",
            message: "ยังเริ่มผลิตไม่ได้ เนื่องจากวัตถุดิบไม่เพียงพอ",
        });
    });

    it("simulates material receipt in Demo, refreshes material planning and resumes production", async () => {
        mocks.getPcProductionByRecordId
            .mockResolvedValueOnce(batch("BLOCKED_MATERIAL"))
            .mockResolvedValueOnce(batch("RECOMMENDED"));
        mocks.updatePcProductionStatus
            .mockResolvedValueOnce(batch("APPROVED"))
            .mockResolvedValueOnce(batch("IN_PROGRESS"));

        const result = await runPcWorkflowAction(env(), {
            action: "purchase-materials",
            production_record_id: "production-rec-1",
            actor_name: "Manager A",
        });

        expect(mocks.batchUpdatePcMaterials).toHaveBeenCalledWith(env(), [
            {
                record_id: "material-rec-1",
                fields: {
                    [PC_MATERIAL_FIELDS.STOCK_ON_HAND]: 40,
                },
            },
        ]);
        expect(mocks.refreshPcMaterialPlan).toHaveBeenCalledTimes(1);
        expect(mocks.updatePcProductionStatus).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({
            production_status: "IN_PROGRESS",
            message: "จำลองรับวัตถุดิบเข้าและเริ่มผลิตต่อแล้ว",
            materials_replenished: [
                {
                    material_sku: "FAB-IV",
                    added_qty: 22,
                    stock_after: 40,
                    unit: "m",
                },
            ],
            duplicate: false,
        });
    });

    it("never allows simulated material receipt outside Demo Shop", async () => {
        mocks.getPcProductionByRecordId.mockResolvedValue(
            batch("BLOCKED_MATERIAL")
        );

        await expect(
            runPcWorkflowAction(env(false), {
                action: "purchase-materials",
                production_record_id: "production-rec-1",
                actor_name: "Manager A",
            })
        ).rejects.toMatchObject({
            code: "PC_DEMO_MATERIAL_PURCHASE_DISABLED",
            status: 403,
        });
        expect(mocks.batchUpdatePcMaterials).not.toHaveBeenCalled();
    });

    it("completes through the existing idempotent stock posting flow and reports finished stock", async () => {
        mocks.getPcProductionByRecordId
            .mockResolvedValueOnce(batch("IN_PROGRESS"))
            .mockResolvedValueOnce(batch("COMPLETED"));
        mocks.completePcProduction.mockResolvedValue({
            production_record_id: "production-rec-1",
            production_id: "PROD-1",
            actual_qty: 16,
            duplicate: false,
            inventory_posted: true,
        });
        mocks.listPcProducts.mockResolvedValue([product(20)]);

        const result = await runPcWorkflowAction(env(), {
            action: "complete-production",
            production_record_id: "production-rec-1",
            actor_name: "Manager A",
        });

        expect(mocks.completePcProduction).toHaveBeenCalledWith(env(), {
            production_record_id: "production-rec-1",
            actual_qty: 16,
            idempotency_key:
                "lark-workflow-complete:production-rec-1",
            owner: "Manager A",
        });
        expect(result).toMatchObject({
            production_status: "COMPLETED",
            product_stock_on_hand: 20,
            duplicate: false,
        });
        expect(mocks.sendPcLarkActionCard).toHaveBeenCalledTimes(1);
    });

    it("treats a repeated completion click as a duplicate without posting stock again", async () => {
        mocks.getPcProductionByRecordId.mockResolvedValue(
            batch("COMPLETED")
        );
        mocks.listPcProducts.mockResolvedValue([product(20)]);

        const result = await runPcWorkflowAction(env(), {
            action: "complete-production",
            production_record_id: "production-rec-1",
            actor_name: "Manager A",
        });

        expect(mocks.completePcProduction).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            production_status: "COMPLETED",
            product_stock_on_hand: 20,
            duplicate: true,
        });
    });
});
