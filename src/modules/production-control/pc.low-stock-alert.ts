import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { getLarkText } from "../../utils/lark-field-value";
import { getOrderByRecordId } from "../orders/order.repository";
import { notifyPcExceptionOnce } from "./pc.alerts";
import { getPcOverview } from "./pc.service";
import type { PcOrderInventoryState, PcProduct } from "./pc.types";

const DEFAULT_STATE_READ_DELAYS_MS = [0, 250, 500, 1_000, 2_000, 4_000] as const;

export type PcLowStockEvaluationMode =
    | "threshold_crossing"
    | "current_low_stock_recovery";

export type PcLowStockDiagnosticReason =
    | "MATCHED"
    | "LOW_STOCK_AFTER_ORDER"
    | "RECOVERY_CURRENT_LOW_STOCK"
    | "PRODUCT_NOT_FOUND"
    | "STOCK_NOT_DECREASED"
    | "STILL_ABOVE_MIN";

export type PcLowStockDiagnostic = {
    transition_record_id: string;
    transition_sku: string;
    resolved_sku: string | null;
    old_stock_on_hand: number;
    new_stock_on_hand: number;
    min_stock: number | null;
    reason: PcLowStockDiagnosticReason;
    message: string;
};

export type PcLowStockNotificationResult = {
    state_ready: boolean;
    matched: number;
    dispatched: number;
    failed: number;
    errors: string[];
    diagnostics: PcLowStockDiagnostic[];
};

type LowStockReadOptions = {
    retryDelaysMs?: readonly number[];
    inventoryState?: PcOrderInventoryState | null;
    evaluationMode?: PcLowStockEvaluationMode;
};

function emptyResult(stateReady: boolean): PcLowStockNotificationResult {
    return {
        state_ready: stateReady,
        matched: 0,
        dispatched: 0,
        failed: 0,
        errors: [],
        diagnostics: [],
    };
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
            !Array.isArray(parsed.transitions)
        ) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function waitForState(delayMs: number): Promise<void> {
    if (delayMs <= 0) {
        return Promise.resolve();
    }

    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function validProvidedState(
    state: PcOrderInventoryState | null | undefined,
    orderRecordId: string
): PcOrderInventoryState | null {
    if (
        !state ||
        state.version !== 1 ||
        state.phase !== "applied" ||
        !Array.isArray(state.transitions)
    ) {
        return null;
    }

    // Caller ของ recovery ยืนยัน Order จาก record จริงแล้ว จึงซ่อม metadata เก่าที่
    // อาจไม่มี/มี order_record_id ไม่ตรง โดยไม่แตะ allocations หรือ Stock transition.
    return state.order_record_id === orderRecordId
        ? state
        : {
              ...state,
              order_record_id: orderRecordId,
          };
}

async function readAppliedInventoryState(
    env: Env,
    orderRecordId: string,
    retryDelaysMs: readonly number[]
): Promise<PcOrderInventoryState | null> {
    for (const delayMs of retryDelaysMs) {
        await waitForState(delayMs);

        const order = await getOrderByRecordId(env, orderRecordId);
        if (!order) {
            continue;
        }

        const state = parseOrderInventoryState(
            order.fields[ORDER_FIELDS.PC_INVENTORY_STATE_JSON]
        );

        if (!state) {
            continue;
        }

        if (state.phase === "applied") {
            return validProvidedState(state, orderRecordId);
        }

        if (state.phase !== "prepared") {
            return null;
        }
    }

    console.warn("PC_LOW_STOCK_STATE_NOT_READY", {
        order_record_id: orderRecordId,
        attempts: retryDelaysMs.length,
    });
    return null;
}

function formatQuantity(value: number): string {
    return new Intl.NumberFormat("th-TH", {
        maximumFractionDigits: 2,
    }).format(value);
}

function normalizeProductKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[()\[\]{}._\-/]+/g, " ")
        .replace(/\s+/g, " ");
}

function resolveTransitionProduct(
    productsByRecordId: Map<string, PcProduct>,
    productsBySku: Map<string, PcProduct>,
    transition: PcOrderInventoryState["transitions"][number]
): PcProduct | null {
    return (
        productsByRecordId.get(transition.record_id) ??
        productsBySku.get(normalizeProductKey(transition.sku)) ??
        null
    );
}

function diagnosticForTransition(input: {
    transition: PcOrderInventoryState["transitions"][number];
    product: PcProduct | null;
    evaluationMode: PcLowStockEvaluationMode;
}): PcLowStockDiagnostic {
    const { transition, product, evaluationMode } = input;
    const base = {
        transition_record_id: transition.record_id,
        transition_sku: transition.sku,
        resolved_sku: product?.sku ?? null,
        old_stock_on_hand: transition.old_stock_on_hand,
        new_stock_on_hand: transition.new_stock_on_hand,
        min_stock: product?.min_stock ?? null,
    };

    if (!product) {
        return {
            ...base,
            reason: "PRODUCT_NOT_FOUND",
            message:
                `หา Product ของ SKU ${transition.sku || "ไม่ระบุ"} ไม่พบ ` +
                `(record ${transition.record_id || "ไม่ระบุ"})`,
        };
    }

    if (transition.new_stock_on_hand >= transition.old_stock_on_hand) {
        return {
            ...base,
            reason: "STOCK_NOT_DECREASED",
            message:
                `SKU ${product.sku}: Stock ไม่ได้ลดลง ` +
                `(${formatQuantity(transition.old_stock_on_hand)} → ${formatQuantity(transition.new_stock_on_hand)})`,
        };
    }

    if (evaluationMode === "current_low_stock_recovery") {
        if (transition.new_stock_on_hand > product.min_stock) {
            return {
                ...base,
                reason: "STILL_ABOVE_MIN",
                message:
                    `SKU ${product.sku}: หลัง Order ยังเหลือ ${formatQuantity(transition.new_stock_on_hand)} ` +
                    `มากกว่า Min ${formatQuantity(product.min_stock)}`,
            };
        }

        return {
            ...base,
            reason: "RECOVERY_CURRENT_LOW_STOCK",
            message:
                `SKU ${product.sku}: ส่ง Recovery จาก Stock หลัง Order ` +
                `${formatQuantity(transition.new_stock_on_hand)} ซึ่งเท่ากับหรือต่ำกว่า Min ` +
                `${formatQuantity(product.min_stock)} ` +
                `(ก่อน Order ${formatQuantity(transition.old_stock_on_hand)})`,
        };
    }

    if (transition.new_stock_on_hand > product.min_stock) {
        return {
            ...base,
            reason: "STILL_ABOVE_MIN",
            message:
                `SKU ${product.sku}: หลัง Order ยังเหลือ ${formatQuantity(transition.new_stock_on_hand)} ` +
                `มากกว่า Min ${formatQuantity(product.min_stock)}`,
        };
    }

    if (transition.old_stock_on_hand <= product.min_stock) {
        return {
            ...base,
            reason: "LOW_STOCK_AFTER_ORDER",
            message:
                `SKU ${product.sku}: หลัง Order ใหม่ Stock ลดจาก ` +
                `${formatQuantity(transition.old_stock_on_hand)} → ${formatQuantity(transition.new_stock_on_hand)} ` +
                `และยังเท่ากับหรือต่ำกว่า Min ${formatQuantity(product.min_stock)}`,
        };
    }

    return {
        ...base,
        reason: "MATCHED",
        message:
            `SKU ${product.sku}: Stock ข้ามเกณฑ์ ` +
            `${formatQuantity(transition.old_stock_on_hand)} → ${formatQuantity(transition.new_stock_on_hand)} ` +
            `(Min ${formatQuantity(product.min_stock)})`,
    };
}

function diagnosticMatches(
    reason: PcLowStockDiagnosticReason
): boolean {
    return (
        reason === "MATCHED" ||
        reason === "LOW_STOCK_AFTER_ORDER" ||
        reason === "RECOVERY_CURRENT_LOW_STOCK"
    );
}

function buildLowStockMessage(input: {
    product: PcProduct;
    newStock: number;
    stockLabel: string;
}): {
    detail: string;
    nextAction: string;
    larkText: string;
} {
    const { product, newStock, stockLabel } = input;
    const variant = [product.color, product.size]
        .filter(Boolean)
        .join(" / ");
    const replenishQty = Math.max(0, product.target_stock - newStock);
    const detailLines = [
        variant ? `สี / ไซซ์: ${variant}` : "",
        `SKU: ${product.sku}`,
        `คงเหลือ: ${formatQuantity(newStock)} ชิ้น`,
        `ขั้นต่ำ: ${formatQuantity(product.min_stock)} ชิ้น`,
        `ควรเติม: ${formatQuantity(replenishQty)} ชิ้น`,
        `เป้าหมาย: ${formatQuantity(product.target_stock)} ชิ้น`,
    ].filter(Boolean);
    const nextAction =
        "ตรวจสอบวัตถุดิบและยืนยันแผนผลิตที่ระบบสร้างไว้";

    return {
        detail: detailLines.join("\n"),
        nextAction,
        larkText: [
            `[CRM] 📦 ${stockLabel}`,
            "",
            `สินค้า: ${product.product_name}`,
            ...detailLines,
            "",
            `การดำเนินการ: ${nextAction}`,
        ].join("\n"),
    };
}

/**
 * ทุก Order ใหม่ที่ทำให้ Stock หลังสั่งอยู่ที่หรือต่ำกว่า Min จะมี Alert ของ Order นั้น
 * เพื่อเตือนซ้ำจนกว่าจะเติม Stock โดย Event ID ต่อ Order/SKU ยังป้องกัน Queue retry ยิงซ้ำ.
 * Recovery แบบสั่งโดย Operator ใช้ state เดิมเพื่อกู้ข้อความ โดยไม่ Reconcile หรือเปลี่ยน Stock.
 */
export async function notifyLowStockAfterOrderOnce(
    env: Env,
    orderRecordId: string,
    options: LowStockReadOptions = {}
): Promise<PcLowStockNotificationResult> {
    const providedState = validProvidedState(
        options.inventoryState,
        orderRecordId
    );
    const retryDelaysMs =
        options.retryDelaysMs?.length
            ? options.retryDelaysMs
            : DEFAULT_STATE_READ_DELAYS_MS;
    const evaluationMode =
        options.evaluationMode ?? "threshold_crossing";
    const state =
        providedState ??
        (await readAppliedInventoryState(
            env,
            orderRecordId,
            retryDelaysMs
        ));

    if (!state) {
        const result = emptyResult(false);
        result.failed = 1;
        result.errors.push(
            "ไม่พบ Inventory state แบบ applied ของ Order สำหรับประเมินแจ้งเตือน"
        );
        return result;
    }

    const overview = await getPcOverview(env);
    const productsByRecordId = new Map(
        overview.products.map((product) => [product.record_id, product])
    );
    const productsBySku = new Map(
        overview.products.map((product) => [
            normalizeProductKey(product.sku),
            product,
        ])
    );
    const result = emptyResult(true);

    for (const transition of state.transitions) {
        const product = resolveTransitionProduct(
            productsByRecordId,
            productsBySku,
            transition
        );
        const diagnostic = diagnosticForTransition({
            transition,
            product,
            evaluationMode,
        });
        result.diagnostics.push(diagnostic);

        if (!product) {
            result.failed += 1;
            result.errors.push(diagnostic.message);
            continue;
        }

        if (!diagnosticMatches(diagnostic.reason)) {
            continue;
        }

        result.matched += 1;
        const stockLabel =
            transition.new_stock_on_hand <= 0
                ? "สินค้าหมด"
                : "สินค้าใกล้หมด";
        const eventKind =
            evaluationMode === "current_low_stock_recovery"
                ? "low-stock-recovery"
                : "low-stock";
        const message = buildLowStockMessage({
            product,
            newStock: transition.new_stock_on_hand,
            stockLabel,
        });
        const dispatched = await notifyPcExceptionOnce(env, {
            event_id: [
                "pc",
                eventKind,
                orderRecordId,
                state.fingerprint || "no-fingerprint",
                product.sku,
            ].join(":"),
            type: "PC_STOCK_EXCEPTION",
            reference_id: product.sku,
            product_name: product.product_name,
            detail: message.detail,
            next_action: message.nextAction,
            lark_text: message.larkText,
        });

        if (dispatched) {
            result.dispatched += 1;
            continue;
        }

        result.failed += 1;
        result.errors.push(
            `ไม่สามารถสร้างหรือส่ง Notification สำหรับ SKU ${product.sku}`
        );
    }

    return result;
}
