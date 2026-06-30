import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { AuthError } from "../auth/auth.error";
import {
    findActivityByEventId,
    listActivities,
} from "../activities/activity.repository";
import { recordActivityOnce } from "../activities/activity.service";
import { getCustomerByRecordId } from "../customers/customer.repository";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";
import {
    getFirstLinkedRecordId,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import {
    getOrderByRecordId,
    updateOrder,
    type LarkOrderRecord,
} from "./order.repository";
import {
    buildOrderActivityIndex,
    classifyOrderWorkQueue,
} from "./order-work-queue";
import { resolveOrderAmountEditPolicy } from "./order-amount-policy";
import { getOrderDetail, type OrderRecordResponse } from "./order-dashboard.service";

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9:_-]{8,120}$/;
const MAX_REASON_LENGTH = 500;

export type UpdateOrderAmountInput = {
    orderId: string;
    amount: string;
    expectedUpdatedAt: string;
    idempotencyKey: string;
    reason?: string;
    actor: {
        userId: string;
        name: string;
        role: string;
    };
};

function parseAmount(value: string): number {
    const normalized = value.trim();
    if (!AMOUNT_PATTERN.test(normalized)) {
        throw new AuthError(
            "ORDER_AMOUNT_INVALID",
            "Order amount must be greater than zero with at most 2 decimal places",
            400
        );
    }
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999_999_999.99) {
        throw new AuthError(
            "ORDER_AMOUNT_INVALID",
            "Order amount must be between 0.01 and 999,999,999.99",
            400
        );
    }
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function readTimestamp(value: unknown): number {
    const numeric = getLarkNumber(value, 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
}

function expectedTimestamp(value: string): number {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
        throw new AuthError(
            "ORDER_AMOUNT_VERSION_INVALID",
            "Order version is invalid. Reload the order and try again.",
            400
        );
    }
    return parsed;
}

async function loadClassificationContext(env: Env, order: LarkOrderRecord) {
    const customerId = getFirstLinkedRecordId(order.fields[ORDER_FIELDS.CUSTOMER]);
    if (!customerId) {
        throw new AuthError(
            "ORDER_CUSTOMER_MISSING",
            "The order is not linked to a customer",
            409
        );
    }
    const [customer, activities] = await Promise.all([
        getCustomerByRecordId(env, customerId),
        listActivities(env),
    ]);
    if (!customer) {
        throw new AuthError(
            "ORDER_CUSTOMER_MISSING",
            "The linked customer was not found",
            409
        );
    }
    const activityIndex = buildOrderActivityIndex(activities);
    const customerMap = new Map([[customer.record_id, customer]]);
    return {
        customerId,
        classification: classifyOrderWorkQueue(
            order,
            customerMap,
            activityIndex.get(order.record_id) ?? []
        ),
    };
}

async function readFreshDetail(env: Env, orderId: string): Promise<OrderRecordResponse> {
    clearDashboardReadCache();
    const detail = await getOrderDetail(env, orderId);
    if (!detail) {
        throw new AuthError("ORDER_NOT_FOUND", "Order was not found", 404);
    }
    return detail;
}

async function recordFailure(
    env: Env,
    input: UpdateOrderAmountInput,
    order: LarkOrderRecord,
    customerId: string,
    code: string,
    message: string
): Promise<void> {
    try {
        await recordActivityOnce(env, {
            event_id: `order-amount:${input.idempotencyKey}:failed:${code}`,
            customer_record_id: customerId,
            action: "ORDER_AMOUNT_UPDATE_FAILED",
            old_value: {
                order_record_id: order.record_id,
                total_amount: getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0),
            },
            new_value: {
                order_record_id: order.record_id,
                requested_total_amount: input.amount,
                reason: input.reason?.trim() || null,
                actor: input.actor,
                channel: getLarkText(order.fields[ORDER_FIELDS.CHANNEL], ""),
                result: "failed",
                error_code: code,
                error_message: message,
            },
        });
    } catch (auditError) {
        console.error("Order amount failure audit failed", {
            order_id: order.record_id,
            code,
            error: auditError instanceof Error ? auditError.message : String(auditError),
        });
    }
}

export async function updateOrderAmount(
    env: Env,
    input: UpdateOrderAmountInput
): Promise<{ order: OrderRecordResponse; idempotent: boolean; changed: boolean }> {
    const orderId = input.orderId.trim();
    if (!orderId) {
        throw new AuthError("ORDER_NOT_FOUND", "Order was not found", 404);
    }
    if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
        throw new AuthError(
            "IDEMPOTENCY_KEY_INVALID",
            "A valid idempotency key is required",
            400
        );
    }
    const reason = input.reason?.trim() ?? "";
    if (reason.length > MAX_REASON_LENGTH) {
        throw new AuthError(
            "ORDER_AMOUNT_REASON_TOO_LONG",
            "Reason must not exceed 500 characters",
            400
        );
    }

    const successEventId = `order-amount:${input.idempotencyKey}:success`;
    const duplicate = await findActivityByEventId(env, successEventId);
    if (duplicate) {
        return {
            order: await readFreshDetail(env, orderId),
            idempotent: true,
            changed: true,
        };
    }

    const order = await getOrderByRecordId(env, orderId);
    if (!order) {
        throw new AuthError("ORDER_NOT_FOUND", "Order was not found", 404);
    }

    const { customerId, classification } = await loadClassificationContext(env, order);
    const amount = parseAmount(input.amount);
    const currentAmount = Math.round(
        (getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0) + Number.EPSILON) * 100
    ) / 100;
    const currentUpdatedAt = readTimestamp(order.fields[ORDER_FIELDS.UPDATED_AT]);
    const requestedVersion = expectedTimestamp(input.expectedUpdatedAt);

    if (Math.abs(currentUpdatedAt - requestedVersion) > 1_000) {
        const error = new AuthError(
            "ORDER_AMOUNT_CONFLICT",
            "This order was updated by someone else. Reload and try again.",
            409
        );
        await recordFailure(env, input, order, customerId, error.code, error.message);
        throw error;
    }

    const policy = resolveOrderAmountEditPolicy(order, classification);
    if (!policy.allowed) {
        const error = new AuthError(
            "ORDER_AMOUNT_EDIT_NOT_ALLOWED",
            `Order amount cannot be edited: ${policy.reason}`,
            409
        );
        await recordFailure(env, input, order, customerId, error.code, error.message);
        throw error;
    }

    if (currentAmount === amount) {
        return {
            order: await readFreshDetail(env, orderId),
            idempotent: false,
            changed: false,
        };
    }

    const updatedAt = Date.now();
    try {
        await updateOrder(env, orderId, {
            total_amount: amount,
            updated_at: updatedAt,
        });

        await recordActivityOnce(env, {
            event_id: successEventId,
            customer_record_id: customerId,
            action: "ORDER_AMOUNT_UPDATED",
            old_value: {
                order_record_id: orderId,
                total_amount: currentAmount,
            },
            new_value: {
                order_record_id: orderId,
                total_amount: amount,
                reason: reason || null,
                actor: input.actor,
                channel: getLarkText(order.fields[ORDER_FIELDS.CHANNEL], ""),
                result: "success",
                updated_at: updatedAt,
            },
            created_at: updatedAt,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordFailure(env, input, order, customerId, "ORDER_AMOUNT_UPDATE_FAILED", message);
        throw error;
    }

    return {
        order: await readFreshDetail(env, orderId),
        idempotent: false,
        changed: true,
    };
}
