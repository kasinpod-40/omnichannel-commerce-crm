import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { getLarkText } from "../../utils/lark-field-value";
import { getOrderByRecordId } from "../orders/order.repository";
import { notifyPcExceptionOnce } from "./pc.alerts";
import { getPcOverview } from "./pc.service";
import type { PcOrderInventoryState, PcProduct } from "./pc.types";

const DEFAULT_STATE_READ_DELAYS_MS = [0, 250, 500, 1_000, 2_000, 4_000] as const;

export type PcLowStockDiagnosticReason =
    | "MATCHED"
    | "PRODUCT_NOT_FOUND"
    | "STOCK_NOT_DECREASED"
    | "ALREADY_AT_OR_BELOW_MIN"
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
}): PcLowStockDiagnostic {
    const { transition, product } = input;
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

    if (transition.old_stock_on_hand <= product.min_stock) {
        return {
            ...base,
            reason: "ALREADY_AT_OR_BELOW_MIN",
            message:
                `SKU ${product.sku}: ก่อน Order มี Stock ${formatQuantity(transition.old_stock_on_hand)} ` +
                `ซึ่งเท่ากับหรือต่ำกว่า Min ${formatQuantity(product.min_stock)} อยู่แล้ว`,
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

    return {
        ...base,
        reason: "MATCHED",
        message:
            `SKU ${product.sku}: Stock ข้ามเกณฑ์ ` +
            `${formatQuantity(transition.old_stock_on_hand)} → ${formatQuantity(transition.new_stock_on_hand)} ` +
            `(Min ${formatQuantity(product.min_stock)})`,
    };
}

/**
 * แจ้งเตือนเมื่อ Order ทำให้ Stock ข้ามจากเหนือ Min Stock ลงมาอยู่ที่หรือต่ำกว่า Min Stock.
 * Event ID ผูกกับ Order fingerprint และ SKU เพื่อให้ Queue retry ได้โดยไม่ยิงซ้ำ.
 * Caller ที่มี Inventory state หลัง Reconcile แล้วควรส่งเข้ามาโดยตรง เพื่อไม่พึ่ง
 * read-after-write consistency ของ Lark. เส้นทางอื่นยังมี bounded retry เป็น fallback.
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
        const diagnostic = diagnosticForTransition({ transition, product });
        result.diagnostics.push(diagnostic);

        if (!product) {
            result.failed += 1;
            result.errors.push(diagnostic.message);
            continue;
        }

        if (diagnostic.reason !== "MATCHED") {
            continue;
        }

        result.matched += 1;
        const stockLabel =
            transition.new_stock_on_hand <= 0
                ? "สินค้าหมด"
                : "สินค้าใกล้หมด";
        const variant = [product.color, product.size]
            .filter(Boolean)
            .join(" ");
        const productLabel = [product.product_name, variant]
            .filter(Boolean)
            .join(" · ");
        const dispatched = await notifyPcExceptionOnce(env, {
            event_id: [
                "pc",
                "low-stock",
                orderRecordId,
                state.fingerprint || "no-fingerprint",
                product.sku,
            ].join(":"),
            type: "PC_STOCK_EXCEPTION",
            reference_id: product.sku,
            product_name: productLabel,
            detail: `${stockLabel}: ${productLabel} (${product.sku}) คงเหลือ ${formatQuantity(transition.new_stock_on_hand)} ชิ้น จากขั้นต่ำ ${formatQuantity(product.min_stock)} ชิ้น`,
            next_action: `ตรวจสอบแผนผลิตอัตโนมัติและเติม Stock ให้ถึงเป้าหมาย ${formatQuantity(product.target_stock)} ชิ้น`,
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
