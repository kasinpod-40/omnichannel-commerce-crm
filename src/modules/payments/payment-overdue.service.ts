import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import {
    getFirstLinkedRecordId,
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { recordActivityOnce } from "../activities/activity.service";
import { recordAndDispatchNotificationOnce } from "../notifications/notification.service";
import {
    getOrderByRecordId,
    listOrders,
    updateOrder,
    type LarkOrderRecord,
} from "../orders/order.repository";

export type PaymentOverdueSkipReason =
    | "ALREADY_OVERDUE"
    | "PAYMENT_STATUS_NOT_WAITING"
    | "ORDER_CLOSED"
    | "PAYMENT_VERIFIED"
    | "PAYMENT_DUE_AT_MISSING"
    | "NOT_DUE_YET";

export type PaymentOverdueOrderResult = {
    ok: true;
    order_record_id: string;
    updated: boolean;
    skipped: boolean;
    reason: "UPDATED" | PaymentOverdueSkipReason;
    activity_recorded: boolean;
    notification_recorded: boolean;
};

export type PaymentOverdueSweepResult = {
    ok: true;
    checked: number;
    eligible: number;
    updated: number;
    skipped: number;
    notifications_recorded: number;
    errors: Array<{
        order_record_id: string;
        message: string;
    }>;
};

function normalize(value: string): string {
    return value.trim().toLowerCase();
}

function isClosedOrderStatus(value: string): boolean {
    const normalized = normalize(value);
    return (
        normalized === "completed" ||
        normalized === "cancelled"
    );
}

function getSkipReason(
    order: LarkOrderRecord,
    now: number
): PaymentOverdueSkipReason | null {
    const paymentStatus = getLarkText(
        order.fields[ORDER_FIELDS.PAYMENT_STATUS],
        ""
    );
    const orderStatus = getLarkText(
        order.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    );
    const paymentVerified = getLarkBoolean(
        order.fields[ORDER_FIELDS.PAYMENT_VERIFIED],
        false
    );
    const paymentDueAt = getLarkNumber(
        order.fields[ORDER_FIELDS.PAYMENT_DUE_AT],
        0
    );

    if (normalize(paymentStatus) === "overdue") {
        return "ALREADY_OVERDUE";
    }

    if (normalize(paymentStatus) !== "waiting payment") {
        return "PAYMENT_STATUS_NOT_WAITING";
    }

    if (isClosedOrderStatus(orderStatus)) {
        return "ORDER_CLOSED";
    }

    if (paymentVerified) {
        return "PAYMENT_VERIFIED";
    }

    if (paymentDueAt <= 0) {
        return "PAYMENT_DUE_AT_MISSING";
    }

    if (paymentDueAt > now) {
        return "NOT_DUE_YET";
    }

    return null;
}

async function processPaymentOverdueOrder(
    env: Env,
    order: LarkOrderRecord,
    now: number
): Promise<PaymentOverdueOrderResult> {
    const skipReason = getSkipReason(order, now);

    if (skipReason) {
        return {
            ok: true,
            order_record_id: order.record_id,
            updated: false,
            skipped: true,
            reason: skipReason,
            activity_recorded: false,
            notification_recorded: false,
        };
    }

    await updateOrder(env, order.record_id, {
        payment_status: "Overdue",
    });

    const customerRecordId =
        getFirstLinkedRecordId(
            order.fields[ORDER_FIELDS.CUSTOMER]
        ) ?? "";

    let activityRecorded = false;
    let notificationRecorded = false;

    if (customerRecordId) {
        const activity = await recordActivityOnce(env, {
            event_id: `payment-overdue:${order.record_id}`,
            customer_record_id: customerRecordId,
            action: "PAYMENT_OVERDUE",
            old_value: "Waiting Payment",
            new_value: "Overdue",
        });
        activityRecorded = !activity.duplicate;

        const notification =
            await recordAndDispatchNotificationOnce(env, {
                event_id: `payment-overdue:${order.record_id}`,
                notification_type: "PAYMENT_OVERDUE",
                customer_record_id: customerRecordId,
                message:
                    "คำสั่งซื้อเกินกำหนดชำระเงิน กรุณาติดตามลูกค้า",
            });
        notificationRecorded = !notification.duplicate;
    }

    return {
        ok: true,
        order_record_id: order.record_id,
        updated: true,
        skipped: false,
        reason: "UPDATED",
        activity_recorded: activityRecorded,
        notification_recorded: notificationRecorded,
    };
}

export async function markOrderPaymentOverdue(
    env: Env,
    orderRecordId: string,
    now = Date.now()
): Promise<PaymentOverdueOrderResult> {
    const normalizedRecordId = orderRecordId.trim();

    if (!normalizedRecordId) {
        throw new Error("ORDER_RECORD_ID_REQUIRED");
    }

    const order = await getOrderByRecordId(
        env,
        normalizedRecordId
    );

    if (!order) {
        throw new Error(
            `ORDER_RECORD_NOT_FOUND:${normalizedRecordId}`
        );
    }

    return await processPaymentOverdueOrder(
        env,
        order,
        now
    );
}

export async function runPaymentOverdueSweep(
    env: Env,
    now = Date.now()
): Promise<PaymentOverdueSweepResult> {
    const orders = await listOrders(env);
    const result: PaymentOverdueSweepResult = {
        ok: true,
        checked: orders.length,
        eligible: 0,
        updated: 0,
        skipped: 0,
        notifications_recorded: 0,
        errors: [],
    };

    for (const order of orders) {
        try {
            const itemResult =
                await processPaymentOverdueOrder(
                    env,
                    order,
                    now
                );

            if (itemResult.skipped) {
                result.skipped += 1;
                continue;
            }

            result.eligible += 1;
            result.updated += itemResult.updated ? 1 : 0;
            result.notifications_recorded +=
                itemResult.notification_recorded ? 1 : 0;
        } catch (error) {
            result.errors.push({
                order_record_id: order.record_id,
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
            });
        }
    }

    return result;
}
