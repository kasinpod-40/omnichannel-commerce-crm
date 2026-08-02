import type { Env } from "../../config/env";
import { PC_MATERIAL_FIELDS } from "../../core/lark-fields";
import { OperationalError } from "../../utils/errors";
import { normalizePcBusinessKey, parseBom } from "./pc.logic";
import {
    assertPcInventoryEnabled,
    batchUpdatePcMaterials,
    getPcProductionByRecordId,
    listPcMaterials,
    listPcProducts,
} from "./pc.repository";
import {
    completePcProduction,
    refreshPcMaterialPlan,
    updatePcProductionStatus,
} from "./pc.service";
import type {
    PcMaterial,
    PcProduct,
    PcProductionBatch,
} from "./pc.types";
import type { PcWorkflowAction } from "./pc.action-token";
import { sendPcLarkActionCard } from "./pc.lark-card";
import {
    buildPcNotificationActionCard,
    buildProductionCompletedCard,
    buildProductionProgressCard,
} from "./pc.workflow-card";

export type PcWorkflowActionResult = {
    ok: true;
    action: PcWorkflowAction;
    production_record_id: string;
    production_id: string;
    production_status: PcProductionBatch["production_status"];
    message: string;
    materials_replenished: Array<{
        material_sku: string;
        added_qty: number;
        stock_after: number;
        unit: string;
    }>;
    product_stock_on_hand?: number;
    duplicate: boolean;
};

function workflowError(
    code: string,
    message: string,
    status = 422
): OperationalError {
    return new OperationalError(code, message, {
        retryable: false,
        status,
    });
}

function roundQuantity(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

function plannedQuantity(batch: PcProductionBatch): number {
    return roundQuantity(
        Math.max(0, batch.planned_qty || batch.recommended_qty)
    );
}

async function requireBatch(
    env: Env,
    recordId: string
): Promise<PcProductionBatch> {
    const batch = await getPcProductionByRecordId(env, recordId.trim());
    if (!batch) {
        throw workflowError(
            "PC_PRODUCTION_NOT_FOUND",
            "ไม่พบแผนผลิตนี้",
            404
        );
    }
    return batch;
}

function findProduct(
    products: PcProduct[],
    batch: PcProductionBatch
): PcProduct {
    const key = normalizePcBusinessKey(batch.product_sku);
    const product = products.find(
        (item) => normalizePcBusinessKey(item.sku) === key
    );
    if (!product) {
        throw workflowError(
            "PC_PRODUCTION_PRODUCT_NOT_FOUND",
            `ไม่พบสินค้า ${batch.product_sku}`
        );
    }
    return product;
}

async function sendCurrentWorkflowCard(
    env: Env,
    batch: PcProductionBatch
): Promise<void> {
    if (batch.production_status === "BLOCKED_MATERIAL") {
        const card = await buildPcNotificationActionCard(env, {
            notification_type: "PC_MATERIAL_SHORTAGE",
            reference_id: batch.production_id || batch.record_id,
            fallback_text: batch.material_risk_summary || "วัตถุดิบไม่เพียงพอ",
        });
        if (card) await sendPcLarkActionCard(env, card);
        return;
    }

    if (
        batch.production_status === "APPROVED" ||
        batch.production_status === "IN_PROGRESS"
    ) {
        await sendPcLarkActionCard(
            env,
            await buildProductionProgressCard(env, batch)
        );
    }
}

async function approveAndStart(
    env: Env,
    batch: PcProductionBatch,
    owner: string
): Promise<PcWorkflowActionResult> {
    if (batch.production_status === "COMPLETED" || batch.inventory_posted) {
        return {
            ok: true,
            action: "approve-production",
            production_record_id: batch.record_id,
            production_id: batch.production_id,
            production_status: "COMPLETED",
            message: "แผนผลิตนี้ผลิตเสร็จแล้ว",
            materials_replenished: [],
            duplicate: true,
        };
    }

    if (batch.production_status === "IN_PROGRESS") {
        return {
            ok: true,
            action: "approve-production",
            production_record_id: batch.record_id,
            production_id: batch.production_id,
            production_status: batch.production_status,
            message: "แผนผลิตนี้กำลังผลิตอยู่แล้ว",
            materials_replenished: [],
            duplicate: true,
        };
    }

    try {
        const approved = await updatePcProductionStatus(env, {
            production_record_id: batch.record_id,
            action: "approve",
            owner,
        });
        const started = await updatePcProductionStatus(env, {
            production_record_id: approved.record_id,
            action: "start",
            owner,
        });
        await sendCurrentWorkflowCard(env, started);

        return {
            ok: true,
            action: "approve-production",
            production_record_id: started.record_id,
            production_id: started.production_id,
            production_status: started.production_status,
            message: "อนุมัติและเริ่มผลิตสินค้าแล้ว",
            materials_replenished: [],
            duplicate: false,
        };
    } catch (error) {
        if (
            error instanceof OperationalError &&
            error.code === "PC_PRODUCTION_MATERIAL_BLOCKED"
        ) {
            // updatePcProductionStatus บันทึก BLOCKED_MATERIAL และส่ง
            // PC_MATERIAL_SHORTAGE ผ่าน notifyPcExceptionOnce แล้ว จึงไม่ส่ง Card ซ้ำที่นี่
            const blocked = await requireBatch(env, batch.record_id);
            return {
                ok: true,
                action: "approve-production",
                production_record_id: blocked.record_id,
                production_id: blocked.production_id,
                production_status: blocked.production_status,
                message: "ยังเริ่มผลิตไม่ได้ เนื่องจากวัตถุดิบไม่เพียงพอ",
                materials_replenished: [],
                duplicate: false,
            };
        }
        throw error;
    }
}

function replenishmentForMaterial(input: {
    material: PcMaterial;
    requiredForBatch: number;
}): number {
    const batchShortage = Math.max(
        0,
        input.requiredForBatch - input.material.stock_on_hand
    );
    const targetGap = Math.max(
        0,
        input.material.target_stock - input.material.stock_on_hand
    );
    return roundQuantity(
        Math.max(
            0,
            input.material.recommended_reorder_qty,
            input.material.shortage_qty,
            batchShortage,
            targetGap
        )
    );
}

async function purchaseMaterialsAndStart(
    env: Env,
    batch: PcProductionBatch,
    owner: string
): Promise<PcWorkflowActionResult> {
    if (env.PC_DEMO_SHOP_ENABLED?.trim().toLowerCase() !== "true") {
        throw workflowError(
            "PC_DEMO_MATERIAL_PURCHASE_DISABLED",
            "การจำลองรับวัตถุดิบเปิดใช้ได้เฉพาะ Demo Shop",
            403
        );
    }

    if (batch.production_status === "IN_PROGRESS") {
        return {
            ok: true,
            action: "purchase-materials",
            production_record_id: batch.record_id,
            production_id: batch.production_id,
            production_status: batch.production_status,
            message: "วัตถุดิบพร้อมและแผนผลิตกำลังดำเนินการอยู่แล้ว",
            materials_replenished: [],
            duplicate: true,
        };
    }

    if (batch.production_status === "APPROVED") {
        const started = await updatePcProductionStatus(env, {
            production_record_id: batch.record_id,
            action: "start",
            owner,
        });
        await sendCurrentWorkflowCard(env, started);
        return {
            ok: true,
            action: "purchase-materials",
            production_record_id: started.record_id,
            production_id: started.production_id,
            production_status: started.production_status,
            message: "วัตถุดิบพร้อมและเริ่มผลิตแล้ว",
            materials_replenished: [],
            duplicate: true,
        };
    }

    if (batch.production_status === "COMPLETED" || batch.inventory_posted) {
        return {
            ok: true,
            action: "purchase-materials",
            production_record_id: batch.record_id,
            production_id: batch.production_id,
            production_status: "COMPLETED",
            message: "แผนผลิตนี้ผลิตเสร็จแล้ว",
            materials_replenished: [],
            duplicate: true,
        };
    }

    const [products, materials] = await Promise.all([
        listPcProducts(env),
        listPcMaterials(env),
    ]);
    const product = findProduct(products, batch);
    let bom;
    try {
        bom = parseBom(product.materials_json);
    } catch {
        throw workflowError(
            "PC_PRODUCTION_BOM_INVALID",
            `สูตรวัตถุดิบของ ${product.sku} ไม่ถูกต้อง`
        );
    }
    if (bom.length === 0) {
        throw workflowError(
            "PC_PRODUCTION_BOM_MISSING",
            `ยังไม่มีสูตรวัตถุดิบของ ${product.sku}`
        );
    }

    const materialBySku = new Map(
        materials.map((material) => [
            normalizePcBusinessKey(material.material_sku),
            material,
        ])
    );
    const planned = plannedQuantity(batch);
    const replenished: PcWorkflowActionResult["materials_replenished"] = [];
    const updates: Array<{
        record_id: string;
        fields: Record<string, unknown>;
    }> = [];

    for (const item of bom) {
        const material = materialBySku.get(
            normalizePcBusinessKey(item.material_sku)
        );
        if (!material) {
            throw workflowError(
                "PC_PRODUCTION_MATERIAL_NOT_FOUND",
                `ไม่พบวัตถุดิบ ${item.material_sku}`
            );
        }
        const requiredForBatch = roundQuantity(
            item.quantity_per_unit * planned
        );
        const addedQty = replenishmentForMaterial({
            material,
            requiredForBatch,
        });
        if (addedQty <= 0) continue;

        const stockAfter = roundQuantity(
            material.stock_on_hand + addedQty
        );
        updates.push({
            record_id: material.record_id,
            fields: {
                [PC_MATERIAL_FIELDS.STOCK_ON_HAND]: stockAfter,
            },
        });
        replenished.push({
            material_sku: material.material_sku,
            added_qty: addedQty,
            stock_after: stockAfter,
            unit: material.unit,
        });
    }

    if (updates.length > 0) {
        await batchUpdatePcMaterials(env, updates);
    }
    await refreshPcMaterialPlan(env);

    const refreshedBatch = await requireBatch(env, batch.record_id);
    const approved = await updatePcProductionStatus(env, {
        production_record_id: refreshedBatch.record_id,
        action: "approve",
        owner,
    });
    const started = await updatePcProductionStatus(env, {
        production_record_id: approved.record_id,
        action: "start",
        owner,
    });
    await sendCurrentWorkflowCard(env, started);

    return {
        ok: true,
        action: "purchase-materials",
        production_record_id: started.record_id,
        production_id: started.production_id,
        production_status: started.production_status,
        message:
            replenished.length > 0
                ? "จำลองรับวัตถุดิบเข้าและเริ่มผลิตต่อแล้ว"
                : "วัตถุดิบพร้อมและเริ่มผลิตแล้ว",
        materials_replenished: replenished,
        duplicate: replenished.length === 0,
    };
}

async function completeProduction(
    env: Env,
    batch: PcProductionBatch,
    owner: string
): Promise<PcWorkflowActionResult> {
    const quantity = plannedQuantity(batch);
    if (batch.production_status === "COMPLETED" || batch.inventory_posted) {
        const products = await listPcProducts(env);
        const product = findProduct(products, batch);
        return {
            ok: true,
            action: "complete-production",
            production_record_id: batch.record_id,
            production_id: batch.production_id,
            production_status: "COMPLETED",
            message: "แผนผลิตนี้รับสินค้าเข้าสต็อกแล้ว",
            materials_replenished: [],
            product_stock_on_hand: product.stock_on_hand,
            duplicate: true,
        };
    }

    if (quantity <= 0) {
        throw workflowError(
            "PC_PRODUCTION_PLANNED_QTY_INVALID",
            "จำนวนตามแผนผลิตต้องมากกว่า 0"
        );
    }

    const completion = await completePcProduction(env, {
        production_record_id: batch.record_id,
        actual_qty: quantity,
        idempotency_key: `lark-workflow-complete:${batch.record_id}`,
        owner,
    });
    const completed = await requireBatch(env, batch.record_id);
    const products = await listPcProducts(env);
    const product = findProduct(products, completed);
    await sendPcLarkActionCard(
        env,
        buildProductionCompletedCard({
            batch: completed,
            actual_qty: completion.actual_qty,
            stock_on_hand: product.stock_on_hand,
        })
    );

    return {
        ok: true,
        action: "complete-production",
        production_record_id: completed.record_id,
        production_id: completed.production_id,
        production_status: completed.production_status,
        message: "ผลิตเสร็จ หักวัตถุดิบ และรับสินค้าเข้าสต็อกแล้ว",
        materials_replenished: [],
        product_stock_on_hand: product.stock_on_hand,
        duplicate: completion.duplicate,
    };
}

export async function runPcWorkflowAction(
    env: Env,
    input: {
        action: PcWorkflowAction;
        production_record_id: string;
        actor_name: string;
    }
): Promise<PcWorkflowActionResult> {
    assertPcInventoryEnabled(env);
    const batch = await requireBatch(env, input.production_record_id);
    const owner = input.actor_name.trim() || "Lark Operator";

    if (input.action === "approve-production") {
        return await approveAndStart(env, batch, owner);
    }

    if (input.action === "purchase-materials") {
        return await purchaseMaterialsAndStart(env, batch, owner);
    }

    return await completeProduction(env, batch, owner);
}
