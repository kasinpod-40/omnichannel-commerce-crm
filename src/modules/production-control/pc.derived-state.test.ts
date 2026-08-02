import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import {
    PC_PRODUCT_FIELDS,
    PC_PRODUCTION_FIELDS,
} from "../../core/lark-fields";
import type {
    PcMaterial,
    PcProduct,
    PcProductionBatch,
} from "./pc.types";

const mocks = vi.hoisted(() => ({
    refreshPcMaterialPlan: vi.fn(),
    listPcProducts: vi.fn(),
    listPcMaterials: vi.fn(),
    listPcProduction: vi.fn(),
    batchUpdatePcProducts: vi.fn(),
    batchUpdatePcProduction: vi.fn(),
}));

vi.mock("./pc.service", () => ({
    refreshPcMaterialPlan: mocks.refreshPcMaterialPlan,
}));

vi.mock("./pc.repository", () => ({
    listPcProducts: mocks.listPcProducts,
    listPcMaterials: mocks.listPcMaterials,
    listPcProduction: mocks.listPcProduction,
    batchUpdatePcProducts: mocks.batchUpdatePcProducts,
    batchUpdatePcProduction: mocks.batchUpdatePcProduction,
}));

import { refreshPcDerivedState } from "./pc.derived-state";

function env(): Env {
    return {} as Env;
}

function product(overrides: Partial<PcProduct> = {}): PcProduct {
    return {
        record_id: "product-rec-1",
        sku: "BNK-LUNA-IV-S",
        product_id: "LUNA-IV-S",
        style_code: "LUNA",
        product_name: "Luna Ivory S",
        category: "CARDIGAN",
        color: "IVORY",
        size: "S",
        sales_price_thb: 1490,
        stock_on_hand: 8,
        min_stock: 6,
        target_stock: 23,
        stock_status: "LOW_STOCK",
        recommended_production_qty: 15,
        production_lead_days: 7,
        materials_json: JSON.stringify([
            {
                material_sku: "FAB-TWEED-IVORY",
                quantity_per_unit: 1.8,
                unit: "m",
            },
        ]),
        active: true,
        ...overrides,
    };
}

function material(overrides: Partial<PcMaterial> = {}): PcMaterial {
    return {
        record_id: "material-rec-1",
        material_sku: "FAB_TWEED_IVORY",
        material_name: "ผ้าทวีดสีไอวอรี",
        category: "FABRIC",
        unit: "m",
        source_type: "IMPORT",
        supplier_name: "Supplier",
        supplier_country: "CN",
        lead_time_days: 45,
        stock_on_hand: 0,
        min_stock: 100,
        target_stock: 260,
        planned_requirement: 53.9,
        projected_stock: -53.9,
        shortage_qty: 53.9,
        material_status: "OUT_OF_STOCK",
        recommended_reorder_qty: 313.9,
        alert_level: "CRITICAL",
        active: true,
        notes: "",
        ...overrides,
    };
}

function production(
    overrides: Partial<PcProductionBatch> = {}
): PcProductionBatch {
    return {
        record_id: "production-rec-1",
        production_id: "PROD-20260801-001",
        source_order_id: "order-rec-1",
        product_sku: "BNK_LUNA_IV_S",
        product_name: "Luna Ivory S",
        reason: "MIN_STOCK",
        order_shortage_qty: 0,
        recommended_qty: 12,
        planned_qty: 12,
        actual_qty: 0,
        material_check_status: "INSUFFICIENT",
        production_status: "APPROVED",
        material_requirement_summary: "FAB-TWEED-IVORY 21.6 m",
        material_risk_summary: "FAB-TWEED-IVORY ขาด 21.6 m",
        due_date: 0,
        inventory_posted: false,
        inventory_posting_state_json: "",
        created_at: 1,
        completed_at: 0,
        owner: "Manager",
        notes: "",
        ...overrides,
    };
}

describe("Production Control derived-state reconciliation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.refreshPcMaterialPlan.mockResolvedValue({
            materials_updated: 23,
            production_updated: 8,
            critical_materials: 4,
        });
        mocks.listPcProducts.mockResolvedValue([product()]);
        mocks.listPcMaterials.mockResolvedValue([material()]);
        mocks.listPcProduction.mockResolvedValue([
            production(),
            production({
                record_id: "production-rec-in-progress",
                production_id: "PROD-IN-PROGRESS",
                production_status: "IN_PROGRESS",
            }),
        ]);
        mocks.batchUpdatePcProducts.mockResolvedValue(undefined);
        mocks.batchUpdatePcProduction.mockResolvedValue(undefined);
    });

    it("reconciles stale product status and blocks an approved insufficient batch", async () => {
        const result = await refreshPcDerivedState(env());

        expect(mocks.refreshPcMaterialPlan).toHaveBeenCalledTimes(1);
        expect(
            mocks.refreshPcMaterialPlan.mock.invocationCallOrder[0]
        ).toBeLessThan(mocks.listPcProducts.mock.invocationCallOrder[0]);
        expect(mocks.batchUpdatePcProducts).toHaveBeenCalledWith(env(), [
            {
                record_id: "product-rec-1",
                fields: {
                    [PC_PRODUCT_FIELDS.STOCK_STATUS]: "NORMAL",
                    [PC_PRODUCT_FIELDS.RECOMMENDED_PRODUCTION_QTY]: 0,
                },
            },
        ]);
        expect(mocks.batchUpdatePcProduction).toHaveBeenCalledWith(env(), [
            {
                record_id: "production-rec-1",
                fields: {
                    [PC_PRODUCTION_FIELDS.MATERIAL_CHECK_STATUS]:
                        "INSUFFICIENT",
                    [PC_PRODUCTION_FIELDS.MATERIAL_REQUIREMENT_SUMMARY]:
                        "FAB-TWEED-IVORY 21.6 m",
                    [PC_PRODUCTION_FIELDS.MATERIAL_RISK_SUMMARY]:
                        "FAB_TWEED_IVORY: แผนผลิตรวมขาด 53.9 m",
                    [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]:
                        "BLOCKED_MATERIAL",
                },
            },
        ]);
        expect(result).toEqual({
            materials_updated: 23,
            material_critical_count: 4,
            products_reconciled: 1,
            production_reconciled: 1,
        });
    });

    it("does not auto-block an in-progress batch", async () => {
        mocks.listPcProducts.mockResolvedValue([
            product({
                stock_status: "NORMAL",
                recommended_production_qty: 0,
            }),
        ]);
        mocks.listPcProduction.mockResolvedValue([
            production({
                production_status: "IN_PROGRESS",
            }),
        ]);

        const result = await refreshPcDerivedState(env());

        expect(mocks.batchUpdatePcProducts).toHaveBeenCalledWith(env(), []);
        expect(mocks.batchUpdatePcProduction).toHaveBeenCalledWith(env(), []);
        expect(result.products_reconciled).toBe(0);
        expect(result.production_reconciled).toBe(0);
    });
});
