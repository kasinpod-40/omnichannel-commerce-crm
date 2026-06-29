import {
    ACTIVITY_FIELDS,
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
} from "../../core/lark-fields";
import {
    getFirstLinkedRecordId,
    getLarkAttachmentTokens,
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { normalizePhoneNumber } from "../../utils/phone";
import type { LarkActivityRecord } from "../activities/activity.repository";
import type { LarkCustomerRecord } from "../customers/customer.repository";
import type { LarkOrderRecord } from "./order.repository";

export type OrderWorkQueue =
    | "payment_review"
    | "waiting_new_slip"
    | "waiting_payment"
    | "missing_delivery"
    | "ready_to_ship"
    | "marketplace_ready_to_ship"
    | "none";

export type MissingDeliveryField = "name" | "phone" | "address";

export type OrderWorkQueueClassification = {
    work_queue: OrderWorkQueue;
    missing_delivery_fields: MissingDeliveryField[];
    has_payment_evidence: boolean;
    payment_confirmed: boolean;
    latest_slip_at: number;
    latest_rejected_at: number;
};

export type OrderActivityIndex = ReadonlyMap<string, LarkActivityRecord[]>;

const TERMINAL_ORDER_STATUSES = new Set([
    "cancelled",
    "canceled",
    "returned",
    "refunded",
    "failed",
]);
const TERMINAL_PAYMENT_STATUSES = new Set([
    "refunded",
    "failed",
    "cancelled",
    "canceled",
    "void",
    "returned",
]);
const MARKETPLACE_CHANNELS = new Set(["shopee", "lazada", "tiktok shop", "tiktok"]);

function normalize(value: unknown): string {
    return getLarkText(value, "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
}

function readTimestamp(value: unknown): number {
    const numeric = getLarkNumber(value, 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
    const text = getLarkText(value, "").trim();
    if (!text) return {};
    try {
        const parsed = JSON.parse(text) as unknown;
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

function activityOrderId(activity: LarkActivityRecord): string {
    const oldValue = parseJsonRecord(activity.fields[ACTIVITY_FIELDS.OLD_VALUE]);
    const newValue = parseJsonRecord(activity.fields[ACTIVITY_FIELDS.NEW_VALUE]);
    return (
        getLarkText(newValue.order_record_id, "").trim() ||
        getLarkText(oldValue.order_record_id, "").trim()
    );
}

export function buildOrderActivityIndex(
    activities: readonly LarkActivityRecord[]
): Map<string, LarkActivityRecord[]> {
    const index = new Map<string, LarkActivityRecord[]>();

    for (const activity of activities) {
        const orderId = activityOrderId(activity);
        if (!orderId) continue;
        const bucket = index.get(orderId) ?? [];
        bucket.push(activity);
        index.set(orderId, bucket);
    }

    for (const bucket of index.values()) {
        bucket.sort(
            (left, right) =>
                readTimestamp(right.fields[ACTIVITY_FIELDS.CREATED_AT]) -
                readTimestamp(left.fields[ACTIVITY_FIELDS.CREATED_AT])
        );
    }

    return index;
}

function paymentEvidence(order: LarkOrderRecord): boolean {
    const fields = order.fields;
    return (
        getLarkAttachmentTokens(fields[ORDER_FIELDS.SLIP_ATTACHMENT]).length > 0 ||
        Boolean(getLarkText(fields[ORDER_FIELDS.SLIP_IMAGE_URL], "").trim()) ||
        getLarkNumber(fields[ORDER_FIELDS.SLIP_AMOUNT], 0) > 0 ||
        Boolean(getLarkText(fields[ORDER_FIELDS.SLIP_BANK], "").trim())
    );
}

function getLatestActivityTimestamp(
    activities: readonly LarkActivityRecord[],
    action: string
): number {
    for (const activity of activities) {
        if (getLarkText(activity.fields[ACTIVITY_FIELDS.ACTION], "").trim() === action) {
            return readTimestamp(activity.fields[ACTIVITY_FIELDS.CREATED_AT]);
        }
    }
    return 0;
}

function resolveCustomer(
    order: LarkOrderRecord,
    customerByRecordId: ReadonlyMap<string, LarkCustomerRecord>
): LarkCustomerRecord | null {
    const customerId = getFirstLinkedRecordId(order.fields[ORDER_FIELDS.CUSTOMER]);
    return customerId ? customerByRecordId.get(customerId) ?? null : null;
}

function deliveryFields(
    order: LarkOrderRecord,
    customerByRecordId: ReadonlyMap<string, LarkCustomerRecord>
): MissingDeliveryField[] {
    const customer = resolveCustomer(order, customerByRecordId);
    const name =
        getLarkText(order.fields[ORDER_FIELDS.CUSTOMER_NAME], "").trim() ||
        getLarkText(customer?.fields[CUSTOMER_FIELDS.CUSTOMER_NAME], "").trim();
    const rawPhone =
        getLarkText(order.fields[ORDER_FIELDS.PHONE], "").trim() ||
        getLarkText(customer?.fields[CUSTOMER_FIELDS.PHONE], "").trim();
    const address = getLarkText(order.fields[ORDER_FIELDS.ADDRESS], "").trim();
    const missing: MissingDeliveryField[] = [];

    if (!name) missing.push("name");
    if (!normalizePhoneNumber(rawPhone)) missing.push("phone");
    if (!address) missing.push("address");
    return missing;
}

function isMarketplace(order: LarkOrderRecord): boolean {
    return MARKETPLACE_CHANNELS.has(normalize(order.fields[ORDER_FIELDS.CHANNEL]));
}

function marketplaceReadyToShip(order: LarkOrderRecord): boolean {
    return [
        order.fields[ORDER_FIELDS.MARKETPLACE_STATUS],
        order.fields[ORDER_FIELDS.ORDER_STATUS],
        order.fields[ORDER_FIELDS.FULFILLMENT_STATUS],
    ].some((value) => normalize(value) === "ready to ship");
}

function lineFulfillmentClosed(order: LarkOrderRecord): boolean {
    const fulfillment = normalize(order.fields[ORDER_FIELDS.FULFILLMENT_STATUS]);
    const orderStatus = normalize(order.fields[ORDER_FIELDS.ORDER_STATUS]);
    const tracking = getLarkText(order.fields[ORDER_FIELDS.TRACKING_NUMBER], "").trim();

    if (["delivered", "fulfilled"].includes(fulfillment)) return true;
    if (["delivered"].includes(orderStatus)) return true;
    if (["shipped", "in transit", "delivering"].includes(fulfillment)) return true;
    if (["shipped"].includes(orderStatus)) return true;
    return Boolean(tracking);
}

/**
 * กฎกลางของ Action Center และหน้า Orders
 * Order หนึ่งรายการอยู่ได้เพียง Queue เดียวตามลำดับความสำคัญนี้เท่านั้น
 */
export function classifyOrderWorkQueue(
    order: LarkOrderRecord,
    customerByRecordId: ReadonlyMap<string, LarkCustomerRecord>,
    activities: readonly LarkActivityRecord[] = []
): OrderWorkQueueClassification {
    const orderStatus = normalize(order.fields[ORDER_FIELDS.ORDER_STATUS]);
    const paymentStatus = normalize(order.fields[ORDER_FIELDS.PAYMENT_STATUS]);
    const paymentVerified = getLarkBoolean(
        order.fields[ORDER_FIELDS.PAYMENT_VERIFIED],
        false
    );
    const hasEvidence = paymentEvidence(order);
    const latestSlipAt = getLatestActivityTimestamp(activities, "PAYMENT_SLIP_RECEIVED");
    const latestRejectedAt = getLatestActivityTimestamp(
        activities,
        "PAYMENT_REVIEW_REJECTED"
    );
    const missing = deliveryFields(order, customerByRecordId);
    const paymentConfirmed = paymentVerified || paymentStatus === "paid";
    const terminal =
        TERMINAL_ORDER_STATUSES.has(orderStatus) ||
        TERMINAL_PAYMENT_STATUSES.has(paymentStatus);

    const base = {
        missing_delivery_fields: missing,
        has_payment_evidence: hasEvidence,
        payment_confirmed: paymentConfirmed,
        latest_slip_at: latestSlipAt,
        latest_rejected_at: latestRejectedAt,
    };

    if (terminal) return { ...base, work_queue: "none" };

    if (isMarketplace(order)) {
        return {
            ...base,
            work_queue: marketplaceReadyToShip(order)
                ? "marketplace_ready_to_ship"
                : "none",
        };
    }

    if (paymentConfirmed) {
        if (missing.length > 0) {
            return { ...base, work_queue: "missing_delivery" };
        }
        return {
            ...base,
            work_queue: lineFulfillmentClosed(order) ? "none" : "ready_to_ship",
        };
    }

    const rejectedAndNoNewSlip =
        latestRejectedAt > 0 && latestRejectedAt >= latestSlipAt;
    if (rejectedAndNoNewSlip) {
        return { ...base, work_queue: "waiting_new_slip" };
    }

    const explicitReview =
        orderStatus === "payment review" || paymentStatus === "payment review";
    if (
        hasEvidence &&
        (explicitReview || latestRejectedAt === 0 || latestSlipAt > latestRejectedAt)
    ) {
        return { ...base, work_queue: "payment_review" };
    }

    return { ...base, work_queue: "waiting_payment" };
}

export function isOrderInWorkQueue(
    classification: OrderWorkQueueClassification,
    queue: OrderWorkQueue
): boolean {
    return queue === "none" || classification.work_queue === queue;
}
