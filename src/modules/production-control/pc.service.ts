import type { Env } from "../../config/env";
import {
    ORDER_FIELDS,
    PC_MATERIAL_FIELDS,
    PC_PRODUCT_FIELDS,
    PC_PRODUCTION_FIELDS,
} from "../../core/lark-fields";
import { OperationalError } from "../../utils/errors";
import {
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { recordActivityOnce } from "../activities/activity.service";
import type { ActivityAction } from "../activities/activity.types";
import {
    getOrderByRecordId,
    listOrders,
    type LarkOrderRecord,
} from "../orders/order.repository";
import { notifyPcExceptionOnce } from "./pc.alerts";
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
import {
    assertPcInventoryEnabled,
    batchCreatePcProduction,
    batchUpdatePcMaterials,
    batchUpdatePcProducts,
    batchUpdatePcProduction,
    createPcProduction,
    findPcProductionById,
    getPcProductionByRecordId,
    listPcMaterials,
    listPcProduction,
    listPcProducts,
    updateOrderPcState,
    updatePcProduction,
} from "./pc.repository";
import type {
    PcMaterial,
    PcOrderAllocation,
    PcOrderInventoryResult,
    PcOrderInventoryState,
    PcProduct,
    PcProductTransition,
    PcProductionBatch,
    PcProductionCompletionResult,
    PcProductionPostingState,
} from "./pc.types";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const ACTIVE_PRODUCTION_STATUSES = new Set([
    "RECOMMENDED",
    "APPROVED",
    "IN_PROGRESS",
    "BLOCKED_MATERIAL",
]);

async function recordPcActivitySafe(
    env: Env,
    input: {
        event_id: string;
        action: ActivityAction;
        old_value?: Record<string, unknown> | null;
        new_value?: Record<string, unknown> | null;
    }
): Promise<void> {
    try {
        await recordActivityOnce(env, input);
    } catch (error) {
        console.error("PC_ACTIVITY_WRITE_FAILED", {
            event_id: input.event_id,
            action: input.action,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

function pcError(
    code: string,
    message: string,
    status = 422,
    retryable = false
): OperationalError {
    return new OperationalError(code, message, {
        retryable,
        status,
    });
}

function roundQuantity(value: number): number {
    return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizeLookup(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[()\[\]{}._\-/]+/g, " ")
        .replace(/\s+/g, " ");
}

function normalizeSize(value: string): string {
    const normalized = value.trim().toUpperCase();

    if (normalized === "SMALL") return "S";
    if (normalized === "MEDIUM") return "M";
    if (normalized === "LARGE") return "L";
    return normalized;
}

function parseOrderInventoryState(value: unknown): PcOrderInventoryState | null {
    const text = getLarkText(value, "").trim();

    if (!text) {
        return null;
    }

    try {
        const parsed = JSON.parse(text) as PcOrderInventoryState;

        if (
            parsed.version !== 1 ||
            !Array.isArray(parsed.allocations) ||
            !Array.isArray(parsed.transitions)
        ) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function parseProductionPostingState(
    value: string
): PcProductionPostingState | null {
    if (!value.trim()) {
        return null;
    }

    try {
        const parsed = JSON.parse(value) as PcProductionPostingState;

        if (
            parsed.version !== 1 ||
            !parsed.production_record_id ||
            !parsed.product ||
            !Array.isArray(parsed.materials)
        ) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function isInventoryRequired(order: LarkOrderRecord): boolean {
    const orderStatus = getLarkText(
        order.fields[ORDER_FIELDS.ORDER_STATUS]
    )
        .trim()
        .toLowerCase();
    const paymentStatus = getLarkText(
        order.fields[ORDER_FIELDS.PAYMENT_STATUS]
    )
        .trim()
        .toLowerCase();
    const paymentVerified = getLarkBoolean(
        order.fields[ORDER_FIELDS.PAYMENT_VERIFIED]
    );

    if (
        orderStatus === "cancelled" ||
        orderStatus === "returned" ||
        paymentStatus === "refunded" ||
        paymentStatus === "failed"
    ) {
        return false;
    }

    return paymentVerified && paymentStatus === "paid";
}

function productAliases(product: PcProduct): string[] {
    const aliases = [
        product.sku,
        product.product_id,
        product.product_name,
        `${product.product_name} ${product.size}`,
        `${product.style_code} ${product.color} ${product.size}`,
    ];

    return aliases
        .map(normalizeLookup)
        .filter((value, index, array) => value && array.indexOf(value) === index);
}

function resolveProduct(
    products: PcProduct[],
    input: {
        sku?: string;
        product_name?: string;
        variant?: string;
        size?: string;
    }
): PcProduct {
    const activeProducts = products.filter((product) => product.active);
    const sku = normalizeLookup(input.sku ?? "");

    if (sku) {
        const exactSku = activeProducts.filter(
            (product) => normalizeLookup(product.sku) === sku
        );

        if (exactSku.length === 1) {
            return exactSku[0];
        }

        const exactProductId = activeProducts.filter(
            (product) => normalizeLookup(product.product_id) === sku
        );

        if (exactProductId.length === 1) {
            return exactProductId[0];
        }
    }

    const name = normalizeLookup(input.product_name ?? "");
    const variant = normalizeLookup(input.variant ?? "");
    const size = normalizeSize(input.size ?? input.variant ?? "");
    const candidateText = normalizeLookup(
        [input.product_name, input.variant].filter(Boolean).join(" ")
    );
    let candidates = activeProducts.filter((product) => {
        const aliases = productAliases(product);

        return aliases.some(
            (alias) =>
                alias === name ||
                alias === candidateText ||
                (candidateText && candidateText.includes(alias)) ||
                (alias && alias.includes(candidateText))
        );
    });

    if (candidates.length > 1 && size) {
        candidates = candidates.filter(
            (product) => normalizeSize(product.size) === size
        );
    }

    if (candidates.length > 1 && variant) {
        candidates = candidates.filter((product) => {
            const haystack = normalizeLookup(
                `${product.color} ${product.size} ${product.product_name}`
            );
            return variant
                .split(" ")
                .filter(Boolean)
                .every((part) => haystack.includes(part));
        });
    }

    if (candidates.length === 1) {
        return candidates[0];
    }

    if (candidates.length === 0) {
        throw pcError(
            "PC_PRODUCT_NOT_FOUND",
            `ไม่พบสินค้าใน PC_Products: ${input.sku || input.product_name || "ไม่ระบุ"}`,
            422
        );
    }

    throw pcError(
        "PC_PRODUCT_AMBIGUOUS",
        `พบสินค้าซ้ำหลาย SKU: ${candidates.map((item) => item.sku).join(", ")}`,
        409
    );
}

function parseMarketplaceItems(
    order: LarkOrderRecord
): Array<{
    sku?: string;
    name: string;
    variant?: string;
    quantity: number;
}> {
    const text = getLarkText(
        order.fields[ORDER_FIELDS.MARKETPLACE_ITEMS_JSON]
    ).trim();

    if (!text) {
        return [];
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(text);
    } catch {
        throw pcError(
            "PC_MARKETPLACE_ITEMS_INVALID_JSON",
            "marketplace_items_json ไม่ใช่ JSON ที่ถูกต้อง"
        );
    }

    if (!Array.isArray(parsed)) {
        throw pcError(
            "PC_MARKETPLACE_ITEMS_INVALID_SHAPE",
            "marketplace_items_json ต้องเป็น Array"
        );
    }

    return parsed.map((item) => {
        if (typeof item !== "object" || item === null) {
            throw pcError(
                "PC_MARKETPLACE_ITEM_INVALID",
                "รายการสินค้า Marketplace ไม่ถูกต้อง"
            );
        }

        const value = item as Record<string, unknown>;
        const quantity = Number(value.quantity);

        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw pcError(
                "PC_MARKETPLACE_ITEM_QUANTITY_INVALID",
                "จำนวนสินค้า Marketplace ต้องมากกว่า 0"
            );
        }

        return {
            sku: String(value.sku ?? "").trim() || undefined,
            name: String(value.name ?? value.product_name ?? "").trim(),
            variant: String(value.variant ?? value.product_size ?? "").trim() ||
                undefined,
            quantity,
        };
    });
}

function resolveOrderAllocations(
    order: LarkOrderRecord,
    products: PcProduct[]
): PcOrderAllocation[] {
    if (!isInventoryRequired(order)) {
        return [];
    }

    const marketplaceItems = parseMarketplaceItems(order);

    if (marketplaceItems.length > 0) {
        return normalizeAllocations(
            marketplaceItems.map((item) => ({
                sku: resolveProduct(products, {
                    sku: item.sku,
                    product_name: item.name,
                    variant: item.variant,
                }).sku,
                quantity: item.quantity,
            }))
        );
    }

    const quantity = getLarkNumber(
        order.fields[ORDER_FIELDS.QUANTITY]
    );

    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw pcError(
            "PC_ORDER_QUANTITY_INVALID",
            "Order ที่ชำระแล้วต้องมีจำนวนสินค้ามากกว่า 0"
        );
    }

    const product = resolveProduct(products, {
        sku: getLarkText(order.fields[ORDER_FIELDS.PRODUCT_NAME]),
        product_name: getLarkText(order.fields[ORDER_FIELDS.PRODUCT_NAME]),
        size: getLarkText(order.fields[ORDER_FIELDS.PRODUCT_SIZE]),
        variant: getLarkText(order.fields[ORDER_FIELDS.PRODUCT_SIZE]),
    });

    return [
        {
            sku: product.sku,
            quantity,
        },
    ];
}

function transitionProductFields(
    transition: PcProductTransition,
    product: PcProduct
): Record<string, unknown> {
    const derived = deriveProductInventory(
        transition.new_stock_on_hand,
        product.min_stock,
        product.target_stock
    );

    return {
        [PC_PRODUCT_FIELDS.STOCK_ON_HAND]: transition.new_stock_on_hand,
        [PC_PRODUCT_FIELDS.STOCK_STATUS]: derived.stock_status,
        [PC_PRODUCT_FIELDS.RECOMMENDED_PRODUCTION_QTY]:
            derived.recommended_production_qty,
    };
}

function simpleHash(value: string): string {
    let hash = 2_166_136_261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }

    return (hash >>> 0).toString(36).toUpperCase();
}

function automaticProductionId(
    sku: string,
    discriminator = "primary"
): string {
    return `PC-STOCK-${simpleHash(`${sku}:${discriminator}`)}`;
}

function dueDate(now: number, leadDays: number): number {
    const bangkokDayStart =
        Math.floor((now + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS -
        BANGKOK_OFFSET_MS;

    return bangkokDayStart + Math.max(1, Math.ceil(leadDays)) * DAY_MS;
}

async function reconcileAutomaticProductionRecommendations(
    env: Env,
    input: {
        source_order_id: string;
        source_label: string;
        products: PcProduct[];
    }
): Promise<string[]> {
    const batches = await listPcProduction(env);
    const updates: Array<{
        record_id: string;
        fields: Record<string, unknown>;
    }> = [];
    const createdFields: Array<Record<string, unknown>> = [];
    const resultIds = new Set<string>();
    const now = Date.now();
    const usedProductionIds = new Set(
        batches.map((batch) => batch.production_id).filter(Boolean)
    );

    for (const product of input.products) {
        const skuKey = normalizeLookup(product.sku);
        const skuBatches = batches.filter(
            (batch) =>
                normalizeLookup(batch.product_sku) === skuKey &&
                ACTIVE_PRODUCTION_STATUSES.has(batch.production_status)
        );
        const committed = skuBatches.filter(
            (batch) =>
                batch.production_status === "APPROVED" ||
                batch.production_status === "IN_PROGRESS"
        );
        const committedQty = roundQuantity(
            committed.reduce(
                (sum, batch) =>
                    sum + Math.max(0, batch.planned_qty || batch.recommended_qty),
                0
            )
        );
        const candidates = skuBatches
            .filter(
                (batch) =>
                    (batch.production_status === "RECOMMENDED" ||
                        batch.production_status === "BLOCKED_MATERIAL") &&
                    batch.reason !== "MANUAL"
            )
            .sort(
                (left, right) =>
                    left.created_at - right.created_at ||
                    left.record_id.localeCompare(right.record_id)
            );
        const primaryCandidate = candidates[0];
        const recommendedQty = deriveAutomaticProductionNeed({
            stock_on_hand: product.stock_on_hand,
            min_stock: product.min_stock,
            target_stock: product.target_stock,
            committed_production_qty: committedQty,
        });

        for (const duplicate of candidates.slice(1)) {
            updates.push({
                record_id: duplicate.record_id,
                fields: {
                    [PC_PRODUCTION_FIELDS.RECOMMENDED_QTY]: 0,
                    [PC_PRODUCTION_FIELDS.PLANNED_QTY]: 0,
                    [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: "CANCELLED",
                    [PC_PRODUCTION_FIELDS.NOTES]:
                        "ยกเลิกอัตโนมัติ เนื่องจากมีแผนเติมสต็อก SKU เดียวกันอยู่แล้ว",
                },
            });
        }

        for (const batch of committed) {
            resultIds.add(batch.production_id);
        }

        if (recommendedQty <= 0) {
            if (primaryCandidate) {
                updates.push({
                    record_id: primaryCandidate.record_id,
                    fields: {
                        [PC_PRODUCTION_FIELDS.RECOMMENDED_QTY]: 0,
                        [PC_PRODUCTION_FIELDS.PLANNED_QTY]: 0,
                        [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: "CANCELLED",
                        [PC_PRODUCTION_FIELDS.NOTES]:
                            committedQty > 0
                                ? "ยกเลิกอัตโนมัติ เพราะแผนที่อนุมัติ/กำลังผลิตครอบคลุมยอดเติมสต็อกแล้ว"
                                : "ยกเลิกอัตโนมัติ เนื่องจากสต็อกสูงกว่า Min แล้ว",
                    },
                });
            }
            continue;
        }

        const reason =
            product.stock_on_hand < 0 ? "ORDER_SHORTAGE" : "MIN_STOCK";
        const orderShortage = Math.max(0, -product.stock_on_hand);
        const commonFields = {
            [PC_PRODUCTION_FIELDS.SOURCE_ORDER_ID]: input.source_order_id,
            [PC_PRODUCTION_FIELDS.PRODUCT_SKU]: product.sku,
            [PC_PRODUCTION_FIELDS.PRODUCT_NAME]: product.product_name,
            [PC_PRODUCTION_FIELDS.REASON]: reason,
            [PC_PRODUCTION_FIELDS.ORDER_SHORTAGE_QTY]: orderShortage,
            [PC_PRODUCTION_FIELDS.RECOMMENDED_QTY]: recommendedQty,
            [PC_PRODUCTION_FIELDS.PLANNED_QTY]: recommendedQty,
            [PC_PRODUCTION_FIELDS.DUE_DATE]: dueDate(
                now,
                product.production_lead_days
            ),
            [PC_PRODUCTION_FIELDS.NOTES]:
                `แนะนำอัตโนมัติจาก ${input.source_label}; ` +
                `หักแผนที่อนุมัติ/กำลังผลิตแล้ว ${committedQty}`,
        };

        if (primaryCandidate) {
            resultIds.add(primaryCandidate.production_id);
            updates.push({
                record_id: primaryCandidate.record_id,
                fields: commonFields,
            });
            continue;
        }

        let discriminator = "primary";
        let id = automaticProductionId(product.sku, discriminator);
        let collision = 0;

        while (usedProductionIds.has(id)) {
            collision += 1;
            discriminator =
                `${input.source_order_id}:${product.stock_on_hand}:` +
                `${committedQty}:${collision}`;
            id = automaticProductionId(product.sku, discriminator);
        }

        usedProductionIds.add(id);
        resultIds.add(id);
        createdFields.push({
            [PC_PRODUCTION_FIELDS.PRODUCTION_ID]: id,
            ...commonFields,
            [PC_PRODUCTION_FIELDS.ACTUAL_QTY]: 0,
            [PC_PRODUCTION_FIELDS.MATERIAL_CHECK_STATUS]: "BOM_MISSING",
            [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: "RECOMMENDED",
            [PC_PRODUCTION_FIELDS.MATERIAL_REQUIREMENT_SUMMARY]: "",
            [PC_PRODUCTION_FIELDS.MATERIAL_RISK_SUMMARY]: "",
            [PC_PRODUCTION_FIELDS.INVENTORY_POSTED]: false,
            [PC_PRODUCTION_FIELDS.INVENTORY_POSTING_STATE_JSON]: "",
            [PC_PRODUCTION_FIELDS.CREATED_AT]: now,
            [PC_PRODUCTION_FIELDS.COMPLETED_AT]: 0,
            [PC_PRODUCTION_FIELDS.OWNER]: "Unassigned",
        });
    }

    if (updates.length > 0) {
        await batchUpdatePcProduction(env, updates);
    }

    if (createdFields.length > 0) {
        await batchCreatePcProduction(env, createdFields);
    }

    return [...resultIds];
}

async function ensureProductionRecommendations(
    env: Env,
    order: LarkOrderRecord,
    transitions: PcProductTransition[],
    products: PcProduct[]
): Promise<string[]> {
    const touchedSkus = new Set(
        transitions.map((transition) => normalizeLookup(transition.sku))
    );
    const orderNumber = getLarkText(
        order.fields[ORDER_FIELDS.ORDER_NUMBER],
        order.record_id
    ).trim();

    return await reconcileAutomaticProductionRecommendations(env, {
        source_order_id: order.record_id,
        source_label: `Order ${orderNumber}`,
        products: products.filter((product) =>
            touchedSkus.has(normalizeLookup(product.sku))
        ),
    });
}

function materialFields(
    material: PcMaterial,
    plannedRequirement: number
): Record<string, unknown> {
    const derived = deriveMaterialInventory({
        stock_on_hand: material.stock_on_hand,
        min_stock: material.min_stock,
        target_stock: material.target_stock,
        planned_requirement: plannedRequirement,
        source_type: material.source_type,
        lead_time_days: material.lead_time_days,
    });

    return {
        [PC_MATERIAL_FIELDS.PLANNED_REQUIREMENT]: plannedRequirement,
        [PC_MATERIAL_FIELDS.PROJECTED_STOCK]: derived.projected_stock,
        [PC_MATERIAL_FIELDS.SHORTAGE_QTY]: derived.shortage_qty,
        [PC_MATERIAL_FIELDS.MATERIAL_STATUS]: derived.material_status,
        [PC_MATERIAL_FIELDS.RECOMMENDED_REORDER_QTY]:
            derived.recommended_reorder_qty,
        [PC_MATERIAL_FIELDS.ALERT_LEVEL]: derived.alert_level,
    };
}

export async function refreshPcMaterialPlan(env: Env): Promise<{
    materials_updated: number;
    production_updated: number;
    critical_materials: number;
}> {
    assertPcInventoryEnabled(env);
    const [products, materials, production] = await Promise.all([
        listPcProducts(env),
        listPcMaterials(env),
        listPcProduction(env),
    ]);
    const requirements = productionMaterialRequirements(
        production,
        products
    );
    const productBySku = new Map(
        products.map((product) => [normalizeLookup(product.sku), product])
    );
    const materialUpdates = materials.map((material) => ({
        record_id: material.record_id,
        fields: materialFields(
            material,
            requirements.get(normalizeLookup(material.material_sku)) ?? 0
        ),
    }));

    await batchUpdatePcMaterials(env, materialUpdates);

    const refreshedMaterials = materials.map((material) => {
        const planned =
            requirements.get(normalizeLookup(material.material_sku)) ?? 0;
        const derived = deriveMaterialInventory({
            stock_on_hand: material.stock_on_hand,
            min_stock: material.min_stock,
            target_stock: material.target_stock,
            planned_requirement: planned,
            source_type: material.source_type,
            lead_time_days: material.lead_time_days,
        });

        return {
            ...material,
            planned_requirement: planned,
            ...derived,
        };
    });
    const productionUpdates = production
        .filter((batch) => ACTIVE_PRODUCTION_STATUSES.has(batch.production_status))
        .map((batch) => {
            const check = checkBatchMaterials({
                product:
                    productBySku.get(normalizeLookup(batch.product_sku)) ?? null,
                planned_qty: batch.planned_qty || batch.recommended_qty,
                materials: refreshedMaterials,
            });
            const canAutoBlock =
                batch.production_status === "RECOMMENDED" ||
                batch.production_status === "BLOCKED_MATERIAL";
            const nextStatus = canAutoBlock
                ? check.status === "SUFFICIENT"
                    ? "RECOMMENDED"
                    : "BLOCKED_MATERIAL"
                : batch.production_status;

            return {
                record_id: batch.record_id,
                fields: {
                    [PC_PRODUCTION_FIELDS.MATERIAL_CHECK_STATUS]: check.status,
                    [PC_PRODUCTION_FIELDS.MATERIAL_REQUIREMENT_SUMMARY]:
                        check.requirement_summary,
                    [PC_PRODUCTION_FIELDS.MATERIAL_RISK_SUMMARY]:
                        check.risk_summary,
                    [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: nextStatus,
                },
            };
        });

    await batchUpdatePcProduction(env, productionUpdates);

    const newlyCritical = refreshedMaterials
        .filter((material) => {
            const previous = materials.find(
                (item) => item.record_id === material.record_id
            );
            return (
                material.shortage_qty > 0 &&
                (previous?.alert_level !== "CRITICAL" ||
                    previous.shortage_qty !== material.shortage_qty)
            );
        })
        .slice(0, 10);

    for (const material of newlyCritical) {
        await notifyPcExceptionOnce(env, {
            event_id: `pc:material:${material.material_sku}:${material.stock_on_hand}:${material.planned_requirement}`,
            type: "PC_MATERIAL_SHORTAGE",
            reference_id: material.material_sku,
            product_name: material.material_name,
            detail: `วัตถุดิบขาด ${material.shortage_qty} ${material.unit} สำหรับแผนผลิตปัจจุบัน`,
            next_action: "จัดหาวัตถุดิบหรือปรับจำนวนแผนผลิตก่อนอนุมัติ",
        });
    }

    return {
        materials_updated: materialUpdates.length,
        production_updated: productionUpdates.length,
        critical_materials: refreshedMaterials.filter(
            (material) => material.alert_level === "CRITICAL"
        ).length,
    };
}

function transitionRecoveryUpdates(input: {
    transitions: PcProductTransition[];
    products: PcProduct[];
}): Array<{ record_id: string; fields: Record<string, unknown> }> {
    const productByRecordId = new Map(
        input.products.map((product) => [product.record_id, product])
    );
    const updates: Array<{
        record_id: string;
        fields: Record<string, unknown>;
    }> = [];

    for (const transition of input.transitions) {
        const product = productByRecordId.get(transition.record_id);

        if (!product) {
            throw pcError(
                "PC_PRODUCT_RECORD_MISSING",
                `ไม่พบ Product record ${transition.record_id}`,
                409
            );
        }

        if (product.stock_on_hand === transition.new_stock_on_hand) {
            continue;
        }

        if (product.stock_on_hand !== transition.old_stock_on_hand) {
            throw pcError(
                "PC_STOCK_CONFLICT",
                `Stock ${product.sku} เปลี่ยนจาก ${transition.old_stock_on_hand} เป็น ${product.stock_on_hand} ระหว่างประมวลผล`,
                409
            );
        }

        updates.push({
            record_id: product.record_id,
            fields: transitionProductFields(transition, product),
        });
    }

    return updates;
}

export async function reconcileOrderInventory(
    env: Env,
    orderRecordId: string
): Promise<PcOrderInventoryResult> {
    assertPcInventoryEnabled(env);

    const order = await getOrderByRecordId(env, orderRecordId);

    if (!order) {
        throw pcError("PC_ORDER_NOT_FOUND", "ไม่พบ Order", 404);
    }

    const products = await listPcProducts(env);
    const previousState = parseOrderInventoryState(
        order.fields[ORDER_FIELDS.PC_INVENTORY_STATE_JSON]
    );

    if (previousState?.phase === "prepared") {
        try {
            const updates = transitionRecoveryUpdates({
                transitions: previousState.transitions,
                products,
            });
            await batchUpdatePcProducts(env, updates);
            const productionIds = await ensureProductionRecommendations(
                env,
                order,
                previousState.transitions,
                products.map((product) => {
                    const transition = previousState.transitions.find(
                        (item) => item.record_id === product.record_id
                    );
                    return transition
                        ? {
                              ...product,
                              stock_on_hand: transition.new_stock_on_hand,
                          }
                        : product;
                })
            );
            await refreshPcMaterialPlan(env);
            const finalState: PcOrderInventoryState = {
                ...previousState,
                phase:
                    previousState.allocations.length > 0
                        ? "applied"
                        : "released",
                completed_at: Date.now(),
            };
            await updateOrderPcState(env, orderRecordId, {
                status:
                    finalState.phase === "applied" ? "APPLIED" : "RELEASED",
                state_json: JSON.stringify(finalState),
            });
            await recordPcActivitySafe(env, {
                event_id: `pc:order:${orderRecordId}:${finalState.fingerprint || "released"}`,
                action: "PC_ORDER_STOCK_APPLIED",
                old_value: { recovered_from: "prepared" },
                new_value: {
                    status: finalState.phase,
                    transitions: finalState.transitions,
                },
            });

            return {
                status:
                    finalState.phase === "applied" ? "APPLIED" : "RELEASED",
                order_record_id: orderRecordId,
                fingerprint: finalState.fingerprint,
                allocations: finalState.allocations,
                production_ids: productionIds,
                duplicate: false,
            };
        } catch (error) {
            const blocked: PcOrderInventoryState = {
                ...previousState,
                phase: "blocked",
                error_code:
                    error instanceof OperationalError
                        ? error.code
                        : "PC_RECOVERY_FAILED",
                error_message:
                    error instanceof Error ? error.message : String(error),
                completed_at: Date.now(),
            };
            await updateOrderPcState(env, orderRecordId, {
                status: "BLOCKED",
                state_json: JSON.stringify(blocked),
            });
            await recordPcActivitySafe(env, {
                event_id: `pc:order-blocked:${orderRecordId}:${blocked.error_code}`,
                action: "PC_ORDER_STOCK_BLOCKED",
                old_value: { phase: "prepared" },
                new_value: {
                    code: blocked.error_code ?? "PC_RECOVERY_FAILED",
                    message: blocked.error_message ?? "",
                },
            });
            await notifyPcExceptionOnce(env, {
                event_id: `pc:order-blocked:${orderRecordId}:${blocked.error_code}`,
                type: "PC_STOCK_EXCEPTION",
                reference_id: blocked.order_number || orderRecordId,
                product_name: "Order stock reconciliation",
                detail: blocked.error_message ?? "ไม่สามารถกู้คืนการตัดสต็อกได้",
                next_action: "ตรวจสอบ Stock ปัจจุบันกับ pc_inventory_state_json ก่อนสั่งประมวลผลใหม่",
            });
            throw error;
        }
    }

    let targetAllocations: PcOrderAllocation[];

    try {
        targetAllocations = resolveOrderAllocations(order, products);
    } catch (error) {
        const blocked: PcOrderInventoryState = {
            version: 1,
            phase: "blocked",
            fingerprint: "",
            order_record_id: orderRecordId,
            order_number: getLarkText(
                order.fields[ORDER_FIELDS.ORDER_NUMBER],
                orderRecordId
            ),
            allocations: allocationsFromState(previousState),
            previous_allocations: allocationsFromState(previousState),
            transitions: [],
            prepared_at: Date.now(),
            completed_at: Date.now(),
            error_code:
                error instanceof OperationalError
                    ? error.code
                    : "PC_ORDER_RESOLUTION_FAILED",
            error_message:
                error instanceof Error ? error.message : String(error),
        };
        await updateOrderPcState(env, orderRecordId, {
            status: "BLOCKED",
            state_json: JSON.stringify(blocked),
        });
        await recordPcActivitySafe(env, {
            event_id: `pc:order-blocked:${orderRecordId}:${blocked.error_code}`,
            action: "PC_ORDER_STOCK_BLOCKED",
            old_value: null,
            new_value: {
                code: blocked.error_code ?? "PC_ORDER_RESOLUTION_FAILED",
                message: blocked.error_message ?? "",
            },
        });
        await notifyPcExceptionOnce(env, {
            event_id: `pc:order-blocked:${orderRecordId}:${blocked.error_code}`,
            type: "PC_STOCK_EXCEPTION",
            reference_id: blocked.order_number || orderRecordId,
            product_name: getLarkText(
                order.fields[ORDER_FIELDS.PRODUCT_NAME],
                "Order stock reconciliation"
            ),
            detail: blocked.error_message ?? "ไม่สามารถจับคู่ SKU ได้",
            next_action: "ตรวจสอบ SKU/ชื่อสินค้า/ไซซ์ใน Order และ PC_Products แล้วสั่ง Reconcile ใหม่",
        });
        throw error;
    }

    const targetFingerprint = allocationFingerprint(targetAllocations);

    if (
        previousState &&
        (previousState.phase === "applied" ||
            previousState.phase === "released") &&
        previousState.fingerprint === targetFingerprint
    ) {
        return {
            status:
                previousState.phase === "applied" ? "APPLIED" : "RELEASED",
            order_record_id: orderRecordId,
            fingerprint: targetFingerprint,
            allocations: previousState.allocations,
            production_ids: [],
            duplicate: true,
        };
    }

    const previousAllocations = allocationsFromState(previousState);
    const transitions = buildProductTransitions({
        products,
        previous_allocations: previousAllocations,
        target_allocations: targetAllocations,
    });
    const prepared: PcOrderInventoryState = {
        version: 1,
        phase: "prepared",
        fingerprint: targetFingerprint,
        order_record_id: orderRecordId,
        order_number: getLarkText(
            order.fields[ORDER_FIELDS.ORDER_NUMBER],
            orderRecordId
        ),
        allocations: targetAllocations,
        previous_allocations: previousAllocations,
        transitions,
        prepared_at: Date.now(),
    };

    await updateOrderPcState(env, orderRecordId, {
        status: "PREPARED",
        state_json: JSON.stringify(prepared),
    });

    try {
        const productByRecordId = new Map(
            products.map((product) => [product.record_id, product])
        );
        await batchUpdatePcProducts(
            env,
            transitions.map((transition) => {
                const product = productByRecordId.get(transition.record_id);

                if (!product) {
                    throw pcError(
                        "PC_PRODUCT_RECORD_MISSING",
                        `ไม่พบ Product record ${transition.record_id}`,
                        409
                    );
                }

                return {
                    record_id: transition.record_id,
                    fields: transitionProductFields(transition, product),
                };
            })
        );
        const nextProducts = products.map((product) => {
            const transition = transitions.find(
                (item) => item.record_id === product.record_id
            );
            return transition
                ? {
                      ...product,
                      stock_on_hand: transition.new_stock_on_hand,
                  }
                : product;
        });
        const productionIds = await ensureProductionRecommendations(
            env,
            order,
            transitions,
            nextProducts
        );
        await refreshPcMaterialPlan(env);
        const phase = targetAllocations.length > 0 ? "applied" : "released";
        const completed: PcOrderInventoryState = {
            ...prepared,
            phase,
            completed_at: Date.now(),
        };
        const status = phase === "applied" ? "APPLIED" : "RELEASED";
        await updateOrderPcState(env, orderRecordId, {
            status,
            state_json: JSON.stringify(completed),
        });
        await recordPcActivitySafe(env, {
            event_id: `pc:order:${orderRecordId}:${targetFingerprint || "released"}`,
            action: "PC_ORDER_STOCK_APPLIED",
            old_value: { allocations: previousAllocations },
            new_value: {
                allocations: targetAllocations,
                transitions,
            },
        });

        return {
            status,
            order_record_id: orderRecordId,
            fingerprint: targetFingerprint,
            allocations: targetAllocations,
            production_ids: productionIds,
            duplicate: false,
        };
    } catch (error) {
        // คงสถานะ PREPARED ไว้เพื่อให้ Queue retry ตรวจ old/new stock แล้วทำต่อได้อย่างปลอดภัย
        throw error;
    }
}

export async function reconcileSelectedOrders(
    env: Env,
    requestedRecordIds: string[]
): Promise<{
    requested: number;
    order_record_ids: string[];
}> {
    assertPcInventoryEnabled(env);
    const uniqueIds = [...new Set(requestedRecordIds.map((id) => id.trim()))];

    if (uniqueIds.length === 0 || uniqueIds.length > 100) {
        throw pcError(
            "PC_ORDER_SELECTION_INVALID",
            "Select between 1 and 100 Orders for reconciliation",
            400
        );
    }

    const orders = await listOrders(env);
    const existingIds = new Set(orders.map((order) => order.record_id));
    const missingIds = uniqueIds.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
        throw pcError(
            "PC_ORDER_SELECTION_NOT_FOUND",
            `Order records not found: ${missingIds.join(", ")}`,
            404
        );
    }

    return {
        requested: uniqueIds.length,
        order_record_ids: uniqueIds,
    };
}

function postingRecoveryUpdates(input: {
    state: PcProductionPostingState;
    product: PcProduct;
    materials: PcMaterial[];
}): {
    product_update: { record_id: string; fields: Record<string, unknown> } | null;
    material_updates: Array<{
        record_id: string;
        fields: Record<string, unknown>;
    }>;
} {
    const productState = input.state.product;
    let productUpdate: {
        record_id: string;
        fields: Record<string, unknown>;
    } | null = null;

    if (input.product.stock_on_hand === productState.old_stock_on_hand) {
        const derived = deriveProductInventory(
            productState.new_stock_on_hand,
            input.product.min_stock,
            input.product.target_stock
        );
        productUpdate = {
            record_id: input.product.record_id,
            fields: {
                [PC_PRODUCT_FIELDS.STOCK_ON_HAND]:
                    productState.new_stock_on_hand,
                [PC_PRODUCT_FIELDS.STOCK_STATUS]: derived.stock_status,
                [PC_PRODUCT_FIELDS.RECOMMENDED_PRODUCTION_QTY]:
                    derived.recommended_production_qty,
            },
        };
    } else if (
        input.product.stock_on_hand !== productState.new_stock_on_hand
    ) {
        throw pcError(
            "PC_PRODUCTION_PRODUCT_CONFLICT",
            `Stock สินค้า ${input.product.sku} เปลี่ยนระหว่าง Post การผลิต`,
            409
        );
    }

    const materialByRecordId = new Map(
        input.materials.map((material) => [material.record_id, material])
    );
    const materialUpdates = input.state.materials.flatMap((transition) => {
        const material = materialByRecordId.get(transition.record_id);

        if (!material) {
            throw pcError(
                "PC_PRODUCTION_MATERIAL_MISSING",
                `ไม่พบ Material record ${transition.record_id}`,
                409
            );
        }

        if (material.stock_on_hand === transition.new_stock_on_hand) {
            return [];
        }

        if (material.stock_on_hand !== transition.old_stock_on_hand) {
            throw pcError(
                "PC_PRODUCTION_MATERIAL_CONFLICT",
                `Stock วัตถุดิบ ${material.material_sku} เปลี่ยนระหว่าง Post การผลิต`,
                409
            );
        }

        return [
            {
                record_id: material.record_id,
                fields: {
                    [PC_MATERIAL_FIELDS.STOCK_ON_HAND]:
                        transition.new_stock_on_hand,
                },
            },
        ];
    });

    return {
        product_update: productUpdate,
        material_updates: materialUpdates,
    };
}

function findProductForBatch(
    products: PcProduct[],
    batch: PcProductionBatch
): PcProduct {
    const product = products.find(
        (item) => normalizeLookup(item.sku) === normalizeLookup(batch.product_sku)
    );

    if (!product) {
        throw pcError(
            "PC_PRODUCTION_PRODUCT_NOT_FOUND",
            `ไม่พบสินค้า ${batch.product_sku}`,
            422
        );
    }

    return product;
}

export async function markPcProductionBlocked(
    env: Env,
    input: {
        production_record_id: string;
        code: string;
        message: string;
    }
): Promise<void> {
    const batch = await getPcProductionByRecordId(
        env,
        input.production_record_id
    );

    if (
        !batch ||
        batch.inventory_posted ||
        batch.production_status === "COMPLETED" ||
        batch.production_status === "CANCELLED"
    ) {
        return;
    }

    await updatePcProduction(env, batch.record_id, {
        [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: "BLOCKED_MATERIAL",
        [PC_PRODUCTION_FIELDS.MATERIAL_RISK_SUMMARY]:
            input.message.slice(0, 1000),
    });
    await recordPcActivitySafe(env, {
        event_id: `pc:production-blocked:${batch.production_id}:${input.code}`,
        action: "PC_PRODUCTION_BLOCKED",
        old_value: { production_status: batch.production_status },
        new_value: {
            production_status: "BLOCKED_MATERIAL",
            code: input.code,
            message: input.message,
        },
    });
    await notifyPcExceptionOnce(env, {
        event_id: `pc:production-blocked:${batch.production_id}:${input.code}`,
        type: "PC_MATERIAL_SHORTAGE",
        reference_id: batch.production_id,
        product_name: batch.product_name || batch.product_sku,
        detail: input.message,
        next_action:
            "ตรวจ BOM, ยอดวัตถุดิบ และจำนวนผลิต ก่อนสั่งปิดงานผลิตใหม่",
    });
}

export async function completePcProduction(
    env: Env,
    input: {
        production_record_id: string;
        actual_qty: number;
        idempotency_key: string;
        owner?: string;
    }
): Promise<PcProductionCompletionResult> {
    assertPcInventoryEnabled(env);
    const quantity = roundQuantity(Number(input.actual_qty));

    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw pcError(
            "PC_PRODUCTION_ACTUAL_QTY_INVALID",
            "actual_qty ต้องมากกว่า 0"
        );
    }

    if (!input.idempotency_key.trim()) {
        throw pcError(
            "PC_PRODUCTION_IDEMPOTENCY_KEY_REQUIRED",
            "ต้องระบุ Idempotency-Key",
            400
        );
    }

    const batch = await getPcProductionByRecordId(
        env,
        input.production_record_id
    );

    if (!batch) {
        throw pcError(
            "PC_PRODUCTION_NOT_FOUND",
            "ไม่พบ Production batch",
            404
        );
    }

    const existingPosting = parseProductionPostingState(
        batch.inventory_posting_state_json
    );

    if (batch.inventory_posted) {
        if (
            existingPosting?.idempotency_key === input.idempotency_key &&
            batch.actual_qty === quantity
        ) {
            return {
                production_record_id: batch.record_id,
                production_id: batch.production_id,
                actual_qty: quantity,
                duplicate: true,
                inventory_posted: true,
            };
        }

        throw pcError(
            "PC_PRODUCTION_ALREADY_POSTED",
            "Production batch นี้ Post stock แล้ว",
            409
        );
    }

    const [products, materials] = await Promise.all([
        listPcProducts(env),
        listPcMaterials(env),
    ]);
    const product = findProductForBatch(products, batch);

    if (existingPosting?.phase === "prepared") {
        if (
            existingPosting.idempotency_key !==
                input.idempotency_key.trim() ||
            existingPosting.product.actual_qty !== quantity
        ) {
            throw pcError(
                "PC_PRODUCTION_PREPARED_REQUEST_CONFLICT",
                "Production batch มี Posting ที่ค้างอยู่ด้วย Idempotency-Key หรือ actual_qty คนละค่า",
                409
            );
        }

        const recovery = postingRecoveryUpdates({
            state: existingPosting,
            product,
            materials,
        });

        await batchUpdatePcMaterials(env, recovery.material_updates);

        if (recovery.product_update) {
            await batchUpdatePcProducts(env, [recovery.product_update]);
        }

        const posted: PcProductionPostingState = {
            ...existingPosting,
            phase: "posted",
            completed_at: Date.now(),
        };
        await updatePcProduction(env, batch.record_id, {
            [PC_PRODUCTION_FIELDS.ACTUAL_QTY]:
                existingPosting.product.actual_qty,
            [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: "COMPLETED",
            [PC_PRODUCTION_FIELDS.INVENTORY_POSTED]: true,
            [PC_PRODUCTION_FIELDS.COMPLETED_AT]: Date.now(),
            [PC_PRODUCTION_FIELDS.INVENTORY_POSTING_STATE_JSON]:
                JSON.stringify(posted),
            ...(input.owner
                ? { [PC_PRODUCTION_FIELDS.OWNER]: input.owner }
                : {}),
        });
        await reconcileAutomaticProductionRecommendations(env, {
            source_order_id: batch.source_order_id,
            source_label: `Production ${batch.production_id} completed`,
            products: [
                {
                    ...product,
                    stock_on_hand: existingPosting.product.new_stock_on_hand,
                },
            ],
        });
        await refreshPcMaterialPlan(env);
        await recordPcActivitySafe(env, {
            event_id: `pc:production-completed:${batch.production_id}:${existingPosting.idempotency_key}`,
            action: "PC_PRODUCTION_COMPLETED",
            old_value: { recovered_from: "prepared" },
            new_value: {
                actual_qty: existingPosting.product.actual_qty,
                materials: existingPosting.materials,
                product: existingPosting.product,
            },
        });

        return {
            production_record_id: batch.record_id,
            production_id: batch.production_id,
            actual_qty: existingPosting.product.actual_qty,
            duplicate: false,
            inventory_posted: true,
        };
    }

    if (
        batch.production_status !== "APPROVED" &&
        batch.production_status !== "IN_PROGRESS" &&
        batch.production_status !== "BLOCKED_MATERIAL"
    ) {
        throw pcError(
            "PC_PRODUCTION_STATUS_INVALID",
            `สถานะ ${batch.production_status} ยังปิดงานผลิตไม่ได้`,
            409
        );
    }

    let bom;

    try {
        bom = parseBom(product.materials_json);
    } catch {
        throw pcError(
            "PC_PRODUCTION_BOM_INVALID",
            `สูตรวัตถุดิบของ ${product.sku} ไม่ถูกต้อง`
        );
    }

    if (bom.length === 0) {
        throw pcError(
            "PC_PRODUCTION_BOM_MISSING",
            `ยังไม่มีสูตรวัตถุดิบของ ${product.sku}`
        );
    }

    const materialBySku = new Map(
        materials.map((material) => [
            normalizeLookup(material.material_sku),
            material,
        ])
    );
    const materialTransitions = bom.map((item) => {
        const material = materialBySku.get(
            normalizeLookup(item.material_sku)
        );

        if (!material) {
            throw pcError(
                "PC_PRODUCTION_MATERIAL_NOT_FOUND",
                `ไม่พบวัตถุดิบ ${item.material_sku}`
            );
        }

        const requiredQty = roundQuantity(
            item.quantity_per_unit * quantity
        );
        const nextStock = roundQuantity(
            material.stock_on_hand - requiredQty
        );

        if (nextStock < 0) {
            throw pcError(
                "PC_PRODUCTION_MATERIAL_INSUFFICIENT",
                `วัตถุดิบ ${material.material_sku} ไม่พอ ขาด ${roundQuantity(
                    -nextStock
                )} ${material.unit}`,
                409
            );
        }

        return {
            record_id: material.record_id,
            material_sku: material.material_sku,
            required_qty: requiredQty,
            old_stock_on_hand: material.stock_on_hand,
            new_stock_on_hand: nextStock,
        };
    });
    const productNextStock = roundQuantity(
        product.stock_on_hand + quantity
    );
    const prepared: PcProductionPostingState = {
        version: 1,
        phase: "prepared",
        idempotency_key: input.idempotency_key.trim(),
        production_record_id: batch.record_id,
        production_id: batch.production_id,
        product: {
            record_id: product.record_id,
            sku: product.sku,
            actual_qty: quantity,
            old_stock_on_hand: product.stock_on_hand,
            new_stock_on_hand: productNextStock,
        },
        materials: materialTransitions,
        prepared_at: Date.now(),
    };

    await updatePcProduction(env, batch.record_id, {
        [PC_PRODUCTION_FIELDS.ACTUAL_QTY]: quantity,
        [PC_PRODUCTION_FIELDS.INVENTORY_POSTING_STATE_JSON]:
            JSON.stringify(prepared),
    });
    await batchUpdatePcMaterials(
        env,
        materialTransitions.map((transition) => ({
            record_id: transition.record_id,
            fields: {
                [PC_MATERIAL_FIELDS.STOCK_ON_HAND]:
                    transition.new_stock_on_hand,
            },
        }))
    );
    const productDerived = deriveProductInventory(
        productNextStock,
        product.min_stock,
        product.target_stock
    );
    await batchUpdatePcProducts(env, [
        {
            record_id: product.record_id,
            fields: {
                [PC_PRODUCT_FIELDS.STOCK_ON_HAND]: productNextStock,
                [PC_PRODUCT_FIELDS.STOCK_STATUS]:
                    productDerived.stock_status,
                [PC_PRODUCT_FIELDS.RECOMMENDED_PRODUCTION_QTY]:
                    productDerived.recommended_production_qty,
            },
        },
    ]);
    const posted: PcProductionPostingState = {
        ...prepared,
        phase: "posted",
        completed_at: Date.now(),
    };
    await updatePcProduction(env, batch.record_id, {
        [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: "COMPLETED",
        [PC_PRODUCTION_FIELDS.INVENTORY_POSTED]: true,
        [PC_PRODUCTION_FIELDS.COMPLETED_AT]: Date.now(),
        [PC_PRODUCTION_FIELDS.INVENTORY_POSTING_STATE_JSON]:
            JSON.stringify(posted),
        ...(input.owner
            ? { [PC_PRODUCTION_FIELDS.OWNER]: input.owner }
            : {}),
    });
    await reconcileAutomaticProductionRecommendations(env, {
        source_order_id: batch.source_order_id,
        source_label: `Production ${batch.production_id} completed`,
        products: [
            {
                ...product,
                stock_on_hand: productNextStock,
            },
        ],
    });
    await refreshPcMaterialPlan(env);
    await recordPcActivitySafe(env, {
        event_id: `pc:production-completed:${batch.production_id}:${input.idempotency_key}`,
        action: "PC_PRODUCTION_COMPLETED",
        old_value: {
            product_stock: product.stock_on_hand,
            material_stock: materialTransitions.map((item) => ({
                material_sku: item.material_sku,
                stock_on_hand: item.old_stock_on_hand,
            })),
        },
        new_value: {
            actual_qty: quantity,
            product_stock: productNextStock,
            materials: materialTransitions,
        },
    });

    return {
        production_record_id: batch.record_id,
        production_id: batch.production_id,
        actual_qty: quantity,
        duplicate: false,
        inventory_posted: true,
    };
}

export async function updatePcProductionStatus(
    env: Env,
    input: {
        production_record_id: string;
        action: "approve" | "start" | "cancel";
        planned_qty?: number;
        owner?: string;
    }
): Promise<PcProductionBatch> {
    assertPcInventoryEnabled(env);
    const [batch, products, materials, production] = await Promise.all([
        getPcProductionByRecordId(env, input.production_record_id),
        listPcProducts(env),
        listPcMaterials(env),
        listPcProduction(env),
    ]);

    if (!batch) {
        throw pcError(
            "PC_PRODUCTION_NOT_FOUND",
            "ไม่พบ Production batch",
            404
        );
    }

    if (batch.inventory_posted || batch.production_status === "COMPLETED") {
        throw pcError(
            "PC_PRODUCTION_ALREADY_COMPLETED",
            "Production batch นี้เสร็จแล้ว",
            409
        );
    }

    const allowedByAction: Record<
        typeof input.action,
        Set<PcProductionBatch["production_status"]>
    > = {
        approve: new Set(["RECOMMENDED", "BLOCKED_MATERIAL", "APPROVED"]),
        start: new Set(["APPROVED", "IN_PROGRESS"]),
        cancel: new Set([
            "RECOMMENDED",
            "BLOCKED_MATERIAL",
            "APPROVED",
            "IN_PROGRESS",
            "CANCELLED",
        ]),
    };

    if (!allowedByAction[input.action].has(batch.production_status)) {
        throw pcError(
            "PC_PRODUCTION_TRANSITION_INVALID",
            `เปลี่ยนสถานะ ${batch.production_status} ด้วย action ${input.action} ไม่ได้`,
            409
        );
    }

    if (
        (input.action === "approve" &&
            batch.production_status === "APPROVED" &&
            input.planned_qty === undefined) ||
        (input.action === "start" &&
            batch.production_status === "IN_PROGRESS")
    ) {
        return batch;
    }

    if (input.action === "cancel") {
        if (batch.production_status === "CANCELLED") {
            return batch;
        }

        const cancelled = await updatePcProduction(env, batch.record_id, {
            [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: "CANCELLED",
            ...(input.owner
                ? { [PC_PRODUCTION_FIELDS.OWNER]: input.owner }
                : {}),
        });
        await refreshPcMaterialPlan(env);
        return cancelled;
    }

    const plannedQty =
        input.planned_qty === undefined
            ? batch.planned_qty || batch.recommended_qty
            : roundQuantity(Number(input.planned_qty));

    if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
        throw pcError(
            "PC_PRODUCTION_PLANNED_QTY_INVALID",
            "planned_qty ต้องมากกว่า 0"
        );
    }

    const proposedProduction = production.map((item) =>
        item.record_id === batch.record_id
            ? { ...item, planned_qty: plannedQty }
            : item
    );
    const requirements = productionMaterialRequirements(
        proposedProduction,
        products
    );
    const projectedMaterials = materials.map((material) => {
        const plannedRequirement =
            requirements.get(normalizeLookup(material.material_sku)) ?? 0;
        return {
            ...material,
            planned_requirement: plannedRequirement,
            ...deriveMaterialInventory({
                stock_on_hand: material.stock_on_hand,
                min_stock: material.min_stock,
                target_stock: material.target_stock,
                planned_requirement: plannedRequirement,
                source_type: material.source_type,
                lead_time_days: material.lead_time_days,
            }),
        };
    });
    const product = findProductForBatch(products, batch);
    const check = checkBatchMaterials({
        product,
        planned_qty: plannedQty,
        materials: projectedMaterials,
    });

    if (check.status !== "SUFFICIENT") {
        await updatePcProduction(env, batch.record_id, {
            [PC_PRODUCTION_FIELDS.PLANNED_QTY]: plannedQty,
            [PC_PRODUCTION_FIELDS.MATERIAL_CHECK_STATUS]: check.status,
            [PC_PRODUCTION_FIELDS.MATERIAL_REQUIREMENT_SUMMARY]:
                check.requirement_summary,
            [PC_PRODUCTION_FIELDS.MATERIAL_RISK_SUMMARY]: check.risk_summary,
            [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: "BLOCKED_MATERIAL",
            ...(input.owner
                ? { [PC_PRODUCTION_FIELDS.OWNER]: input.owner }
                : {}),
        });
        await markPcProductionBlocked(env, {
            production_record_id: batch.record_id,
            code: "PC_PRODUCTION_MATERIAL_BLOCKED",
            message: check.risk_summary || "วัตถุดิบไม่พร้อม",
        });
        await refreshPcMaterialPlan(env);
        throw pcError(
            "PC_PRODUCTION_MATERIAL_BLOCKED",
            check.risk_summary || "วัตถุดิบไม่พร้อม",
            409
        );
    }

    const nextStatus =
        input.action === "approve" ? "APPROVED" : "IN_PROGRESS";
    const updated = await updatePcProduction(env, batch.record_id, {
        [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: nextStatus,
        [PC_PRODUCTION_FIELDS.PLANNED_QTY]: plannedQty,
        [PC_PRODUCTION_FIELDS.MATERIAL_CHECK_STATUS]: check.status,
        [PC_PRODUCTION_FIELDS.MATERIAL_REQUIREMENT_SUMMARY]:
            check.requirement_summary,
        [PC_PRODUCTION_FIELDS.MATERIAL_RISK_SUMMARY]: check.risk_summary,
        ...(input.owner
            ? { [PC_PRODUCTION_FIELDS.OWNER]: input.owner }
            : {}),
    });
    await refreshPcMaterialPlan(env);

    return updated;
}

export async function getPcOverview(env: Env): Promise<{
    summary: Record<string, number>;
    products: PcProduct[];
    materials: PcMaterial[];
    production: PcProductionBatch[];
}> {
    const [products, materials, production] = await Promise.all([
        listPcProducts(env),
        listPcMaterials(env),
        listPcProduction(env),
    ]);
    const activeProducts = products.filter((product) => product.active);
    const openProduction = production.filter((batch) =>
        ACTIVE_PRODUCTION_STATUSES.has(batch.production_status)
    );

    return {
        summary: {
            active_products: activeProducts.length,
            finished_goods_stock: activeProducts.reduce(
                (sum, product) => sum + product.stock_on_hand,
                0
            ),
            finished_goods_value_thb: activeProducts.reduce(
                (sum, product) =>
                    sum + product.stock_on_hand * product.sales_price_thb,
                0
            ),
            low_stock_products: activeProducts.filter(
                (product) => product.stock_status === "LOW_STOCK"
            ).length,
            out_of_stock_products: activeProducts.filter(
                (product) => product.stock_status === "OUT_OF_STOCK"
            ).length,
            open_production_batches: openProduction.length,
            blocked_production_batches: openProduction.filter(
                (batch) => batch.production_status === "BLOCKED_MATERIAL"
            ).length,
            planned_production_units: openProduction.reduce(
                (sum, batch) => sum + batch.planned_qty,
                0
            ),
            material_warning_count: materials.filter(
                (material) => material.alert_level === "WARNING"
            ).length,
            material_critical_count: materials.filter(
                (material) => material.alert_level === "CRITICAL"
            ).length,
        },
        products,
        materials,
        production,
    };
}

export async function getPcProductionByBusinessId(
    env: Env,
    productionId: string
): Promise<PcProductionBatch | null> {
    return await findPcProductionById(env, productionId);
}

export async function createManualPcProduction(
    env: Env,
    input: {
        product_sku: string;
        planned_qty: number;
        owner?: string;
        notes?: string;
    }
): Promise<PcProductionBatch> {
    assertPcInventoryEnabled(env);
    const products = await listPcProducts(env);
    const product = resolveProduct(products, { sku: input.product_sku });
    const quantity = roundQuantity(Number(input.planned_qty));

    if (!Number.isFinite(quantity) || quantity <= 0) {
        throw pcError(
            "PC_PRODUCTION_PLANNED_QTY_INVALID",
            "planned_qty ต้องมากกว่า 0"
        );
    }

    const id = `PCM-${simpleHash(
        `${product.sku}:${Date.now()}:${crypto.randomUUID()}`
    )}`;
    const created = await createPcProduction(env, {
        [PC_PRODUCTION_FIELDS.PRODUCTION_ID]: id,
        [PC_PRODUCTION_FIELDS.SOURCE_ORDER_ID]: "",
        [PC_PRODUCTION_FIELDS.PRODUCT_SKU]: product.sku,
        [PC_PRODUCTION_FIELDS.PRODUCT_NAME]: product.product_name,
        [PC_PRODUCTION_FIELDS.REASON]: "MANUAL",
        [PC_PRODUCTION_FIELDS.ORDER_SHORTAGE_QTY]: 0,
        [PC_PRODUCTION_FIELDS.RECOMMENDED_QTY]: quantity,
        [PC_PRODUCTION_FIELDS.PLANNED_QTY]: quantity,
        [PC_PRODUCTION_FIELDS.ACTUAL_QTY]: 0,
        [PC_PRODUCTION_FIELDS.MATERIAL_CHECK_STATUS]: "BOM_MISSING",
        [PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]: "RECOMMENDED",
        [PC_PRODUCTION_FIELDS.MATERIAL_REQUIREMENT_SUMMARY]: "",
        [PC_PRODUCTION_FIELDS.MATERIAL_RISK_SUMMARY]: "",
        [PC_PRODUCTION_FIELDS.DUE_DATE]: dueDate(
            Date.now(),
            product.production_lead_days
        ),
        [PC_PRODUCTION_FIELDS.INVENTORY_POSTED]: false,
        [PC_PRODUCTION_FIELDS.INVENTORY_POSTING_STATE_JSON]: "",
        [PC_PRODUCTION_FIELDS.CREATED_AT]: Date.now(),
        [PC_PRODUCTION_FIELDS.COMPLETED_AT]: 0,
        [PC_PRODUCTION_FIELDS.OWNER]: input.owner ?? "Unassigned",
        [PC_PRODUCTION_FIELDS.NOTES]: input.notes ?? "สร้างจาก Dashboard",
    });
    await refreshPcMaterialPlan(env);

    return created;
}
