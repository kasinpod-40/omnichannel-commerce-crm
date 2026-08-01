import { describe, expect, it } from "vitest";
import {
    allocationFingerprint,
    allocationsFromState,
    buildProductTransitions,
    checkBatchMaterials,
    deriveAutomaticProductionNeed,
    deriveMaterialInventory,
    deriveProductInventory,
    normalizeAllocations,
    parseBom,
    productionMaterialRequirements,
} from "./pc.logic";
import type {
    PcMaterial,
    PcProduct,
    PcProductionBatch,
} from "./pc.types";

function product(
    overrides: Partial<PcProduct> = {}
): PcProduct {
    return {
        record_id: "product-rec-1",
        sku: "BNK-LUNA-IV-M",
        product_id: "LUNA-IV-M",
        style_code: "LUNA",
        product_name: "Luna Shirt",
        category: "SHIRT",
        color: "IVORY",
        size: "M",
        sales_price_thb: 1_290,
        stock_on_hand: 10,
        min_stock: 5,
        target_stock: 20,
        stock_status: "NORMAL",
        recommended_production_qty: 0,
        production_lead_days: 7,
        materials_json: JSON.stringify([
            {
                material_sku: "FAB-IV",
                quantity_per_unit: 1.5,
                unit: "m",
            },
            {
                material_sku: "BTN-WH",
                quantity_per_unit: 4,
                unit: "pcs",
            },
        ]),
        active: true,
        ...overrides,
    };
}

function material(
    overrides: Partial<PcMaterial> = {}
): PcMaterial {
    return {
        record_id: "material-rec-1",
        material_sku: "FAB-IV",
        material_name: "Ivory Fabric",
        category: "FABRIC",
        unit: "m",
        source_type: "DOMESTIC",
        supplier_name: "Supplier",
        supplier_country: "TH",
        lead_time_days: 7,
        stock_on_hand: 100,
        min_stock: 20,
        target_stock: 150,
        planned_requirement: 0,
        projected_stock: 100,
        shortage_qty: 0,
        material_status: "NORMAL",
        recommended_reorder_qty: 0,
        alert_level: "NONE",
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
        production_id: "PC-STOCK-1",
        source_order_id: "order-rec-1",
        product_sku: "BNK-LUNA-IV-M",
        product_name: "Luna Shirt",
        reason: "MIN_STOCK",
        order_shortage_qty: 0,
        recommended_qty: 10,
        planned_qty: 10,
        actual_qty: 0,
        material_check_status: "SUFFICIENT",
        production_status: "RECOMMENDED",
        material_requirement_summary: "",
        material_risk_summary: "",
        due_date: 0,
        inventory_posted: false,
        inventory_posting_state_json: "",
        created_at: 1,
        completed_at: 0,
        owner: "Unassigned",
        notes: "",
        ...overrides,
    };
}

describe("Production & Stock pure logic", () => {
    it("recommends replenishment to target when stock reaches min", () => {
        expect(deriveProductInventory(5, 5, 20)).toEqual({
            stock_status: "LOW_STOCK",
            recommended_production_qty: 15,
        });
        expect(deriveProductInventory(-2, 5, 20)).toEqual({
            stock_status: "OUT_OF_STOCK",
            recommended_production_qty: 22,
        });
        expect(deriveProductInventory(6, 5, 20)).toEqual({
            stock_status: "NORMAL",
            recommended_production_qty: 0,
        });
    });

    it("subtracts already approved or in-progress production from a new recommendation", () => {
        expect(
            deriveAutomaticProductionNeed({
                stock_on_hand: 3,
                min_stock: 5,
                target_stock: 20,
                committed_production_qty: 10,
            })
        ).toBe(7);
        expect(
            deriveAutomaticProductionNeed({
                stock_on_hand: 3,
                min_stock: 5,
                target_stock: 20,
                committed_production_qty: 17,
            })
        ).toBe(0);
        expect(
            deriveAutomaticProductionNeed({
                stock_on_hand: 6,
                min_stock: 5,
                target_stock: 20,
                committed_production_qty: 0,
            })
        ).toBe(0);
    });

    it("derives import material shortage as critical", () => {
        expect(
            deriveMaterialInventory({
                stock_on_hand: 20,
                min_stock: 10,
                target_stock: 60,
                planned_requirement: 25,
                source_type: "IMPORT",
                lead_time_days: 45,
            })
        ).toEqual({
            projected_stock: -5,
            shortage_qty: 5,
            material_status: "OUT_OF_STOCK",
            recommended_reorder_qty: 65,
            alert_level: "CRITICAL",
        });
    });

    it("parses and aggregates duplicate BOM lines without losing units", () => {
        expect(
            parseBom(
                JSON.stringify([
                    {
                        material_sku: "FAB-IV",
                        quantity_per_unit: 1.25,
                        unit: "m",
                    },
                    {
                        material_sku: "fab-iv",
                        quantity_per_unit: 0.25,
                        unit: "m",
                    },
                ])
            )
        ).toEqual([
            {
                material_sku: "FAB-IV",
                quantity_per_unit: 1.5,
                unit: "m",
            },
        ]);
    });

    it("rejects malformed or conflicting BOM data", () => {
        expect(() => parseBom("not-json")).toThrow(
            "PC_BOM_INVALID_JSON"
        );
        expect(() =>
            parseBom(
                JSON.stringify([
                    {
                        material_sku: "FAB-IV",
                        quantity_per_unit: 1,
                        unit: "m",
                    },
                    {
                        material_sku: "FAB-IV",
                        quantity_per_unit: 1,
                        unit: "kg",
                    },
                ])
            )
        ).toThrow("PC_BOM_UNIT_CONFLICT");
    });

    it("aggregates duplicate order allocations and produces a stable fingerprint", () => {
        const allocations = normalizeAllocations([
            { sku: "BNK-LUNA-IV-M", quantity: 1 },
            { sku: "bnk-luna-iv-m", quantity: 2 },
        ]);

        expect(allocations).toEqual([
            { sku: "BNK-LUNA-IV-M", quantity: 3 },
        ]);
        expect(allocationFingerprint(allocations)).toBe(
            "bnk-luna-iv-m:3"
        );
    });

    it("preserves the last applied allocation when a later reconcile is blocked", () => {
        expect(
            allocationsFromState({
                version: 1,
                phase: "blocked",
                fingerprint: "",
                order_record_id: "order-rec-1",
                order_number: "ORD-1",
                allocations: [{ sku: "NEW-SKU", quantity: 1 }],
                previous_allocations: [
                    { sku: "BNK-LUNA-IV-M", quantity: 2 },
                ],
                transitions: [],
                prepared_at: 1,
                error_code: "PC_PRODUCT_NOT_FOUND",
            })
        ).toEqual([{ sku: "BNK-LUNA-IV-M", quantity: 2 }]);
    });

    it("builds reversible product stock transitions for edits and cancellations", () => {
        const first = buildProductTransitions({
            products: [product({ stock_on_hand: 10 })],
            previous_allocations: [],
            target_allocations: [
                { sku: "BNK-LUNA-IV-M", quantity: 3 },
            ],
        });

        expect(first[0]).toMatchObject({
            delta_allocated_qty: 3,
            old_stock_on_hand: 10,
            new_stock_on_hand: 7,
        });

        const released = buildProductTransitions({
            products: [product({ stock_on_hand: 7 })],
            previous_allocations: [
                { sku: "BNK-LUNA-IV-M", quantity: 3 },
            ],
            target_allocations: [],
        });

        expect(released[0]).toMatchObject({
            delta_allocated_qty: -3,
            old_stock_on_hand: 7,
            new_stock_on_hand: 10,
        });
    });

    it("calculates material demand across open batches only", () => {
        const requirements = productionMaterialRequirements(
            [
                production({ planned_qty: 10 }),
                production({
                    record_id: "production-rec-2",
                    production_id: "PC-STOCK-2",
                    planned_qty: 5,
                    production_status: "APPROVED",
                }),
                production({
                    record_id: "production-rec-3",
                    production_id: "PC-STOCK-3",
                    planned_qty: 100,
                    production_status: "CANCELLED",
                }),
            ],
            [product()]
        );

        expect(requirements.get("fab-iv")).toBe(22.5);
        expect(requirements.get("btn-wh")).toBe(60);
    });

    it("blocks a batch when the global material plan is short", () => {
        const check = checkBatchMaterials({
            product: product(),
            planned_qty: 10,
            materials: [
                material({
                    planned_requirement: 120,
                    projected_stock: -20,
                    shortage_qty: 20,
                    material_status: "OUT_OF_STOCK",
                    alert_level: "CRITICAL",
                }),
                material({
                    record_id: "material-rec-2",
                    material_sku: "BTN-WH",
                    material_name: "White Button",
                    unit: "pcs",
                    stock_on_hand: 500,
                    projected_stock: 460,
                }),
            ],
        });

        expect(check.status).toBe("INSUFFICIENT");
        expect(check.requirement_summary).toContain("FAB-IV 15 m");
        expect(check.risk_summary).toContain("แผนผลิตรวมขาด 20 m");
    });
});
