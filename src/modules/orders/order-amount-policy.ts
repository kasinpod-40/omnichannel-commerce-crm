import { ORDER_FIELDS } from "../../core/lark-fields";
import {
    getLarkBoolean,
    getLarkText,
} from "../../utils/lark-field-value";
import type { LarkOrderRecord } from "./order.repository";
import type { OrderWorkQueueClassification } from "./order-work-queue";

export type OrderAmountEditBlockReason =
    | "marketplace_order"
    | "paid_or_verified"
    | "payment_review_pending"
    | "inactive_order"
    | "financial_transaction_completed";

export type OrderAmountEditPolicy =
    | { allowed: true; reason: null }
    | { allowed: false; reason: OrderAmountEditBlockReason };

const MARKETPLACE_CHANNELS = new Set([
    "shopee",
    "lazada",
    "tiktok shop",
    "tiktok",
]);
const TERMINAL_ORDER_STATUSES = new Set([
    "cancelled",
    "canceled",
    "returned",
    "refunded",
    "failed",
]);
const COMPLETED_ORDER_STATUSES = new Set([
    "completed",
    "delivered",
]);
const TERMINAL_PAYMENT_STATUSES = new Set([
    "refunded",
    "failed",
    "cancelled",
    "canceled",
    "void",
    "returned",
]);

function normalize(value: unknown): string {
    return getLarkText(value, "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
}

/** Backend เป็นผู้ตัดสินสิทธิ์แก้ยอดขั้นสุดท้าย; Frontend ใช้ผลนี้เพื่ออธิบายและ disable UI เท่านั้น */
export function resolveOrderAmountEditPolicy(
    order: LarkOrderRecord,
    classification: OrderWorkQueueClassification
): OrderAmountEditPolicy {
    const channel = normalize(order.fields[ORDER_FIELDS.CHANNEL]);
    const orderStatus = normalize(order.fields[ORDER_FIELDS.ORDER_STATUS]);
    const paymentStatus = normalize(order.fields[ORDER_FIELDS.PAYMENT_STATUS]);
    const paymentVerified = getLarkBoolean(
        order.fields[ORDER_FIELDS.PAYMENT_VERIFIED],
        false
    );

    if (MARKETPLACE_CHANNELS.has(channel) || channel !== "line") {
        return { allowed: false, reason: "marketplace_order" };
    }

    if (paymentVerified || paymentStatus === "paid") {
        return { allowed: false, reason: "paid_or_verified" };
    }

    if (
        classification.work_queue === "payment_review" ||
        classification.has_payment_evidence
    ) {
        return { allowed: false, reason: "payment_review_pending" };
    }

    if (COMPLETED_ORDER_STATUSES.has(orderStatus)) {
        return { allowed: false, reason: "financial_transaction_completed" };
    }

    if (
        TERMINAL_ORDER_STATUSES.has(orderStatus) ||
        TERMINAL_PAYMENT_STATUSES.has(paymentStatus)
    ) {
        return { allowed: false, reason: "inactive_order" };
    }

    return { allowed: true, reason: null };
}
