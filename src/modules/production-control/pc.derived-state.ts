import type { Env } from "../../config/env";
import {
    PC_PRODUCT_FIELDS,
    PC_PRODUCTION_FIELDS,
} from "../../core/lark-fields";
import {
    checkBatchMaterials,
    deriveProductInventory,
    normalizePcBusinessKey,
} from "./pc.logic";
import {
    batchUpdatePcProducts,
    batchUpdatePcProduction,
    listPcMaterials,
    listPcProduction,
    listPcProducts,
} from "./pc.repository";
import { refreshPcMaterialPlan } from "./pc.service";

const RECONCILABLE_PRODUCTION_STATUSES = new Set([
    "RECOMMENDED",
    "APPROVED",
    "BLOCKED_MATERIAL",
]);

/**
 * Reconcile ฟิลด์อนุพันธ์ที่อาจค้างจากข้อมูลเก่า หลัง Material Plan ถูกคำนวณแล้ว
 * - Product status/recommended qty ต้องตรงกับ Stock/Min/Target จริง
 * - แผน APPROVED ที่วัตถุดิบไม่พอต้องกลับเป็น BLOCKED_MATERIAL
 * - ไม่เปลี่ยน IN_PROGRESS อัตโนมัติ เพราะการปิดงานมี Validation แยกอยู่แล้ว
 */
export async function refreshPcDerivedState(env: Env): Promise<{
    materials_updated: number;
    material_critical_count: number;
    products_reconciled: number;
    production_reconciled: number;
}> {
    const materialResult = await refreshPcMaterialPlan(env);
    const [products, materials, production] = await Promise.all([
        listPcProducts(env),
        listPcMaterials(env),
        listPcProduction(env),
    ]);

    const productUpdates = products.flatMap((product) => {
        if (!product.active) {
            return [];
        }

        const derived = deriveProductInventory(
            product.stock_on_hand,
            product.min_stock,
            product.target_stock
        );

        if (
            product.stock_status === derived.stock_status &&
            product.recommended_production_qty ===
                derived.recommended_production_qty
        ) {
            return [];
        }

        return [
            {
                record_id: product.record_id,
                fields: {
                    [PC_PRODUCT_FIELDS.STOCK_STATUS]: derived.stock_status,
                    [PC_PRODUCT_FIELDS.RECOMMENDED_PRODUCTION_QTY]:
                        derived.recommended_production_qty,
                },
            },
        ];
    });

    await batchUpdatePcProducts(env, productUpdates);

    const productBySku = new Map(
        products.map((product) => [
            normalizePcBusinessKey(product.sku),
            product,
        ])
    );
    const productionUpdates = production.flatMap((batch) => {
        if (!RECONCILABLE_PRODUCTION_STATUSES.has(batch.production_status)) {
            return [];
        }

        const check = checkBatchMaterials({
            product:
                productBySku.get(
                    normalizePcBusinessKey(batch.product_sku)
                ) ?? null,
            planned_qty: batch.planned_qty || batch.recommended_qty,
            materials,
        });
        const nextStatus =
            check.status === "SUFFICIENT"
                ? batch.production_status === "BLOCKED_MATERIAL"
                    ? "RECOMMENDED"
                    : batch.production_status
                : "BLOCKED_MATERIAL";

        if (
            batch.material_check_status === check.status &&
            batch.material_requirement_summary ===
                check.requirement_summary &&
            batch.material_risk_summary === check.risk_summary &&
            batch.production_status === nextStatus
        ) {
            return [];
        }

        return [
            {
                record_id: batch.record_id,
                fields: {
                    [PC_PRODUCTION_FIELDS.MATERIAL_CHECK_STATUS]: check.status,
                    [PC_PRODUCTION_FIELDS.MATERIAL_REQUIREMENT_SUMMARY]:
                        check.requirement_summary,
                    [PC_PRODUCTION_FIELDS.MATERIAL_RISK_SUMMARY]:
                        check.risk_summary,
                    [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: nextStatus,
                },
            },
        ];
    });

    await batchUpdatePcProduction(env, productionUpdates);

    return {
        materials_updated: materialResult.materials_updated,
        material_critical_count: materialResult.critical_materials,
        products_reconciled: productUpdates.length,
        production_reconciled: productionUpdates.length,
    };
}
