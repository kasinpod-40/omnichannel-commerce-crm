import type { Env } from "../../config/env";
import type { NotificationType } from "../notifications/notification.types";
import {
    getPcProductionByRecordId,
    listPcMaterials,
    listPcProduction,
    listPcProducts,
} from "./pc.repository";
import { parseBom } from "./pc.logic";
import type {
    PcMaterial,
    PcProduct,
    PcProductionBatch,
} from "./pc.types";
import {
    createPcWorkflowActionUrl,
    type PcWorkflowAction,
} from "./pc.action-token";
import type { PcLarkActionCardInput } from "./pc.lark-card";

const ACTIVE_STATUSES = new Set([
    "RECOMMENDED",
    "APPROVED",
    "IN_PROGRESS",
    "BLOCKED_MATERIAL",
]);

type CardAction = {
    action: PcWorkflowAction;
    text: string;
    template: "orange" | "red" | "green";
};

function normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function quantity(value: number): string {
    return new Intl.NumberFormat("th-TH", {
        maximumFractionDigits: 2,
    }).format(value);
}

function plannedQuantity(batch: PcProductionBatch): number {
    return Math.max(0, batch.planned_qty || batch.recommended_qty);
}

function statusLabel(batch: PcProductionBatch): string {
    const labels: Record<PcProductionBatch["production_status"], string> = {
        RECOMMENDED: "รออนุมัติผลิต",
        APPROVED: "อนุมัติแล้ว",
        IN_PROGRESS: "กำลังผลิต",
        BLOCKED_MATERIAL: "รออนุมัติและตรวจวัตถุดิบ",
        COMPLETED: "ผลิตเสร็จแล้ว",
        CANCELLED: "ยกเลิกแล้ว",
    };
    return labels[batch.production_status];
}

function actionForBatch(batch: PcProductionBatch): CardAction | null {
    if (batch.production_status === "RECOMMENDED") {
        return {
            action: "approve-production",
            text: "อนุมัติผลิตสินค้า",
            template: "orange",
        };
    }

    if (batch.production_status === "BLOCKED_MATERIAL") {
        return {
            action: "purchase-materials",
            text: "อนุมัติสั่งซื้อวัตถุดิบ",
            template: "red",
        };
    }

    if (
        batch.production_status === "APPROVED" ||
        batch.production_status === "IN_PROGRESS"
    ) {
        return {
            action: "complete-production",
            text: "ผลิตเสร็จครบตามแผน",
            template: "green",
        };
    }

    return null;
}

async function cardForBatch(
    env: Env,
    batch: PcProductionBatch,
    input: {
        title: string;
        markdown: string;
        template?: "blue" | "green" | "orange" | "red" | "grey";
        action?: CardAction | null;
    }
): Promise<PcLarkActionCardInput> {
    const action =
        input.action === undefined ? actionForBatch(batch) : input.action;
    const actions = action
        ? [
              {
                  text: action.text,
                  url: await createPcWorkflowActionUrl(env, {
                      action: action.action,
                      production_record_id: batch.record_id,
                  }),
                  style: "primary" as const,
              },
          ]
        : [];

    return {
        title: input.title,
        markdown: input.markdown,
        template: input.template ?? action?.template ?? "orange",
        actions,
    };
}

function findProduct(
    products: PcProduct[],
    batch: PcProductionBatch
): PcProduct | null {
    const key = normalizeKey(batch.product_sku);
    return products.find((product) => normalizeKey(product.sku) === key) ?? null;
}

function hasCompleteCardIdentity(batch: PcProductionBatch): boolean {
    return Boolean(
        batch.production_id.trim() &&
            batch.product_sku.trim() &&
            batch.product_name.trim()
    );
}

async function hydrateProgressCardBatch(
    env: Env,
    batch: PcProductionBatch
): Promise<PcProductionBatch> {
    if (hasCompleteCardIdentity(batch)) {
        return batch;
    }

    // Lark Update Record may return only the fields changed by the PUT request.
    // Re-read the full Production row before rendering a customer-facing Card,
    // while preserving the just-written status and quantity from the update result.
    const current = await getPcProductionByRecordId(env, batch.record_id);
    if (!current) {
        throw new Error(
            `PC_PRODUCTION_CARD_IDENTITY_MISSING:record:${batch.record_id}`
        );
    }

    const hydrated: PcProductionBatch = {
        ...current,
        production_status: batch.production_status,
        planned_qty:
            batch.planned_qty > 0 ? batch.planned_qty : current.planned_qty,
        recommended_qty:
            batch.recommended_qty > 0
                ? batch.recommended_qty
                : current.recommended_qty,
    };

    if (!hydrated.product_name.trim() && hydrated.product_sku.trim()) {
        const product = findProduct(await listPcProducts(env), hydrated);
        if (product?.product_name.trim()) {
            hydrated.product_name = product.product_name.trim();
        }
    }

    const missing = [
        ["production_id", hydrated.production_id],
        ["product_sku", hydrated.product_sku],
        ["product_name", hydrated.product_name],
    ]
        .filter(([, value]) => !value.trim())
        .map(([field]) => field);

    if (missing.length > 0) {
        throw new Error(
            `PC_PRODUCTION_CARD_IDENTITY_MISSING:${missing.join(",")}:${batch.record_id}`
        );
    }

    return hydrated;
}

function shortageLines(input: {
    batch: PcProductionBatch;
    product: PcProduct | null;
    materials: PcMaterial[];
}): string[] {
    if (!input.product) {
        return input.batch.material_risk_summary
            ? [input.batch.material_risk_summary]
            : ["ไม่พบข้อมูลสินค้าและสูตรวัตถุดิบ"];
    }

    let bom;
    try {
        bom = parseBom(input.product.materials_json);
    } catch {
        return ["สูตรวัตถุดิบไม่ถูกต้อง"];
    }

    const materialBySku = new Map(
        input.materials.map((material) => [
            normalizeKey(material.material_sku),
            material,
        ])
    );
    const planned = plannedQuantity(input.batch);
    const lines: string[] = [];

    for (const item of bom) {
        const material = materialBySku.get(normalizeKey(item.material_sku));
        const required = item.quantity_per_unit * planned;
        if (!material) {
            lines.push(`• ${item.material_sku}: ไม่พบรายการวัตถุดิบ`);
            continue;
        }

        const shortage = Math.max(
            0,
            required - material.stock_on_hand,
            material.shortage_qty
        );
        if (shortage <= 0) continue;

        lines.push(
            `• ${material.material_name || material.material_sku}: ต้องใช้ ${quantity(required)} ${material.unit}, ` +
                `มี ${quantity(material.stock_on_hand)} ${material.unit}, ขาด ${quantity(shortage)} ${material.unit}`
        );
    }

    if (lines.length === 0 && input.batch.material_risk_summary) {
        lines.push(input.batch.material_risk_summary);
    }

    return lines.length > 0 ? lines : ["กรุณาตรวจสอบยอดวัตถุดิบล่าสุด"];
}

async function buildMaterialShortageCard(
    env: Env,
    batch: PcProductionBatch
): Promise<PcLarkActionCardInput> {
    const [products, materials] = await Promise.all([
        listPcProducts(env),
        listPcMaterials(env),
    ]);
    const product = findProduct(products, batch);
    const risks = shortageLines({ batch, product, materials });

    return await cardForBatch(env, batch, {
        title: "🧵 วัตถุดิบไม่เพียงพอ",
        template: "red",
        markdown: [
            `**สินค้า:** ${batch.product_name || batch.product_sku}`,
            `**แผนผลิต:** ${batch.production_id}`,
            `**จำนวนผลิต:** ${quantity(plannedQuantity(batch))} ชิ้น`,
            "",
            ...risks,
            "",
            "กดอนุมัติสั่งซื้อเพื่อจำลองรับวัตถุดิบเข้า แล้วระบบจะเริ่มผลิตต่ออัตโนมัติ",
        ].join("\n"),
    });
}

export async function buildPcNotificationActionCard(
    env: Env,
    input: {
        notification_type: Extract<
            NotificationType,
            "PC_STOCK_EXCEPTION" | "PC_MATERIAL_SHORTAGE"
        >;
        reference_id: string;
        fallback_text: string;
    }
): Promise<PcLarkActionCardInput | null> {
    const production = await listPcProduction(env);
    let batch: PcProductionBatch | undefined;

    if (input.notification_type === "PC_STOCK_EXCEPTION") {
        const sku = normalizeKey(input.reference_id);
        batch = production
            .filter(
                (item) =>
                    normalizeKey(item.product_sku) === sku &&
                    ACTIVE_STATUSES.has(item.production_status)
            )
            .sort(
                (left, right) =>
                    right.created_at - left.created_at ||
                    right.record_id.localeCompare(left.record_id)
            )[0];
    } else {
        batch = production.find(
            (item) =>
                item.record_id === input.reference_id ||
                item.production_id === input.reference_id
        );
    }

    if (!batch) return null;

    if (input.notification_type === "PC_MATERIAL_SHORTAGE") {
        return await buildMaterialShortageCard(env, batch);
    }

    if (
        batch.production_status === "RECOMMENDED" ||
        batch.production_status === "BLOCKED_MATERIAL"
    ) {
        return await cardForBatch(env, batch, {
            title: "📦 สินค้าใกล้หมด",
            template: "orange",
            action: {
                action: "approve-production",
                text: "อนุมัติผลิตสินค้า",
                template: "orange",
            },
            markdown: [
                input.fallback_text,
                "",
                `**แผนผลิต:** ${batch.production_id}`,
                `**สถานะ:** ${statusLabel(batch)}`,
                `**จำนวนตามแผน:** ${quantity(plannedQuantity(batch))} ชิ้น`,
                "",
                "เมื่อกดอนุมัติ ระบบจะตรวจวัตถุดิบก่อนเริ่มผลิต",
            ].join("\n"),
        });
    }

    return await cardForBatch(env, batch, {
        title: "🏭 สินค้ากำลังผลิต",
        template: "green",
        markdown: [
            input.fallback_text,
            "",
            `**แผนผลิต:** ${batch.production_id}`,
            `**สถานะ:** ${statusLabel(batch)}`,
            `**จำนวนตามแผน:** ${quantity(plannedQuantity(batch))} ชิ้น`,
        ].join("\n"),
    });
}

export async function buildProductionProgressCard(
    env: Env,
    batch: PcProductionBatch
): Promise<PcLarkActionCardInput> {
    const hydrated = await hydrateProgressCardBatch(env, batch);

    return await cardForBatch(env, hydrated, {
        title: "🏭 เริ่มผลิตสินค้าแล้ว",
        template: "green",
        markdown: [
            `**สินค้า:** ${hydrated.product_name}`,
            `**SKU:** ${hydrated.product_sku}`,
            `**แผนผลิต:** ${hydrated.production_id}`,
            `**จำนวนผลิต:** ${quantity(plannedQuantity(hydrated))} ชิ้น`,
            `**สถานะ:** ${statusLabel(hydrated)}`,
            "",
            "เมื่อผลิตเสร็จ กดปุ่มด้านล่างเพื่อหักวัตถุดิบและรับสินค้าสำเร็จรูปเข้า Stock",
        ].join("\n"),
    });
}

export function buildProductionCompletedCard(input: {
    batch: PcProductionBatch;
    actual_qty: number;
    stock_on_hand?: number;
}): PcLarkActionCardInput {
    return {
        title: "✅ ผลิตเสร็จและรับสินค้าเข้าสต็อกแล้ว",
        template: "green",
        markdown: [
            `**สินค้า:** ${input.batch.product_name || input.batch.product_sku}`,
            `**SKU:** ${input.batch.product_sku}`,
            `**แผนผลิต:** ${input.batch.production_id}`,
            `**ผลิตสำเร็จ:** ${quantity(input.actual_qty)} ชิ้น`,
            input.stock_on_hand === undefined
                ? ""
                : `**Stock ปัจจุบัน:** ${quantity(input.stock_on_hand)} ชิ้น`,
            "",
            "ระบบหักวัตถุดิบตาม BOM และอัปเดต Stock สินค้าสำเร็จรูปเรียบร้อยแล้ว",
        ]
            .filter(Boolean)
            .join("\n"),
        actions: [],
    };
}
