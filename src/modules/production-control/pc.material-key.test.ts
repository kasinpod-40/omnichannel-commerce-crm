import { describe, expect, it } from "vitest";
import {
    checkBatchMaterials,
    normalizePcBusinessKey,
    parseBom,
    productionMaterialRequirements,
} from "./pc.logic";
import type {
    PcMaterial,
    PcProduct,
    PcProductionBatch,
} from "./pc.types";

function product(overrides: Partial<PcProduct> = {}): PcProduct {
    return {
        record_id: "product-rec-luna-s",
        sku: "BNK-LUNA-IV-S",
        product_id: "LUNA-IV-S",
        style_code: "LUNA",
        product_name: "Luna Ivory S",
        category: "CARDIGAN",
        color: "IVORY",
        size: "S",
        sales_price_thb: 1490,
        stock_on_hand: 8,
        min_stock: 8,
        target_stock: 20,
        stock_status: "LOW_STOCK",
        recommended_production_qty: 12,
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

function production(
    overrides: Partial<PcProductionBatch> = {}
): PcProductionBatch {
    return {
        record_id: "production-rec-luna-s",
        production_id: "PC-STOCK-YZFEBX",
        source_order_id: "order-rec-1",
        product_sku: "BNK_LUNA_IV_S",
        product_name: "Luna Ivory S",
        reason: "MIN_STOCK",
        order_shortage_qty: 0,
        recommended_qty: 12,
        planned_qty: 12,
        actual_qty: 0,
        material_check_status: "INSUFFICIENT",
        production_status: "BLOCKED_MATERIAL",
        material_requirement_summary: "",
        material_risk_summary: "",
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

function material(overrides: Partial<PcMaterial> = {}): PcMaterial {
    return {
        record_id: "material-rec-tweed",
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
        planned_requirement: 21.6,
        projected_stock: -21.6,
        shortage_qty: 21.6,
        material_status: "OUT_OF_STOCK",
        recommended_reorder_qty: 281.6,
        alert_level: "CRITICAL",
        active: true,
        notes: "",
        ...overrides,
    };
}

describe("Production Control business-key normalization", () => {
    it("normalizes common SKU separators to one shared key", () => {
        const expected = "fab tweed ivory";

        expect(normalizePcBusinessKey("FAB-TWEED-IVORY")).toBe(expected);
        expect(normalizePcBusinessKey("FAB_TWEED_IVORY")).toBe(expected);
        expect(normalizePcBusinessKey("FAB/TWEED/IVORY")).toBe(expected);
        expect(normalizePcBusinessKey("FAB.TWEED.IVORY")).toBe(expected);
    });

    it("aggregates BOM aliases that use different separators", () => {
        expect(
            parseBom(
                JSON.stringify([
                    {
                        material_sku: "FAB-TWEED-IVORY",
                        quantity_per_unit: 1.5,
                        unit: "m",
                    },
                    {
                        material_sku: "FAB_TWEED_IVORY",
                        quantity_per_unit: 0.3,
                        unit: "m",
                    },
                ])
            )
        ).toEqual([
            {
                material_sku: "FAB-TWEED-IVORY",
                quantity_per_unit: 1.8,
                unit: "m",
            },
        ]);
    });

    it("maps a hyphenated BOM to the same material-plan key used by refresh", () => {
        const requirements = productionMaterialRequirements(
            [production()],
            [product()]
        );

        expect(
            requirements.get(normalizePcBusinessKey("FAB-TWEED-IVORY"))
        ).toBe(21.6);
        expect(
            requirements.get(normalizePcBusinessKey("FAB_TWEED_IVORY"))
        ).toBe(21.6);
    });

    it("matches the material record even when its separator differs from the BOM", () => {
        const result = checkBatchMaterials({
            product: product(),
            planned_qty: 12,
            materials: [material()],
        });

        expect(result.status).toBe("INSUFFICIENT");
        expect(result.requirement_summary).toContain(
            "FAB-TWEED-IVORY 21.6 m"
        );
        expect(result.risk_summary).toContain("แผนผลิตรวมขาด 21.6 m");
        expect(result.risk_summary).not.toContain("ไม่พบวัตถุดิบ");
    });
});
