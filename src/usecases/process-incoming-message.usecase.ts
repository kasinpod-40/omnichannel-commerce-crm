import { analyzeMessage } from "../ai/ai.service";
import type { AIIntent } from "../ai/ai.types";
import type { Env } from "../config/env";
import { CUSTOMER_FIELDS } from "../core/lark-fields";
import {
    recordActivityOnce,
    type RecordActivityResult,
} from "../modules/activities/activity.service";
import {
    isDuplicateMessage,
    saveConversation,
} from "../modules/conversations/conversation.service";
import type {
    Channel,
    MessageType,
} from "../modules/conversations/conversation.types";
import {
    findCustomerByChannelCustomerId,
    getCustomerByRecordId,
    type LarkCustomerRecord,
} from "../modules/customers/customer.repository";
import {
    markCustomerLost,
    upsertCustomer,
} from "../modules/customers/customer.service";
import {
    cancelActiveOrder,
    createOrderIfReadyToBuy,
    markActiveOrderPaymentReview,
    updateActiveOrderAddress,
} from "../modules/orders/order.service";
import {
    createPipelineIfNeeded,
    markActivePipelineLost,
} from "../modules/pipeline/pipeline.service";
import {
    recordAndDispatchNotificationOnce,
    type AutoDispatchNotificationResult,
} from "../modules/notifications/notification.service";
import type { PipelineStage } from "../modules/pipeline/pipeline.types";
import {
    getLarkBoolean,
    getLarkText,
} from "../utils/lark-field-value";

export type ProcessIncomingMessageInput = {
    channel: Channel;
    channel_customer_id: string;
    external_message_id: string;
    message_type: MessageType;
    message: string;
    customer_name?: string;
    phone?: string;
    image_url?: string;
};

function getPipelineStage(
    intent: AIIntent
): PipelineStage | null {
    if (intent === "purchase_intent") {
        return "Negotiating";
    }

    if (
        intent === "ready_to_buy" ||
        intent === "delivery_address" ||
        intent === "payment_slip"
    ) {
        return "Closing";
    }

    return null;
}

function createActivityEventId(
    action: string,
    input: ProcessIncomingMessageInput,
    recordId?: string
): string {
    const parts = [
        action,
        input.channel,
        input.external_message_id,
    ];

    if (recordId) {
        parts.push(recordId);
    }

    return parts.join(":");
}

function createNotificationEventId(
    notificationType: string,
    input: ProcessIncomingMessageInput,
    recordId?: string
): string {
    const parts = [
        notificationType,
        input.channel,
        input.external_message_id,
    ];

    if (recordId) {
        parts.push(recordId);
    }

    return parts.join(":");
}

async function findLatestCustomer(
    env: Env,
    input: ProcessIncomingMessageInput,
    fallback: LarkCustomerRecord
): Promise<LarkCustomerRecord> {
    const customer =
        await findCustomerByChannelCustomerId(
            env,
            input.channel,
            input.channel_customer_id
        );

    return customer ?? fallback;
}

async function reloadCustomerByRecordId(
    env: Env,
    customer: LarkCustomerRecord
): Promise<LarkCustomerRecord> {
    const latestCustomer =
        await getCustomerByRecordId(
            env,
            customer.record_id
        );

    return latestCustomer ?? customer;
}

export async function processIncomingMessage(
    env: Env,
    input: ProcessIncomingMessageInput
): Promise<{
    ok: boolean;
    duplicate: boolean;
    customer?: unknown;
    conversation?: unknown;
    pipeline?: unknown;
    order?: unknown;
    activity?: unknown;
    business_activities?: unknown[];
    notifications?: unknown[];
    ai?: unknown;
}> {
    const duplicate =
        await isDuplicateMessage(
            env,
            input.external_message_id
        );

    if (duplicate) {
        return {
            ok: true,
            duplicate: true,
        };
    }

    const previousCustomer =
        await findCustomerByChannelCustomerId(
            env,
            input.channel,
            input.channel_customer_id
        );

    const wasNewCustomer =
        previousCustomer === null;

    const wasHotLead = previousCustomer
        ? getLarkBoolean(
            previousCustomer.fields[
                CUSTOMER_FIELDS.HOT_LEAD
            ],
            false
        )
        : false;

    const ai = await analyzeMessage(
        input.message
    );

    const upsertedCustomer =
        await upsertCustomer(env, {
            channel: input.channel,
            channel_customer_id:
                input.channel_customer_id,
            customer_name:
                input.customer_name,
            phone: input.phone,
            last_message: input.message,
            ai,
        });

    let latestCustomer =
        await findLatestCustomer(
            env,
            input,
            upsertedCustomer
        );

    const conversationResult =
        await saveConversation(env, {
            customer_record_id:
                latestCustomer.record_id,
            channel: input.channel,
            external_message_id:
                input.external_message_id,
            message_type:
                input.message_type,
            message: input.message,
            image_url: input.image_url,
            intent: ai.intent,
            lead_score: ai.lead_score,
            hot_lead: ai.hot_lead,
            ai_summary: ai.ai_summary,
            process_status: "synced",
        });

    const messageActivity =
        await recordActivityOnce(env, {
            event_id: createActivityEventId(
                "MESSAGE_RECEIVED",
                input
            ),
            customer_record_id:
                latestCustomer.record_id,
            action: "MESSAGE_RECEIVED",
            old_value: null,
            new_value: {
                channel: input.channel,
                channel_customer_id:
                    input.channel_customer_id,
                external_message_id:
                    input.external_message_id,
                message_type:
                    input.message_type,
                message: input.message,
                image_url:
                    input.image_url ?? "",
                intent: ai.intent,
                customer_stage:
                    ai.customer_stage,
                lead_score: ai.lead_score,
                hot_lead: ai.hot_lead,
                ai_summary: ai.ai_summary,
            },
        });

    const businessActivities:
        RecordActivityResult[] = [];

    const notifications:
        AutoDispatchNotificationResult[] = [];

    const customerName =
        input.customer_name ??
        getLarkText(
            latestCustomer.fields[
                CUSTOMER_FIELDS.CUSTOMER_NAME
            ],
            "Unknown Customer"
        );

    if (wasNewCustomer) {
        const newLeadNotification =
            await recordAndDispatchNotificationOnce(
                env,
                {
                    event_id:
                        `NEW_LEAD:${input.channel}:${input.channel_customer_id}`,
                    notification_type:
                        "NEW_LEAD",
                    customer_record_id:
                        latestCustomer.record_id,
                    message:
                        `ลูกค้าใหม่ ${customerName} จาก ${input.channel}: ${input.message}`,
                    status: "Pending",
                }
            );

        notifications.push(
            newLeadNotification
        );
    }

    if (ai.hot_lead && !wasHotLead) {
        const hotLeadNotification =
            await recordAndDispatchNotificationOnce(
                env,
                {
                    event_id:
                        createNotificationEventId(
                            "HOT_LEAD",
                            input
                        ),
                    notification_type:
                        "HOT_LEAD",
                    customer_record_id:
                        latestCustomer.record_id,
                    message:
                        `Hot Lead ${customerName} คะแนน ${ai.lead_score}: ${input.message}`,
                    status: "Pending",
                }
            );

        notifications.push(
            hotLeadNotification
        );
    }

    latestCustomer =
        await reloadCustomerByRecordId(
            env,
            latestCustomer
        );

    if (ai.intent === "lost") {
        const lostPipelineResult =
            await markActivePipelineLost(
                env,
                latestCustomer
            );

        const cancelledOrderResult =
            await cancelActiveOrder(
                env,
                latestCustomer
            );

        const lostCustomer =
            await markCustomerLost(
                env,
                latestCustomer
            );

        if (
            lostPipelineResult?.changed
        ) {
            const saleLostActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "SALE_LOST",
                            input,
                            lostPipelineResult
                                .record.record_id
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action: "SALE_LOST",
                    old_value: {
                        pipeline_record_id:
                            lostPipelineResult
                                .record.record_id,
                        ...lostPipelineResult
                            .old_state,
                    },
                    new_value: {
                        pipeline_record_id:
                            lostPipelineResult
                                .record.record_id,
                        ...lostPipelineResult
                            .new_state,
                        external_message_id:
                            input.external_message_id,
                    },
                });

            businessActivities.push(
                saleLostActivity
            );

            const saleLostNotification =
                await recordAndDispatchNotificationOnce(
                    env,
                    {
                        event_id:
                            `SALE_LOST:${lostPipelineResult.record.record_id}`,
                        notification_type:
                            "SALE_LOST",
                        customer_record_id:
                            latestCustomer.record_id,
                        message:
                            `ลูกค้า ${customerName} ยกเลิกการขาย Pipeline ${lostPipelineResult.record.record_id}`,
                        status: "Pending",
                    }
                );

            notifications.push(
                saleLostNotification
            );
        }

        if (
            cancelledOrderResult?.changed
        ) {
            const orderCancelledActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "ORDER_CANCELLED",
                            input,
                            cancelledOrderResult
                                .record.record_id
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action: "ORDER_CANCELLED",
                    old_value: {
                        order_record_id:
                            cancelledOrderResult
                                .record.record_id,
                        order_status:
                            cancelledOrderResult
                                .old_order_status,
                        payment_status:
                            cancelledOrderResult
                                .payment_status,
                        payment_verified:
                            cancelledOrderResult
                                .payment_verified,
                    },
                    new_value: {
                        order_record_id:
                            cancelledOrderResult
                                .record.record_id,
                        order_status:
                            cancelledOrderResult
                                .new_order_status,
                        payment_status:
                            cancelledOrderResult
                                .payment_status,
                        payment_verified:
                            cancelledOrderResult
                                .payment_verified,
                        external_message_id:
                            input.external_message_id,
                    },
                });

            businessActivities.push(
                orderCancelledActivity
            );
        }

        const reloadedLostCustomer =
            await reloadCustomerByRecordId(
                env,
                lostCustomer
            );

        return {
            ok: true,
            duplicate:
                conversationResult.duplicate,
            customer: reloadedLostCustomer,
            conversation:
                conversationResult.result ??
                null,
            pipeline:
                lostPipelineResult?.record ??
                null,
            order:
                cancelledOrderResult?.record ??
                null,
            activity: messageActivity,
            business_activities:
                businessActivities,
            notifications,
            ai,
        };
    }

    let pipeline = null;
    let order = null;

    const pipelineStage =
        getPipelineStage(ai.intent);

    if (pipelineStage) {
        const pipelineResult =
            await createPipelineIfNeeded(
                env,
                latestCustomer,
                {
                    stage: pipelineStage,
                    lead_score: ai.lead_score,
                    ai_summary: ai.ai_summary,
                }
            );

        pipeline = pipelineResult.record;

        if (pipelineResult.created) {
            const pipelineActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "PIPELINE_CREATED",
                            input,
                            pipeline.record_id
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action: "PIPELINE_CREATED",
                    old_value: null,
                    new_value: {
                        pipeline_record_id:
                            pipeline.record_id,
                        ...pipelineResult.new_state,
                        external_message_id:
                            input.external_message_id,
                    },
                });

            businessActivities.push(
                pipelineActivity
            );
        } else if (
            pipelineResult.updated &&
            pipelineResult.old_state
        ) {
            const pipelineUpdatedActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "PIPELINE_UPDATED",
                            input,
                            pipeline.record_id
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action: "PIPELINE_UPDATED",
                    old_value: {
                        pipeline_record_id:
                            pipeline.record_id,
                        ...pipelineResult.old_state,
                    },
                    new_value: {
                        pipeline_record_id:
                            pipeline.record_id,
                        ...pipelineResult.new_state,
                        external_message_id:
                            input.external_message_id,
                    },
                });

            businessActivities.push(
                pipelineUpdatedActivity
            );
        }

        latestCustomer =
            await reloadCustomerByRecordId(
                env,
                latestCustomer
            );
    }

    if (ai.intent === "ready_to_buy") {
        const orderResult =
            await createOrderIfReadyToBuy(
                env,
                latestCustomer,
                pipeline,
                {
                    message: input.message,
                    quantity:
                        ai.quantity ?? 1,
                }
            );

        order =
            orderResult?.record ?? null;

        if (
            orderResult?.created &&
            order
        ) {
            const orderActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "ORDER_CREATED",
                            input,
                            order.record_id
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action: "ORDER_CREATED",
                    old_value: null,
                    new_value: {
                        order_record_id:
                            order.record_id,
                        pipeline_record_id:
                            pipeline?.record_id ??
                            null,
                        quantity:
                            ai.quantity ?? 1,
                        payment_status:
                            "Waiting Payment",
                        order_status:
                            "Waiting Payment",
                        external_message_id:
                            input.external_message_id,
                    },
                });

            businessActivities.push(
                orderActivity
            );
        }

        if (
            orderResult &&
            !orderResult.created &&
            orderResult.quantity_changed &&
            order
        ) {
            const quantityActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "ORDER_QUANTITY_UPDATED",
                            input,
                            order.record_id
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action:
                        "ORDER_QUANTITY_UPDATED",
                    old_value: {
                        order_record_id:
                            order.record_id,
                        quantity:
                            orderResult.old_quantity,
                    },
                    new_value: {
                        order_record_id:
                            order.record_id,
                        quantity:
                            orderResult.new_quantity,
                        external_message_id:
                            input.external_message_id,
                        message: input.message,
                    },
                });

            businessActivities.push(
                quantityActivity
            );
        }

        latestCustomer =
            await reloadCustomerByRecordId(
                env,
                latestCustomer
            );
    }

    if (
        ai.intent ===
        "delivery_address"
    ) {
        const addressResult =
            await updateActiveOrderAddress(
                env,
                latestCustomer,
                ai.address ?? input.message
            );

        order =
            addressResult?.record ?? null;

        if (
            addressResult?.changed &&
            order
        ) {
            const addressActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "ADDRESS_UPDATED",
                            input,
                            order.record_id
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action: "ADDRESS_UPDATED",
                    old_value: {
                        order_record_id:
                            order.record_id,
                        address:
                            addressResult.old_address,
                    },
                    new_value: {
                        order_record_id:
                            order.record_id,
                        address:
                            addressResult.new_address,
                        external_message_id:
                            input.external_message_id,
                    },
                });

            businessActivities.push(
                addressActivity
            );
        }

        latestCustomer =
            await reloadCustomerByRecordId(
                env,
                latestCustomer
            );
    }

    if (
        ai.intent === "payment_slip"
    ) {
        const paymentReviewResult =
            await markActiveOrderPaymentReview(
                env,
                latestCustomer
            );

        order =
            paymentReviewResult?.record ??
            null;

        if (
            paymentReviewResult &&
            order
        ) {
            const paymentSlipActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "PAYMENT_SLIP_RECEIVED",
                            input,
                            order.record_id
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action:
                        "PAYMENT_SLIP_RECEIVED",
                    old_value: {
                        order_record_id:
                            order.record_id,
                        payment_status:
                            paymentReviewResult
                                .old_payment_status,
                        order_status:
                            paymentReviewResult
                                .old_order_status,
                        payment_verified:
                            paymentReviewResult
                                .old_payment_verified,
                    },
                    new_value: {
                        order_record_id:
                            order.record_id,
                        payment_status:
                            paymentReviewResult
                                .new_payment_status,
                        order_status:
                            paymentReviewResult
                                .new_order_status,
                        payment_verified:
                            paymentReviewResult
                                .new_payment_verified,
                        state_changed:
                            paymentReviewResult.changed,
                        external_message_id:
                            input.external_message_id,
                        image_url:
                            input.image_url ?? "",
                    },
                });

            businessActivities.push(
                paymentSlipActivity
            );

            const paymentReviewNotification =
                await recordAndDispatchNotificationOnce(
                    env,
                    {
                        event_id:
                            createNotificationEventId(
                                "PAYMENT_REVIEW",
                                input,
                                order.record_id
                            ),
                        notification_type:
                            "PAYMENT_REVIEW",
                        customer_record_id:
                            latestCustomer.record_id,
                        message:
                            `ลูกค้า ${customerName} ส่งสลิปสำหรับ Order ${order.record_id} รอตรวจสอบ`,
                        status: "Pending",
                    }
                );

            notifications.push(
                paymentReviewNotification
            );
        }

        latestCustomer =
            await reloadCustomerByRecordId(
                env,
                latestCustomer
            );
    }

    latestCustomer =
        await reloadCustomerByRecordId(
            env,
            latestCustomer
        );

    return {
        ok: true,
        duplicate:
            conversationResult.duplicate,
        customer: latestCustomer,
        conversation:
            conversationResult.result ??
            null,
        pipeline,
        order,
        activity: messageActivity,
        business_activities:
            businessActivities,
        notifications,
        ai,
    };
}
