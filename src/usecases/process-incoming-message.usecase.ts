import { analyzeIncomingContent } from "../ai/ai.service";
import type { AIAnalysisResult } from "../ai/ai.types";
import type {
    ImageAnalysisOverride,
    ImageAnalysisResult,
} from "../ai/image-ai.types";
import type { Env } from "../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
} from "../core/lark-fields";
import {
    recordActivityOnce,
    type RecordActivityResult,
} from "../modules/activities/activity.service";
import { findActivityByEventId } from "../modules/activities/activity.repository";
import {
    getConversationProcessStatus,
    linkConversationToCustomer,
    markConversationSynced,
    saveConversation,
} from "../modules/conversations/conversation.service";
import { findConversationByExternalMessageId } from "../modules/conversations/conversation.repository";
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
    upsertCustomer,
} from "../modules/customers/customer.service";
import {
    createOrderIfReadyToBuy,
    updateActiveOrderAddress,
    updateActiveOrderPhone,
} from "../modules/orders/order.service";
import {
    getOrderByRecordId,
    type LarkOrderRecord,
} from "../modules/orders/order.repository";
import {
    applyPaymentEvidenceToOrder,
    applyPendingPaymentToOrder,
    completeVerifiedSaleAfterDeliveryInfo,
    normalizePaymentEvidence,
    savePendingPayment,
    type PaymentEvidenceSnapshot,
} from "../modules/payments/payment.service";
import {
    createPipelineIfNeeded,
} from "../modules/pipeline/pipeline.service";
import { finalizeLostSale } from "../modules/sales/lost-sale.service";
import {
    recordAndDispatchNotificationOnce,
    type AutoDispatchNotificationResult,
} from "../modules/notifications/notification.service";
import type { NotificationSnapshot } from "../modules/notifications/notification.types";
import type { PipelineStage } from "../modules/pipeline/pipeline.types";
import {
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../utils/lark-field-value";
import {
    extractPhoneNumber,
    normalizePhoneNumber,
} from "../utils/phone";

export type ProcessIncomingMessageInput = {
    channel: Channel;
    channel_customer_id: string;
    external_message_id: string;
    message_type: MessageType;
    message: string;
    customer_name?: string;
    customer_name_resolver?: () => Promise<string | undefined>;
    phone?: string;
    image_url?: string;
    image_attachment_tokens?: string[];
    slip_amount?: number;
    slip_bank?: string;
    slip_image_url?: string;
    slip_attachment_tokens?: string[];
    image_analysis_override?: ImageAnalysisOverride;
    image_analysis_result?: ImageAnalysisResult;
    occurred_at?: number;
    webhook_event_id?: string;
    is_redelivery?: boolean;
};

function getPipelineStage(
    ai: AIAnalysisResult
): PipelineStage | null {
    if (ai.intent === "ask_discount") {
        return "Negotiating";
    }

    if (
        ai.intent === "product_info" &&
        ai.image_ai?.image_type === "product_image"
    ) {
        return "Interested";
    }

    if (
        ai.intent === "product_order" ||
        ai.intent === "payment_request" ||
        ai.intent === "delivery_address" ||
        ai.intent === "payment_slip"
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

function buildPaymentReviewSnapshot(
    customer: LarkCustomerRecord,
    order: LarkOrderRecord | null,
    evidence: PaymentEvidenceSnapshot,
    lastMessage: string
): NotificationSnapshot {
    return {
        version: 1,
        captured_at: Date.now(),
        customer_name: getLarkText(
            customer.fields[
                CUSTOMER_FIELDS.CUSTOMER_NAME
            ],
            "ไม่ทราบชื่อลูกค้า"
        ),
        channel: getLarkText(
            customer.fields[CUSTOMER_FIELDS.CHANNEL],
            "ไม่ระบุ"
        ),
        phone: getLarkText(
            customer.fields[CUSTOMER_FIELDS.PHONE],
            ""
        ),
        current_stage: getLarkText(
            customer.fields[
                CUSTOMER_FIELDS.CURRENT_STAGE
            ],
            "Closing"
        ),
        lead_score: getLarkNumber(
            customer.fields[CUSTOMER_FIELDS.LEAD_SCORE],
            0
        ),
        last_message: lastMessage,
        sales_owner: getLarkText(
            customer.fields[
                CUSTOMER_FIELDS.SALES_OWNER
            ],
            "Unassigned"
        ),
        order_number: getLarkText(
            order?.fields[ORDER_FIELDS.ORDER_NUMBER],
            ""
        ),
        product_name: getLarkText(
            order?.fields[ORDER_FIELDS.PRODUCT_NAME],
            getLarkText(
                customer.fields[
                    CUSTOMER_FIELDS.PRODUCT_NAME
                ],
                ""
            )
        ),
        product_size: getLarkText(
            order?.fields[ORDER_FIELDS.PRODUCT_SIZE],
            getLarkText(
                customer.fields[
                    CUSTOMER_FIELDS.PRODUCT_SIZE
                ],
                ""
            )
        ),
        quantity: getLarkNumber(
            order?.fields[ORDER_FIELDS.QUANTITY],
            getLarkNumber(
                customer.fields[
                    CUSTOMER_FIELDS.PRODUCT_QTY
                ],
                0
            )
        ),
        total_amount: getLarkNumber(
            order?.fields[ORDER_FIELDS.TOTAL_AMOUNT],
            0
        ),
        slip_amount:
            evidence.amount > 0
                ? evidence.amount
                : getLarkNumber(
                      order?.fields[ORDER_FIELDS.SLIP_AMOUNT],
                      0
                  ),
        payment_status: getLarkText(
            order?.fields[ORDER_FIELDS.PAYMENT_STATUS],
            ""
        ),
        order_status: getLarkText(
            order?.fields[ORDER_FIELDS.ORDER_STATUS],
            ""
        ),
    };
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
    const existingConversation =
        await findConversationByExternalMessageId(
            env,
            input.external_message_id
        );

    if (
        existingConversation &&
        getConversationProcessStatus(existingConversation) === "synced"
    ) {
        return {
            ok: true,
            duplicate: true,
            conversation: existingConversation,
        };
    }

    const previousCustomer =
        await findCustomerByChannelCustomerId(
            env,
            input.channel,
            input.channel_customer_id
        );

    let resolvedCustomerName =
        input.customer_name?.trim() || "";

    if (
        !resolvedCustomerName &&
        !previousCustomer &&
        input.customer_name_resolver
    ) {
        resolvedCustomerName =
            (await input.customer_name_resolver())?.trim() || "";
    }

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

    const ai = await analyzeIncomingContent(
        env,
        {
            message_type: input.message_type,
            message: input.message,
            image_url: input.image_url,
            image_analysis_override:
                input.image_analysis_override,
            image_analysis_result:
                input.image_analysis_result,
        }
    );

    const previousCustomerStage = previousCustomer
        ? getLarkText(
              previousCustomer.fields[
                  CUSTOMER_FIELDS.CURRENT_STAGE
              ],
              "New Lead"
          )
        : "New Lead";

    const previousActiveOrderId = previousCustomer
        ? getLarkText(
              previousCustomer.fields[
                  CUSTOMER_FIELDS.ACTIVE_ORDER_ID
              ],
              ""
          ).trim()
        : "";

    const previousActivePipelineId = previousCustomer
        ? getLarkText(
              previousCustomer.fields[
                  CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID
              ],
              ""
          ).trim()
        : "";

    /*
     * Regression guard: ลูกค้าเดิมที่ปิดรอบขายแล้วต้องเริ่ม Context ใหม่
     * โดยไม่ยกชื่อสินค้า จำนวน คะแนน หรือ Stage จากรอบเก่ามาใช้ต่อ
     *
     * เงื่อนไข Closing + ไม่มี Active IDs รองรับข้อมูลเก่าที่เคยปิดการขาย
     * ก่อนแก้ Payment Workflow แต่ Customer ไม่ถูกเปลี่ยนเป็น Won
     */
    const startingNewSalesCycle =
        ai.intent !== "lost" &&
        previousCustomer !== null &&
        (previousCustomerStage === "Won" ||
            previousCustomerStage === "Lost" ||
            (previousCustomerStage === "Closing" &&
                !previousActiveOrderId &&
                !previousActivePipelineId));

    const resolvedPhone =
        normalizePhoneNumber(input.phone) ??
        normalizePhoneNumber(ai.phone) ??
        extractPhoneNumber(input.message);

    const customerLastMessage =
        input.message_type === "image"
            ? ai.ai_summary
            : input.message;

    const paymentEvidence =
        normalizePaymentEvidence(
            {
                amount:
                    input.slip_amount ??
                    ai.image_ai?.slip_amount,
                bank:
                    input.slip_bank ??
                    ai.image_ai?.slip_bank,
                image_url:
                    input.slip_image_url,
                attachment_tokens:
                    input.slip_attachment_tokens ??
                    input.image_attachment_tokens,
            },
            input.image_url
        );

    /*
     * Resume-safe ordering:
     * create/resume the Conversation before applying Customer/Pipeline/Order
     * side effects. If a later Lark call fails, Queue retry finds the same
     * processing/failed Conversation and does not increment message_count a
     * second time.
     */
    const conversationResult =
        await saveConversation(env, {
            customer_record_id:
                previousCustomer?.record_id,
            channel: input.channel,
            external_message_id:
                input.external_message_id,
            message_type:
                input.message_type,
            message: input.message,
            image_url: input.image_url,
            image_attachment_tokens:
                input.image_attachment_tokens,
            intent: ai.intent,
            buyer_intent: ai.buyer_intent,
            image_type: ai.image_ai?.image_type,
            lead_score: ai.lead_score,
            hot_lead: ai.hot_lead,
            ai_summary: ai.ai_summary,
            process_status: "processing",
            error_message:
                ai.image_ai?.error_message ?? "",
            created_at:
                input.occurred_at ?? Date.now(),
        }, existingConversation);

    if (conversationResult.duplicate) {
        return {
            ok: true,
            duplicate: true,
            customer: previousCustomer ?? undefined,
            conversation: conversationResult.result,
            ai,
        };
    }

    const upsertedCustomer =
        await upsertCustomer(env, {
            channel: input.channel,
            channel_customer_id:
                input.channel_customer_id,
            customer_name:
                resolvedCustomerName || undefined,
            phone: resolvedPhone,
            last_message: customerLastMessage,
            ai,
            increment_message_count:
                !conversationResult.resumed,
            existing_customer: previousCustomer,
            force_new_sales_cycle:
                startingNewSalesCycle,
        });

    let latestCustomer = upsertedCustomer;

    await linkConversationToCustomer(
        env,
        conversationResult.result.record_id,
        latestCustomer.record_id
    );

    const shouldSendNewLeadNotification =
        wasNewCustomer ||
        (conversationResult.resumed &&
            previousCustomer !== null &&
            getLarkNumber(
                previousCustomer.fields[
                    CUSTOMER_FIELDS.MESSAGE_COUNT
                ],
                0
            ) <= 1);

    const businessActivities:
        RecordActivityResult[] = [];

    const notifications:
        AutoDispatchNotificationResult[] = [];

    const customerName =
        resolvedCustomerName ||
        getLarkText(
            latestCustomer.fields[
                CUSTOMER_FIELDS.CUSTOMER_NAME
            ],
            "Unknown Customer"
        );

    /*
     * CASE 18A.6.1 — Notification Priority
     *
     * NEW_LEAD และ HOT_LEAD จะยังไม่ถูกส่งตรงจุดนี้
     * เพราะ Event เดียวกันอาจสร้าง Notification ที่สำคัญกว่า
     * เช่น PAYMENT_REVIEW ระบบจะเลือกส่งเพียงรายการที่มี
     * Priority สูงสุดในตอนท้ายของ Use Case
     */

    if (ai.intent === "lost") {
        /*
         * Use the full pre-message Customer snapshot for active pointers.
         * Lark update responses can contain only the fields written by the
         * upsert, so using `latestCustomer` here may make active IDs appear
         * empty and skip Pipeline/Order closure.
         *
         * finalizeLostSale guarantees this order:
         * Pipeline Lost -> Order Cancelled -> Customer pointers cleared.
         */
        const lostContextCustomer =
            previousCustomer ??
            (await reloadCustomerByRecordId(
                env,
                latestCustomer
            ));

        const {
            pipeline: lostPipelineResult,
            order: cancelledOrderResult,
            customer: lostCustomer,
        } = await finalizeLostSale(
            env,
            lostContextCustomer,
            {
                active_pipeline_id:
                    previousActivePipelineId,
                active_order_id:
                    previousActiveOrderId,
            }
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

        const syncedConversation =
            await markConversationSynced(
                env,
                conversationResult.result.record_id
            );

        return {
            ok: true,
            duplicate: false,
            customer: reloadedLostCustomer,
            conversation: syncedConversation,
            pipeline:
                lostPipelineResult?.record ??
                null,
            order:
                cancelledOrderResult?.record ??
                null,
            activity: null,
            business_activities:
                businessActivities,
            notifications,
            ai,
        };
    }

    let pipeline = null;
    let order = null;

    const pipelineStage =
        getPipelineStage(ai);

    if (pipelineStage) {
        const pipelineResult =
            await createPipelineIfNeeded(
                env,
                latestCustomer,
                {
                    stage: pipelineStage,
                    lead_score: ai.lead_score,
                    ai_summary: ai.ai_summary,
                    sales_owner: getLarkText(
                        latestCustomer.fields[
                            CUSTOMER_FIELDS.SALES_OWNER
                        ],
                        "Unassigned"
                    ),
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

    /*
     * CASE 18A.4 — Qualified Order Creation
     *
     * product_order:
     *   สร้าง Order เมื่อมีชื่อสินค้าที่ระบุได้และจำนวนมากกว่า 0
     *
     * delivery_address:
     *   เป็นเหตุการณ์ที่ยืนยันว่ากำลังเกิดคำสั่งซื้อจริง
     *   จึงสร้าง Order shell ได้ แม้ข้อมูลสินค้ายังไม่ครบ
     *
     * payment_slip:
     *   สร้าง Order ได้เมื่อ Customer มีสินค้าและจำนวนเพียงพอ
     *   หากยังไม่พอ จะเก็บเป็น Pending Payment แทน
     *
     * ถ้ามี Active Order อยู่แล้ว ต้องอัปเดต Order เดิมเท่านั้น
     */
    if (
        ai.intent === "product_order" ||
        ai.intent === "delivery_address" ||
        ai.intent === "payment_slip"
    ) {
        const activeOrderBeforeEnsure =
            getLarkText(
                latestCustomer.fields[
                    CUSTOMER_FIELDS.ACTIVE_ORDER_ID
                ],
                ""
            ).trim();

        const quantityMutationEventId =
            activeOrderBeforeEnsure
                ? createActivityEventId(
                      "ORDER_QUANTITY_UPDATED",
                      input,
                      activeOrderBeforeEnsure
                  )
                : "";

        const quantityMutationAlreadyApplied =
            conversationResult.resumed &&
            Boolean(quantityMutationEventId) &&
            (ai.quantity_action === "add" ||
                ai.quantity_action === "subtract") &&
            Boolean(
                await findActivityByEventId(
                    env,
                    quantityMutationEventId
                )
            );

        const ensureOrderResult =
            quantityMutationAlreadyApplied
                ? null
                : await createOrderIfReadyToBuy(
                      env,
                      latestCustomer,
                      pipeline,
                      {
                          qualification_reason:
                              ai.intent,
                          product_name:
                              ai.product_name,
                          product_size:
                              ai.product_size,
                          product_unit:
                              ai.product_unit,
                          quantity:
                              ai.quantity,
                          quantity_action:
                              ai.quantity_action,
                          address:
                              ai.intent ===
                                  "delivery_address" &&
                              !activeOrderBeforeEnsure
                                  ? ai.address ??
                                    input.message
                                  : undefined,
                          message: input.message,
                          allow_customer_sales_context_fallback:
                              !startingNewSalesCycle,
                      }
                  );

        if (quantityMutationAlreadyApplied) {
            order = activeOrderBeforeEnsure
                ? await getOrderByRecordId(
                      env,
                      activeOrderBeforeEnsure
                  )
                : null;
        }

        if (ensureOrderResult) {
            order = ensureOrderResult.record;

            if (ensureOrderResult.created) {
                const orderCreatedActivity =
                    await recordActivityOnce(
                        env,
                        {
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
                                qualification_reason:
                                    ensureOrderResult.qualification_reason,
                                ...ensureOrderResult.new_state,
                                payment_status:
                                    "Waiting Payment",
                                payment_verified:
                                    false,
                                order_status:
                                    "Waiting Payment",
                                external_message_id:
                                    input.external_message_id,
                            },
                        }
                    );

                businessActivities.push(
                    orderCreatedActivity
                );
            } else if (
                ensureOrderResult.changed &&
                ensureOrderResult.old_state &&
                ensureOrderResult.old_state.quantity !==
                    ensureOrderResult.new_state.quantity
            ) {
                const orderUpdatedActivity =
                    await recordActivityOnce(
                        env,
                        {
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
                                ...ensureOrderResult.old_state,
                            },
                            new_value: {
                                order_record_id:
                                    order.record_id,
                                qualification_reason:
                                    ensureOrderResult.qualification_reason,
                                ...ensureOrderResult.new_state,
                                external_message_id:
                                    input.external_message_id,
                            },
                        }
                    );

                businessActivities.push(
                    orderUpdatedActivity
                );
            }

            latestCustomer =
                await reloadCustomerByRecordId(
                    env,
                    latestCustomer
                );
        }
    }

    /*
     * เมื่อ Order ถูกสร้างหรือค้นพบแล้ว ให้แนบ Pending Slip
     * ที่เคยพักไว้ใน Customer ทันที แล้วล้าง Pending Fields
     */
    if (order) {
        const pendingPaymentResult =
            await applyPendingPaymentToOrder(
                env,
                latestCustomer,
                order.record_id
            );

        if (pendingPaymentResult) {
            order =
                (await getOrderByRecordId(
                    env,
                    pendingPaymentResult.record.record_id
                )) ?? pendingPaymentResult.record;

            const pendingAttachedActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "PENDING_PAYMENT_ATTACHED",
                            input,
                            order.record_id
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action:
                        "PENDING_PAYMENT_ATTACHED",
                    old_value: {
                        order_record_id:
                            order.record_id,
                        ...pendingPaymentResult.old_state,
                        pending_payment: true,
                    },
                    new_value: {
                        order_record_id:
                            order.record_id,
                        ...pendingPaymentResult.new_state,
                        pending_payment: false,
                        pending_payment_cleared:
                            pendingPaymentResult.pending_payment_cleared,
                        external_message_id:
                            input.external_message_id,
                    },
                });

            businessActivities.push(
                pendingAttachedActivity
            );

            latestCustomer =
                await reloadCustomerByRecordId(
                    env,
                    latestCustomer
                );

            /*
             * ถ้า Event ปัจจุบันเป็นสลิปใหม่ จะส่ง Notification
             * ในบล็อก payment_slip ด้านล่างเพียงครั้งเดียว
             */
            if (ai.intent !== "payment_slip") {
                const pendingEvidence = {
                    amount:
                        pendingPaymentResult.new_state
                            .slip_amount,
                    bank:
                        pendingPaymentResult.new_state
                            .slip_bank,
                    image_url:
                        pendingPaymentResult.new_state
                            .slip_image_url,
                    attachment_tokens:
                        pendingPaymentResult.new_state
                            .slip_attachment_tokens,
                };

                const pendingReviewNotification =
                    await recordAndDispatchNotificationOnce(
                        env,
                        {
                            event_id:
                                createNotificationEventId(
                                    "PAYMENT_REVIEW_PENDING",
                                    input,
                                    order.record_id
                                ),
                            notification_type:
                                "PAYMENT_REVIEW",
                            customer_record_id:
                                latestCustomer.record_id,
                            message:
                                `ระบบนำสลิปที่พักไว้ของ ${customerName} มาผูกกับ Order แล้ว`,
                            payload:
                                buildPaymentReviewSnapshot(
                                    latestCustomer,
                                    order,
                                    pendingEvidence,
                                    "ระบบผูกสลิปที่พักไว้กับคำสั่งซื้อแล้ว"
                                ),
                            status: "Pending",
                        }
                    );

                notifications.push(
                    pendingReviewNotification
                );
            }
        }
    }

    if (ai.intent === "delivery_address") {
        const addressResult =
            await updateActiveOrderAddress(
                env,
                latestCustomer,
                ai.address ?? input.message
            );

        order = addressResult?.record ?? order;

        if (addressResult?.changed && order) {
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
    }

    if (resolvedPhone) {
        const phoneResult =
            await updateActiveOrderPhone(
                env,
                latestCustomer,
                resolvedPhone
            );

        order = phoneResult?.record ?? order;

        if (phoneResult?.changed && order) {
            const phoneActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "PHONE_UPDATED",
                            input,
                            order.record_id
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action: "PHONE_UPDATED",
                    old_value: {
                        order_record_id:
                            order.record_id,
                        phone: phoneResult.old_phone,
                    },
                    new_value: {
                        order_record_id:
                            order.record_id,
                        phone: phoneResult.new_phone,
                        external_message_id:
                            input.external_message_id,
                    },
                });

            businessActivities.push(phoneActivity);
        }
    }

    if (
        ai.intent === "delivery_address" ||
        Boolean(resolvedPhone)
    ) {
        latestCustomer =
            await reloadCustomerByRecordId(
                env,
                latestCustomer
            );

        if (order) {
            const saleCompletion =
                await completeVerifiedSaleAfterDeliveryInfo(
                    env,
                    order.record_id
                );

            if (saleCompletion?.sale_completed) {
                order = saleCompletion.order;
                pipeline = saleCompletion.pipeline;
                latestCustomer = saleCompletion.customer;

                const saleWonActivity =
                    await recordActivityOnce(env, {
                        event_id:
                            `SALE_WON:${saleCompletion.pipeline_record_id}`,
                        customer_record_id:
                            saleCompletion.customer_record_id,
                        action: "SALE_WON",
                        old_value: {
                            pipeline_record_id:
                                saleCompletion.pipeline_record_id,
                            order_record_id:
                                saleCompletion.order.record_id,
                            stage:
                                saleCompletion.old_state.pipeline_stage,
                            status:
                                saleCompletion.old_state.pipeline_status,
                            lead_score:
                                saleCompletion.old_state.pipeline_lead_score,
                            order_status:
                                saleCompletion.old_state.order_status,
                            address:
                                saleCompletion.old_state.address,
                            phone:
                                saleCompletion.old_state.phone,
                        },
                        new_value: {
                            pipeline_record_id:
                                saleCompletion.pipeline_record_id,
                            order_record_id:
                                saleCompletion.order.record_id,
                            stage:
                                saleCompletion.new_state.pipeline_stage,
                            status:
                                saleCompletion.new_state.pipeline_status,
                            lead_score:
                                saleCompletion.new_state.pipeline_lead_score,
                            order_status:
                                saleCompletion.new_state.order_status,
                            address:
                                saleCompletion.new_state.address,
                            phone:
                                saleCompletion.new_state.phone,
                            completed_after_delivery_info: true,
                            state_changed:
                                saleCompletion.order_changed ||
                                saleCompletion.pipeline_changed ||
                                saleCompletion.customer_changed,
                            external_message_id:
                                input.external_message_id,
                        },
                    });

                businessActivities.push(saleWonActivity);

                const saleWonNotification =
                    await recordAndDispatchNotificationOnce(
                        env,
                        {
                            event_id:
                                `SALE_WON:${saleCompletion.pipeline_record_id}`,
                            notification_type: "SALE_WON",
                            customer_record_id:
                                saleCompletion.customer_record_id,
                            message:
                                "ข้อมูลจัดส่งครบแล้ว ระบบปิดการขายสำเร็จ",
                            status: "Pending",
                        }
                    );

                notifications.push(saleWonNotification);
            }
        }
    }

    if (ai.intent === "payment_slip") {
        const activeOrderId =
            order?.record_id ??
            getLarkText(
                latestCustomer.fields[
                    CUSTOMER_FIELDS.ACTIVE_ORDER_ID
                ],
                ""
            ).trim();

        if (activeOrderId) {
            const paymentReviewResult =
                await applyPaymentEvidenceToOrder(
                    env,
                    activeOrderId,
                    paymentEvidence,
                    "incoming_slip"
                );

            order = paymentReviewResult
                ? (await getOrderByRecordId(
                      env,
                      paymentReviewResult.record.record_id
                  )) ?? paymentReviewResult.record
                : order;

            if (paymentReviewResult && order) {
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
                            ...paymentReviewResult.old_state,
                        },
                        new_value: {
                            order_record_id:
                                order.record_id,
                            ...paymentReviewResult.new_state,
                            source:
                                paymentReviewResult.source,
                            state_changed:
                                paymentReviewResult.changed,
                            external_message_id:
                                input.external_message_id,
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
                                `ลูกค้า ${customerName} ส่งสลิป รอตรวจสอบการชำระเงิน`,
                            payload:
                                buildPaymentReviewSnapshot(
                                    latestCustomer,
                                    order,
                                    paymentEvidence,
                                    customerLastMessage
                                ),
                            status: "Pending",
                        }
                    );

                notifications.push(
                    paymentReviewNotification
                );
            }
        } else {
            const pendingPaymentResult =
                await savePendingPayment(
                    env,
                    latestCustomer,
                    paymentEvidence
                );

            const pendingPaymentActivity =
                await recordActivityOnce(env, {
                    event_id:
                        createActivityEventId(
                            "PENDING_PAYMENT_SAVED",
                            input
                        ),
                    customer_record_id:
                        latestCustomer.record_id,
                    action: "PENDING_PAYMENT_SAVED",
                    old_value:
                        pendingPaymentResult.old_state,
                    new_value: {
                        ...pendingPaymentResult.new_state,
                        state_changed:
                            pendingPaymentResult.changed,
                        external_message_id:
                            input.external_message_id,
                    },
                });

            businessActivities.push(
                pendingPaymentActivity
            );

            latestCustomer =
                await reloadCustomerByRecordId(
                    env,
                    pendingPaymentResult.record
                );

            const pendingNotification =
                await recordAndDispatchNotificationOnce(
                    env,
                    {
                        event_id:
                            createNotificationEventId(
                                "PAYMENT_REVIEW_PENDING",
                                input
                            ),
                        notification_type:
                            "PAYMENT_REVIEW",
                        customer_record_id:
                            latestCustomer.record_id,
                        message:
                            `ลูกค้า ${customerName} ส่งสลิป แต่ยังไม่มี Order สำหรับผูกข้อมูล`,
                        payload:
                            buildPaymentReviewSnapshot(
                                latestCustomer,
                                null,
                                paymentEvidence,
                                customerLastMessage
                            ),
                        status: "Pending",
                    }
                );

            notifications.push(
                pendingNotification
            );
        }

        latestCustomer =
            await reloadCustomerByRecordId(
                env,
                latestCustomer
            );
    }

    /*
     * Priority ภายใน Incoming Message Event เดียวกัน:
     * PAYMENT_REVIEW / SALE_WON > HOT_LEAD > NEW_LEAD
     *
     * Business Notification ที่สร้างไว้ก่อนหน้านี้จะอยู่ใน
     * notifications แล้ว ถ้ามีรายการดังกล่าวจะไม่ส่ง Lead
     * Notification ซ้ำให้รบกวนกลุ่ม Lark
     */
    if (notifications.length === 0) {
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
                            `Hot Lead ${customerName} คะแนน ${ai.lead_score}: ${customerLastMessage}`,
                        status: "Pending",
                    }
                );

            notifications.push(
                hotLeadNotification
            );
        } else if (
            shouldSendNewLeadNotification &&
            ai.intent !== "image_received"
        ) {
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
                            `ลูกค้าใหม่ ${customerName} จาก ${input.channel}: ${customerLastMessage}`,
                        status: "Pending",
                    }
                );

            notifications.push(
                newLeadNotification
            );
        }
    }

    latestCustomer =
        await reloadCustomerByRecordId(
            env,
            latestCustomer
        );

    const syncedConversation =
        await markConversationSynced(
            env,
            conversationResult.result.record_id
        );

    return {
        ok: true,
        duplicate: false,
        customer: latestCustomer,
        conversation: syncedConversation,
        pipeline,
        order,
        activity: null,
        business_activities:
            businessActivities,
        notifications,
        ai,
    };
}
