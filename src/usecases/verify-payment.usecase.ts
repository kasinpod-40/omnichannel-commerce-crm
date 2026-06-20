import type { Env } from "../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../core/lark-fields";
import {
    recordActivityOnce,
    type RecordActivityResult,
} from "../modules/activities/activity.service";
import {
    getCustomerByRecordId,
    updateCustomer,
    type LarkCustomerRecord,
} from "../modules/customers/customer.repository";
import {
    getOrderByRecordId,
    updateOrder,
    type LarkOrderRecord,
} from "../modules/orders/order.repository";
import {
    getPipelineByRecordId,
    updatePipeline,
    type LarkPipelineRecord,
} from "../modules/pipeline/pipeline.repository";
import {
    recordNotificationOnce,
    type RecordNotificationResult,
} from "../modules/notifications/notification.service";
import {
    getFirstLinkedRecordId,
    getLarkBoolean,
    getLarkNumber,
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
        customer: LarkCustomerRecord;
        pipeline: LarkPipelineRecord;
        order: LarkOrderRecord;
        activities: RecordActivityResult[];
        notifications: RecordNotificationResult[];
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
    const orderRecordId =
        input.order_record_id.trim();

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

    const customerRecordId =
        getFirstLinkedRecordId(
            order.fields[ORDER_FIELDS.CUSTOMER]
        );

    if (!customerRecordId) {
        return {
            ok: false,
            code: "ORDER_CUSTOMER_LINK_NOT_FOUND",
            message:
                "Order ไม่มี Link ไปยัง Customer",
        };
    }

    const pipelineRecordId =
        getFirstLinkedRecordId(
            order.fields[ORDER_FIELDS.PIPELINE]
        );

    if (!pipelineRecordId) {
        return {
            ok: false,
            code: "ORDER_PIPELINE_LINK_NOT_FOUND",
            message:
                "Order ไม่มี Link ไปยัง Sales Pipeline",
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

    const oldOrderStatus = getLarkText(
        order.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    ).trim();

    const oldPaymentStatus = getLarkText(
        order.fields[ORDER_FIELDS.PAYMENT_STATUS],
        ""
    ).trim();

    const oldPaymentVerified = getLarkBoolean(
        order.fields[
            ORDER_FIELDS.PAYMENT_VERIFIED
        ],
        false
    );

    const oldPipelineStatus = getLarkText(
        pipeline.fields[PIPELINE_FIELDS.STATUS],
        ""
    ).trim();

    const oldPipelineStage = getLarkText(
        pipeline.fields[PIPELINE_FIELDS.STAGE],
        ""
    ).trim();

    const oldPipelineLeadScore = getLarkNumber(
        pipeline.fields[
            PIPELINE_FIELDS.LEAD_SCORE
        ],
        0
    );

    const normalizedOrderStatus =
        oldOrderStatus.toLowerCase();

    const normalizedPaymentStatus =
        oldPaymentStatus.toLowerCase();

    const normalizedPipelineStatus =
        oldPipelineStatus.toLowerCase();

    const normalizedPipelineStage =
        oldPipelineStage.toLowerCase();

    if (normalizedOrderStatus === "cancelled") {
        return {
            ok: false,
            code: "ORDER_ALREADY_CANCELLED",
            message:
                "ไม่สามารถยืนยันการชำระเงินได้ เพราะ Order ถูกยกเลิกแล้ว",
        };
    }

    if (normalizedPipelineStatus === "lost") {
        return {
            ok: false,
            code: "PIPELINE_ALREADY_LOST",
            message:
                "ไม่สามารถยืนยันการชำระเงินได้ เพราะ Pipeline เป็น Lost แล้ว",
        };
    }

    const alreadyVerified =
        oldPaymentVerified &&
        normalizedPaymentStatus === "paid" &&
        normalizedOrderStatus === "completed" &&
        normalizedPipelineStatus === "won" &&
        normalizedPipelineStage === "won";

    const orderNeedsUpdate =
        !oldPaymentVerified ||
        normalizedPaymentStatus !== "paid" ||
        normalizedOrderStatus !== "completed";

    const pipelineNeedsUpdate =
        normalizedPipelineStatus !== "won" ||
        normalizedPipelineStage !== "won" ||
        oldPipelineLeadScore !== 100;

    let verifiedOrder = order;

    if (orderNeedsUpdate) {
        verifiedOrder = await updateOrder(
            env,
            orderRecordId,
            {
                payment_status: "Paid",
                payment_verified: true,
                order_status: "Completed",
            }
        );
    }

    let wonPipeline = pipeline;

    if (pipelineNeedsUpdate) {
        wonPipeline = await updatePipeline(
            env,
            pipelineRecordId,
            {
                stage: "Won",
                status: "won",
                lead_score: 100,
                ai_summary:
                    "Sales ยืนยันการชำระเงินแล้ว ปิดการขายสำเร็จ",
                closed_at: Date.now(),
            }
        );
    }

    const currentActiveOrderId = getLarkText(
        customer.fields[
            CUSTOMER_FIELDS.ACTIVE_ORDER_ID
        ],
        ""
    ).trim();

    const currentActivePipelineId = getLarkText(
        customer.fields[
            CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID
        ],
        ""
    ).trim();

    const isCurrentSale =
        currentActiveOrderId === orderRecordId &&
        currentActivePipelineId ===
        pipelineRecordId;

    const activities: RecordActivityResult[] = [];
    const notifications: RecordNotificationResult[] = [];

    const paymentVerifiedActivity =
        await recordActivityOnce(env, {
            event_id:
                `PAYMENT_VERIFIED:${orderRecordId}`,
            customer_record_id:
                customerRecordId,
            action: "PAYMENT_VERIFIED",
            old_value: {
                order_record_id: orderRecordId,
                payment_status:
                    oldPaymentStatus,
                order_status:
                    oldOrderStatus,
                payment_verified:
                    oldPaymentVerified,
            },
            new_value: {
                order_record_id: orderRecordId,
                payment_status: "Paid",
                order_status: "Completed",
                payment_verified: true,
                state_changed:
                    orderNeedsUpdate,
                already_verified_before_request:
                    alreadyVerified,
            },
        });

    activities.push(paymentVerifiedActivity);

    const paymentVerifiedNotification =
        await recordNotificationOnce(env, {
            event_id:
                `PAYMENT_VERIFIED:${orderRecordId}`,
            notification_type:
                "PAYMENT_VERIFIED",
            customer_record_id:
                customerRecordId,
            message:
                `ยืนยันการชำระเงิน Order ${orderRecordId} เรียบร้อยแล้ว`,
            status: "Pending",
        });

    notifications.push(
        paymentVerifiedNotification
    );

    const saleWonActivity =
        await recordActivityOnce(env, {
            event_id:
                `SALE_WON:${pipelineRecordId}`,
            customer_record_id:
                customerRecordId,
            action: "SALE_WON",
            old_value: {
                pipeline_record_id:
                    pipelineRecordId,
                stage: oldPipelineStage,
                status: oldPipelineStatus,
                lead_score:
                    oldPipelineLeadScore,
            },
            new_value: {
                pipeline_record_id:
                    pipelineRecordId,
                stage: "Won",
                status: "won",
                lead_score: 100,
                state_changed:
                    pipelineNeedsUpdate,
                current_sale:
                    isCurrentSale,
                already_verified_before_request:
                    alreadyVerified,
            },
        });

    activities.push(saleWonActivity);

    const saleWonNotification =
        await recordNotificationOnce(env, {
            event_id:
                `SALE_WON:${pipelineRecordId}`,
            notification_type: "SALE_WON",
            customer_record_id:
                customerRecordId,
            message:
                `ปิดการขายสำเร็จ Pipeline ${pipelineRecordId} จาก Order ${orderRecordId}`,
            status: "Pending",
        });

    notifications.push(
        saleWonNotification
    );

    let updatedCustomer = customer;

    if (isCurrentSale) {
        updatedCustomer = await updateCustomer(
            env,
            customerRecordId,
            {
                current_stage: "Won",
                lead_score: 100,
                hot_lead: false,
                ai_summary:
                    "Sales ยืนยันการชำระเงินแล้ว ปิดการขายสำเร็จ",
                active_pipeline_id: "",
                active_order_id: "",
            }
        );
    }

    const finalCustomer =
        await getCustomerByRecordId(
            env,
            customerRecordId
        ) ?? updatedCustomer;

    const finalPipeline =
        await getPipelineByRecordId(
            env,
            pipelineRecordId
        ) ?? wonPipeline;

    const finalOrder =
        await getOrderByRecordId(
            env,
            orderRecordId
        ) ?? verifiedOrder;

    return {
        ok: true,
        already_verified: alreadyVerified,
        current_sale_closed: isCurrentSale,
        customer: finalCustomer,
        pipeline: finalPipeline,
        order: finalOrder,
        activities,
        notifications,
    };
}
