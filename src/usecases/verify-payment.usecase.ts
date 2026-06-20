import type { Env } from "../config/env";
import {
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../core/lark-fields";
import {
    recordActivityOnce,
    type RecordActivityResult,
} from "../modules/activities/activity.service";
import {
    getCustomerByRecordId,
    type LarkCustomerRecord,
} from "../modules/customers/customer.repository";
import {
    recordAndDispatchNotificationOnce,
    type AutoDispatchNotificationResult,
} from "../modules/notifications/notification.service";
import {
    getOrderByRecordId,
    type LarkOrderRecord,
} from "../modules/orders/order.repository";
import {
    applyManualPaymentVerification,
} from "../modules/payments/payment.service";
import {
    getPipelineByRecordId,
    type LarkPipelineRecord,
} from "../modules/pipeline/pipeline.repository";
import {
    getFirstLinkedRecordId,
    getLarkText,
} from "../utils/lark-field-value";

export type VerifyPaymentInput = {
    order_record_id: string;
};

export type VerifyPaymentResult =
    | {
        ok: true;
        already_verified: boolean;
        current_sale_closed: boolean;
        waiting_address: boolean;
        customer: LarkCustomerRecord;
        pipeline: LarkPipelineRecord;
        order: LarkOrderRecord;
        activities: RecordActivityResult[];
        notifications: AutoDispatchNotificationResult[];
    }
    | {
        ok: false;
        code:
        | "ORDER_RECORD_NOT_FOUND"
        | "ORDER_CUSTOMER_LINK_NOT_FOUND"
        | "ORDER_PIPELINE_LINK_NOT_FOUND"
        | "CUSTOMER_RECORD_NOT_FOUND"
        | "PIPELINE_RECORD_NOT_FOUND"
        | "PIPELINE_ALREADY_LOST"
        | "ORDER_ALREADY_CANCELLED";
        message: string;
    };

export async function verifyPayment(
    env: Env,
    input: VerifyPaymentInput
): Promise<VerifyPaymentResult> {
    const orderRecordId = input.order_record_id.trim();

    const order = await getOrderByRecordId(
        env,
        orderRecordId
    );

    if (!order) {
        return {
            ok: false,
            code: "ORDER_RECORD_NOT_FOUND",
            message: `ไม่พบ Order record: ${orderRecordId}`,
        };
    }

    const customerRecordId = getFirstLinkedRecordId(
        order.fields[ORDER_FIELDS.CUSTOMER]
    );

    if (!customerRecordId) {
        return {
            ok: false,
            code: "ORDER_CUSTOMER_LINK_NOT_FOUND",
            message: "Order ไม่มี Link ไปยัง Customer",
        };
    }

    const pipelineRecordId = getFirstLinkedRecordId(
        order.fields[ORDER_FIELDS.PIPELINE]
    );

    if (!pipelineRecordId) {
        return {
            ok: false,
            code: "ORDER_PIPELINE_LINK_NOT_FOUND",
            message: "Order ไม่มี Link ไปยัง Sales Pipeline",
        };
    }

    const customer = await getCustomerByRecordId(
        env,
        customerRecordId
    );

    if (!customer) {
        return {
            ok: false,
            code: "CUSTOMER_RECORD_NOT_FOUND",
            message: `ไม่พบ Customer record: ${customerRecordId}`,
        };
    }

    const pipeline = await getPipelineByRecordId(
        env,
        pipelineRecordId
    );

    if (!pipeline) {
        return {
            ok: false,
            code: "PIPELINE_RECORD_NOT_FOUND",
            message: `ไม่พบ Pipeline record: ${pipelineRecordId}`,
        };
    }

    const orderStatus = getLarkText(
        order.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    )
        .trim()
        .toLowerCase();

    const pipelineStatus = getLarkText(
        pipeline.fields[PIPELINE_FIELDS.STATUS],
        ""
    )
        .trim()
        .toLowerCase();

    if (orderStatus === "cancelled") {
        return {
            ok: false,
            code: "ORDER_ALREADY_CANCELLED",
            message:
                "ไม่สามารถยืนยันการชำระเงินได้ เพราะ Order ถูกยกเลิกแล้ว",
        };
    }

    if (pipelineStatus === "lost") {
        return {
            ok: false,
            code: "PIPELINE_ALREADY_LOST",
            message:
                "ไม่สามารถยืนยันการชำระเงินได้ เพราะ Pipeline เป็น Lost แล้ว",
        };
    }

    const lifecycle = await applyManualPaymentVerification(
        env,
        order,
        customer,
        pipeline
    );

    if (!lifecycle) {
        return {
            ok: false,
            code: "ORDER_ALREADY_CANCELLED",
            message:
                "ไม่สามารถยืนยันการชำระเงินของ Order นี้ได้",
        };
    }

    const activities: RecordActivityResult[] = [];
    const notifications: AutoDispatchNotificationResult[] = [];

    const paymentVerifiedActivity =
        await recordActivityOnce(env, {
            event_id: `PAYMENT_VERIFIED:${orderRecordId}`,
            customer_record_id: customerRecordId,
            action: "PAYMENT_VERIFIED",
            old_value: {
                order_record_id: orderRecordId,
                payment_status:
                    lifecycle.old_state.payment_status,
                order_status:
                    lifecycle.old_state.order_status,
                payment_verified:
                    lifecycle.old_state.payment_verified,
                paid_at: lifecycle.old_state.paid_at,
                address: lifecycle.old_state.address,
            },
            new_value: {
                order_record_id: orderRecordId,
                payment_status:
                    lifecycle.new_state.payment_status,
                order_status:
                    lifecycle.new_state.order_status,
                payment_verified:
                    lifecycle.new_state.payment_verified,
                paid_at: lifecycle.new_state.paid_at,
                address: lifecycle.new_state.address,
                waiting_address:
                    lifecycle.waiting_address,
                sale_completed:
                    lifecycle.sale_completed,
                state_changed:
                    lifecycle.order_changed,
                already_verified_before_request:
                    lifecycle.already_verified,
            },
        });

    activities.push(paymentVerifiedActivity);

    const paymentVerifiedNotification =
        await recordAndDispatchNotificationOnce(env, {
            event_id: `PAYMENT_VERIFIED:${orderRecordId}`,
            notification_type: "PAYMENT_VERIFIED",
            customer_record_id: customerRecordId,
            message: lifecycle.waiting_address
                ? "ยืนยันการชำระเงินแล้ว แต่ยังไม่มีที่อยู่จัดส่ง"
                : "ยืนยันการชำระเงินเรียบร้อยแล้ว",
            status: "Pending",
        });

    notifications.push(paymentVerifiedNotification);

    if (lifecycle.sale_completed) {
        const saleWonActivity =
            await recordActivityOnce(env, {
                event_id: `SALE_WON:${pipelineRecordId}`,
                customer_record_id: customerRecordId,
                action: "SALE_WON",
                old_value: {
                    pipeline_record_id: pipelineRecordId,
                    stage:
                        lifecycle.old_state.pipeline_stage,
                    status:
                        lifecycle.old_state.pipeline_status,
                    lead_score:
                        lifecycle.old_state.pipeline_lead_score,
                    order_record_id: orderRecordId,
                    order_status:
                        lifecycle.old_state.order_status,
                },
                new_value: {
                    pipeline_record_id: pipelineRecordId,
                    stage:
                        lifecycle.new_state.pipeline_stage,
                    status:
                        lifecycle.new_state.pipeline_status,
                    lead_score:
                        lifecycle.new_state.pipeline_lead_score,
                    order_record_id: orderRecordId,
                    order_status:
                        lifecycle.new_state.order_status,
                    state_changed:
                        lifecycle.pipeline_changed ||
                        lifecycle.order_changed ||
                        lifecycle.customer_changed,
                    current_sale:
                        lifecycle.current_sale,
                    already_verified_before_request:
                        lifecycle.already_verified,
                },
            });

        activities.push(saleWonActivity);

        const saleWonNotification =
            await recordAndDispatchNotificationOnce(env, {
                event_id: `SALE_WON:${pipelineRecordId}`,
                notification_type: "SALE_WON",
                customer_record_id: customerRecordId,
                message:
                    "ยืนยันการชำระเงินและมีที่อยู่ครบ ปิดการขายสำเร็จ",
                status: "Pending",
            });

        notifications.push(saleWonNotification);
    }

    return {
        ok: true,
        already_verified: lifecycle.already_verified,
        current_sale_closed:
            lifecycle.sale_completed &&
            lifecycle.current_sale,
        waiting_address: lifecycle.waiting_address,
        customer: lifecycle.customer,
        pipeline: lifecycle.pipeline,
        order: lifecycle.order,
        activities,
        notifications,
    };
}
