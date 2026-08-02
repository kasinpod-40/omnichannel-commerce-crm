import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { getLarkText } from "../../utils/lark-field-value";
import { getOrderByRecordId } from "../orders/order.repository";
import { notifyPcExceptionOnce } from "./pc.alerts";
import { getPcOverview } from "./pc.service";
import type { PcOrderInventoryState } from "./pc.types";

function parseOrderInventoryState(value: unknown): PcOrderInventoryState | null {
    const text = getLarkText(value, "").trim();

    if (!text) {
        return null;
    }

    try {
        const parsed = JSON.parse(text) as PcOrderInventoryState;

        if (
            parsed.version !== 1 ||
            parsed.phase !== "applied" ||
            !Array.isArray(parsed.transitions)
        ) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

function formatQuantity(value: number): string {
    return new Intl.NumberFormat("th-TH", {
        maximumFractionDigits: 2,
    }).format(value);
}

/**
 * แจ้งเตือนเมื่อ Order ทำให้ Stock ข้ามจากเหนือ Min Stock ลงมาอยู่ที่หรือต่ำกว่า Min Stock.
 * Event ID ผูกกับ Order fingerprint และ SKU เพื่อให้ Queue retry ได้โดยไม่ยิงซ้ำ.
 */
export async function notifyLowStockAfterOrderOnce(
    env: Env,
    orderRecordId: string
): Promise<number> {
    const order = await getOrderByRecordId(env, orderRecordId);

    if (!order) {
        return 0;
    }

    const state = parseOrderInventoryState(
        order.fields[ORDER_FIELDS.PC_INVENTORY_STATE_JSON]
    );

    if (!state) {
        return 0;
    }

    const overview = await getPcOverview(env);
    const productBySku = new Map(
        overview.products.map((product) => [
            product.sku.trim().toLowerCase(),
            product,
        ])
    );
    let notifications = 0;

    for (const transition of state.transitions) {
        const product = productBySku.get(
            transition.sku.trim().toLowerCase()
        );

        if (!product) {
            continue;
        }

        const crossedLowStockThreshold =
            transition.new_stock_on_hand < transition.old_stock_on_hand &&
            transition.old_stock_on_hand > product.min_stock &&
            transition.new_stock_on_hand <= product.min_stock;

        if (!crossedLowStockThreshold) {
            continue;
        }

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

        await notifyPcExceptionOnce(env, {
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
        notifications += 1;
    }

    return notifications;
}
