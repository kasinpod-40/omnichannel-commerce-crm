import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { getLarkText } from "../../utils/lark-field-value";
import { listOrders } from "../orders/order.repository";
import { notifyLowStockAfterOrderOnce } from "../production-control/pc.low-stock-alert";
import type { PcOrderInventoryState } from "../production-control/pc.types";
import { OperationalError } from "../../utils/errors";
import { assertDemoShopSafeMode } from "./demo-shop.service";
import type { DemoShopNotificationRetryResult } from "./demo-shop.types";

const DEMO_STORE_ID = "demo-shop-shopee-th";

function retryError(
    code: string,
    message: string,
    status = 422
): OperationalError {
    return new OperationalError(code, message, {
        retryable: false,
        status,
    });
}

function demoSafeEnv(env: Env): Env {
    return {
        ...env,
        PC_INVENTORY_ENABLED: "false",
    };
}

function demoPcEnv(env: Env): Env {
    return {
        ...env,
        PC_INVENTORY_ENABLED: "true",
    };
}

function normalizeOrderNumber(value: string): string {
    const normalized = value.trim();

    if (!normalized || normalized.length > 160) {
        throw retryError(
            "DEMO_SHOP_ORDER_NUMBER_INVALID",
            "กรุณาระบุเลขที่ Order สาธิตที่ถูกต้อง",
            400
        );
    }

    return normalized;
}

function parseAppliedState(value: unknown): PcOrderInventoryState {
    const text = getLarkText(value, "").trim();

    try {
        const parsed = JSON.parse(text) as PcOrderInventoryState;

        if (
            parsed.version === 1 &&
            parsed.phase === "applied" &&
            Array.isArray(parsed.transitions)
        ) {
            return parsed;
        }
    } catch {
        // แปลงเป็น OperationalError ด้านล่าง
    }

    throw retryError(
        "DEMO_SHOP_ORDER_STATE_NOT_APPLIED",
        "Order นี้ยังไม่มี Inventory state แบบ applied สำหรับส่งแจ้งเตือน",
        409
    );
}

/**
 * ส่ง Low-stock Notification จาก state เดิมโดยไม่ Reconcile และไม่แก้ Stock.
 * Recovery ใช้ Stock หลัง Order <= Min เป็นเกณฑ์ เพื่อกู้ข้อความที่พลาดแม้สินค้า
 * จะต่ำกว่า Min อยู่ก่อน Order นั้นแล้ว ส่วน Flow อัตโนมัติยังใช้ crossing-only.
 */
export async function retryDemoShopLowStockNotification(
    env: Env,
    orderNumberInput: string
): Promise<DemoShopNotificationRetryResult> {
    assertDemoShopSafeMode(demoSafeEnv(env));
    const orderNumber = normalizeOrderNumber(orderNumberInput);
    const orders = await listOrders(env);
    const order = orders.find((candidate) => {
        const candidateOrderNumber = getLarkText(
            candidate.fields[ORDER_FIELDS.ORDER_NUMBER]
        ).trim();
        const channel = getLarkText(
            candidate.fields[ORDER_FIELDS.CHANNEL]
        ).trim();
        const storeId = getLarkText(
            candidate.fields[ORDER_FIELDS.MARKETPLACE_STORE_ID]
        ).trim();
        const externalOrderId = getLarkText(
            candidate.fields[ORDER_FIELDS.EXTERNAL_ORDER_ID]
        ).trim();

        return (
            candidateOrderNumber === orderNumber &&
            channel === "Shopee" &&
            (storeId === DEMO_STORE_ID ||
                externalOrderId.startsWith("DEMO-SHP-"))
        );
    });

    if (!order) {
        throw retryError(
            "DEMO_SHOP_ORDER_NOT_FOUND",
            "ไม่พบ Shopee Demo Order ตามเลขที่ระบุ",
            404
        );
    }

    const state = parseAppliedState(
        order.fields[ORDER_FIELDS.PC_INVENTORY_STATE_JSON]
    );
    const result = await notifyLowStockAfterOrderOnce(
        demoPcEnv(env),
        order.record_id,
        {
            inventoryState: state,
            evaluationMode: "current_low_stock_recovery",
        }
    );
    const evaluationMessages = result.diagnostics.map(
        (diagnostic) => diagnostic.message
    );
    const failed = !result.state_ready || result.failed > 0;

    return {
        ok: !failed,
        order_number: orderNumber,
        stock_unchanged: true,
        notification: {
            status: failed
                ? "FAILED"
                : result.matched > 0
                  ? "QUEUED"
                  : "NOT_REQUIRED",
            threshold_crossed: result.matched > 0,
            dispatched: result.dispatched,
            failed: failed ? Math.max(1, result.failed) : 0,
            error_messages:
                result.errors.length > 0
                    ? result.errors
                    : failed
                      ? ["ประเมิน Inventory state สำหรับแจ้งเตือนไม่สำเร็จ"]
                      : [],
            evaluation_messages: evaluationMessages,
        },
    };
}
