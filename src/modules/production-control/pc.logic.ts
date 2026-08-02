import type {
    PcAlertLevel,
    PcBomItem,
    PcMaterial,
    PcMaterialCheckStatus,
    PcMaterialStatus,
    PcOrderAllocation,
    PcOrderInventoryState,
    PcProduct,
    PcProductTransition,
    PcProductionBatch,
    PcStockStatus,
} from "./pc.types";

const ROUND_PRECISION = 1_000_000;

function roundQuantity(value: number): number {
    return Math.round(value * ROUND_PRECISION) / ROUND_PRECISION;
}

function normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Product/Material SKU อาจมาจาก Lark, Marketplace หรือ BOM ด้วยตัวคั่นต่างกัน
 * เช่น `FAB-TWEED-IVORY`, `FAB_TWEED_IVORY` หรือ `FAB/TWEED/IVORY`
 * ทุกจุดที่ใช้ SKU เป็น Business key ต้องเรียกตัวนี้เพื่อไม่ให้ Map คนละรูปแบบ
 */
export function normalizePcBusinessKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[()\[\]{}._\-/]+/g, " ")
        .replace(/\s+/g, " ");
}

export function deriveProductInventory(
    stockOnHand: number,
    minStock: number,
    targetStock: number
): {
    stock_status: PcStockStatus;
    recommended_production_qty: number;
} {
    const stock = roundQuantity(stockOnHand);
    const minimum = Math.max(0, roundQuantity(minStock));
    const target = Math.max(minimum, roundQuantity(targetStock));

    return {
        stock_status:
            stock <= 0
                ? "OUT_OF_STOCK"
                : stock <= minimum
                  ? "LOW_STOCK"
                  : "NORMAL",
        recommended_production_qty:
            stock <= minimum
                ? Math.max(0, roundQuantity(target - stock))
                : 0,
    };
}

export function deriveAutomaticProductionNeed(input: {
    stock_on_hand: number;
    min_stock: number;
    target_stock: number;
    committed_production_qty: number;
}): number {
    const stock = roundQuantity(input.stock_on_hand);
    const minimum = Math.max(0, roundQuantity(input.min_stock));
    const target = Math.max(minimum, roundQuantity(input.target_stock));
    const committed = Math.max(
        0,
        roundQuantity(input.committed_production_qty)
    );

    if (stock > minimum) {
        return 0;
    }

    return Math.max(0, roundQuantity(target - stock - committed));
}

export function deriveMaterialInventory(input: {
    stock_on_hand: number;
    min_stock: number;
    target_stock: number;
    planned_requirement: number;
    source_type: PcMaterial["source_type"];
    lead_time_days: number;
}): {
    projected_stock: number;
    shortage_qty: number;
    material_status: PcMaterialStatus;
    recommended_reorder_qty: number;
    alert_level: PcAlertLevel;
} {
    const stock = roundQuantity(input.stock_on_hand);
    const minimum = Math.max(0, roundQuantity(input.min_stock));
    const target = Math.max(minimum, roundQuantity(input.target_stock));
    const planned = Math.max(0, roundQuantity(input.planned_requirement));
    const projected = roundQuantity(stock - planned);
    const shortage = Math.max(0, roundQuantity(-projected));

    let materialStatus: PcMaterialStatus = "NORMAL";

    if (stock <= 0 || shortage > 0) {
        materialStatus = "OUT_OF_STOCK";
    } else if (projected <= minimum) {
        materialStatus = "REORDER_REQUIRED";
    } else if (stock <= minimum) {
        materialStatus = "LOW_STOCK";
    }

    const recommendedReorder =
        projected <= minimum
            ? Math.max(0, roundQuantity(target - projected))
            : 0;

    let alertLevel: PcAlertLevel = "NONE";

    if (shortage > 0 || stock <= 0) {
        alertLevel = "CRITICAL";
    } else if (materialStatus === "REORDER_REQUIRED") {
        alertLevel =
            input.source_type === "IMPORT" && input.lead_time_days >= 30
                ? "CRITICAL"
                : "WARNING";
    } else if (materialStatus === "LOW_STOCK") {
        alertLevel = "INFO";
    }

    return {
        projected_stock: projected,
        shortage_qty: shortage,
        material_status: materialStatus,
        recommended_reorder_qty: recommendedReorder,
        alert_level: alertLevel,
    };
}

export function parseBom(materialsJson: string): PcBomItem[] {
    if (!materialsJson.trim()) {
        return [];
    }

    let parsed: unknown;

    try {
        parsed = JSON.parse(materialsJson);
    } catch {
        throw new Error("PC_BOM_INVALID_JSON");
    }

    if (!Array.isArray(parsed)) {
        throw new Error("PC_BOM_INVALID_SHAPE");
    }

    const aggregated = new Map<string, PcBomItem>();

    for (const item of parsed) {
        if (typeof item !== "object" || item === null) {
            throw new Error("PC_BOM_INVALID_ITEM");
        }

        const value = item as Record<string, unknown>;
        const materialSku = String(value.material_sku ?? "").trim();
        const quantityPerUnit = Number(value.quantity_per_unit);
        const unit = String(value.unit ?? "").trim();

        if (
            !materialSku ||
            !Number.isFinite(quantityPerUnit) ||
            quantityPerUnit <= 0 ||
            !unit
        ) {
            throw new Error("PC_BOM_INVALID_ITEM");
        }

        const key = normalizePcBusinessKey(materialSku);
        const existing = aggregated.get(key);

        if (existing && normalizeKey(existing.unit) !== normalizeKey(unit)) {
            throw new Error("PC_BOM_UNIT_CONFLICT");
        }

        aggregated.set(key, {
            material_sku: existing?.material_sku ?? materialSku,
            quantity_per_unit: roundQuantity(
                (existing?.quantity_per_unit ?? 0) + quantityPerUnit
            ),
            unit: existing?.unit ?? unit,
        });
    }

    return [...aggregated.values()].sort((left, right) =>
        left.material_sku.localeCompare(right.material_sku)
    );
}

export function normalizeAllocations(
    allocations: PcOrderAllocation[]
): PcOrderAllocation[] {
    const aggregated = new Map<string, PcOrderAllocation>();

    for (const allocation of allocations) {
        const sku = allocation.sku.trim();
        const quantity = Number(allocation.quantity);

        if (!sku || !Number.isFinite(quantity) || quantity <= 0) {
            continue;
        }

        const key = normalizeKey(sku);
        const existing = aggregated.get(key);

        aggregated.set(key, {
            sku: existing?.sku ?? sku,
            quantity: roundQuantity(
                (existing?.quantity ?? 0) + quantity
            ),
        });
    }

    return [...aggregated.values()].sort((left, right) =>
        left.sku.localeCompare(right.sku)
    );
}

export function allocationFingerprint(
    allocations: PcOrderAllocation[]
): string {
    return normalizeAllocations(allocations)
        .map((allocation) => `${normalizeKey(allocation.sku)}:${allocation.quantity}`)
        .join("|");
}

export function allocationsFromState(
    state: PcOrderInventoryState | null
): PcOrderAllocation[] {
    if (!state) {
        return [];
    }

    if (state.phase === "applied" || state.phase === "released") {
        return normalizeAllocations(state.allocations);
    }

    return normalizeAllocations(
        state.previous_allocations ??
            (state.transitions.length === 0 ? state.allocations : [])
    );
}

export function buildProductTransitions(input: {
    products: PcProduct[];
    previous_allocations: PcOrderAllocation[];
    target_allocations: PcOrderAllocation[];
}): PcProductTransition[] {
    const productsBySku = new Map(
        input.products.map((product) => [normalizeKey(product.sku), product])
    );
    const previous = new Map(
        normalizeAllocations(input.previous_allocations).map((allocation) => [
            normalizeKey(allocation.sku),
            allocation.quantity,
        ])
    );
    const target = new Map(
        normalizeAllocations(input.target_allocations).map((allocation) => [
            normalizeKey(allocation.sku),
            allocation.quantity,
        ])
    );
    const keys = new Set([...previous.keys(), ...target.keys()]);
    const transitions: PcProductTransition[] = [];

    for (const key of [...keys].sort()) {
        const product = productsBySku.get(key);

        if (!product) {
            throw new Error(`PC_PRODUCT_NOT_FOUND:${key}`);
        }

        const previousQty = previous.get(key) ?? 0;
        const targetQty = target.get(key) ?? 0;
        const delta = roundQuantity(targetQty - previousQty);

        if (delta === 0) {
            continue;
        }

        transitions.push({
            record_id: product.record_id,
            sku: product.sku,
            previous_allocated_qty: previousQty,
            target_allocated_qty: targetQty,
            delta_allocated_qty: delta,
            old_stock_on_hand: product.stock_on_hand,
            new_stock_on_hand: roundQuantity(
                product.stock_on_hand - delta
            ),
        });
    }

    return transitions;
}

export function productionMaterialRequirements(
    batches: PcProductionBatch[],
    products: PcProduct[]
): Map<string, number> {
    const productBySku = new Map(
        products.map((product) => [
            normalizePcBusinessKey(product.sku),
            product,
        ])
    );
    const requirements = new Map<string, number>();

    for (const batch of batches) {
        if (
            batch.production_status === "COMPLETED" ||
            batch.production_status === "CANCELLED"
        ) {
            continue;
        }

        const product = productBySku.get(
            normalizePcBusinessKey(batch.product_sku)
        );

        if (!product) {
            continue;
        }

        let bom: PcBomItem[];

        try {
            bom = parseBom(product.materials_json);
        } catch {
            continue;
        }

        const plannedQty = Math.max(0, batch.planned_qty || batch.recommended_qty);

        for (const item of bom) {
            const key = normalizePcBusinessKey(item.material_sku);
            requirements.set(
                key,
                roundQuantity(
                    (requirements.get(key) ?? 0) +
                        item.quantity_per_unit * plannedQty
                )
            );
        }
    }

    return requirements;
}

export function checkBatchMaterials(input: {
    product: PcProduct | null;
    planned_qty: number;
    materials: PcMaterial[];
}): {
    status: PcMaterialCheckStatus;
    requirement_summary: string;
    risk_summary: string;
} {
    if (!input.product) {
        return {
            status: "BOM_MISSING",
            requirement_summary: "",
            risk_summary: "ไม่พบสินค้าใน PC_Products",
        };
    }

    let bom: PcBomItem[];

    try {
        bom = parseBom(input.product.materials_json);
    } catch {
        return {
            status: "BOM_MISSING",
            requirement_summary: "",
            risk_summary: "สูตรวัตถุดิบไม่ถูกต้อง",
        };
    }

    if (bom.length === 0) {
        return {
            status: "BOM_MISSING",
            requirement_summary: "",
            risk_summary: "ยังไม่มีสูตรวัตถุดิบ",
        };
    }

    const materialsBySku = new Map(
        input.materials.map((material) => [
            normalizePcBusinessKey(material.material_sku),
            material,
        ])
    );
    const requirements: string[] = [];
    const risks: string[] = [];
    const quantity = Math.max(0, input.planned_qty);

    for (const item of bom) {
        const required = roundQuantity(item.quantity_per_unit * quantity);
        const material = materialsBySku.get(
            normalizePcBusinessKey(item.material_sku)
        );
        requirements.push(`${item.material_sku} ${required} ${item.unit}`);

        if (!material) {
            risks.push(`${item.material_sku}: ไม่พบวัตถุดิบ`);
            continue;
        }

        if (material.shortage_qty > 0) {
            risks.push(
                `${material.material_sku}: แผนผลิตรวมขาด ${roundQuantity(
                    material.shortage_qty
                )} ${material.unit}`
            );
        } else if (material.stock_on_hand < required) {
            risks.push(
                `${material.material_sku}: Batch นี้ขาด ${roundQuantity(
                    required - material.stock_on_hand
                )} ${material.unit}`
            );
        }
    }

    return {
        status: risks.length > 0 ? "INSUFFICIENT" : "SUFFICIENT",
        requirement_summary: requirements.join(" | "),
        risk_summary: risks.join(" | "),
    };
}
