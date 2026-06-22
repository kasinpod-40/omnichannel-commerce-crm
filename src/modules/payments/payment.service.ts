import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import {
    getFirstLinkedRecordId,
    getLarkAttachmentTokens,
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { normalizePhoneNumber } from "../../utils/phone";
import {
    getCustomerByRecordId,
    updateCustomer,
    type LarkCustomerRecord,
} from "../customers/customer.repository";
import {
    getOrderByRecordId,
    updateOrder,
    type LarkOrderRecord,
} from "../orders/order.repository";
import {
    getPipelineByRecordId,
    updatePipeline,
    type LarkPipelineRecord,
} from "../pipeline/pipeline.repository";

export type PaymentEvidence = {
    amount?: number;
    bank?: string;
    image_url?: string;
    attachment_tokens?: string[];
};

export type PaymentEvidenceSnapshot = {
    amount: number;
    bank: string;
    image_url: string;
    attachment_tokens: string[];
};

export type PendingPaymentSaveResult = {
    record: LarkCustomerRecord;
    changed: boolean;
    old_state: PaymentEvidenceSnapshot & {
        pending_payment: boolean;
    };
    new_state: PaymentEvidenceSnapshot & {
        pending_payment: true;
    };
};

export type PaymentReviewApplyResult = {
    record: LarkOrderRecord;
    changed: boolean;
    source: "incoming_slip" | "pending_payment";
    old_state: {
        payment_status: string;
        order_status: string;
        payment_verified: boolean;
        slip_amount: number;
        slip_bank: string;
        slip_image_url: string;
        slip_attachment_tokens: string[];
    };
    new_state: {
        payment_status: "Payment Review";
        order_status: "Payment Review";
        payment_verified: false;
        slip_amount: number;
        slip_bank: string;
        slip_image_url: string;
        slip_attachment_tokens: string[];
    };
    pending_payment_cleared: boolean;
};

export type PaymentLifecycleState = {
    payment_status: string;
    order_status: string;
    payment_verified: boolean;
    paid_at: number;
    total_amount: number;
    slip_amount: number;
    address: string;
    phone: string;
    pipeline_stage: string;
    pipeline_status: string;
    pipeline_lead_score: number;
    customer_stage: string;
    customer_lead_score: number;
    customer_hot_lead: boolean;
    customer_product_name: string;
    customer_product_size: string;
    customer_product_qty: number;
    customer_product_unit: string;
    customer_pending_payment: boolean;
    active_order_id: string;
    active_pipeline_id: string;
};

export type PaymentLifecycleResult = {
    customer_record_id: string;
    pipeline_record_id: string;
    customer: LarkCustomerRecord;
    pipeline: LarkPipelineRecord;
    order: LarkOrderRecord;
    current_sale: boolean;
    already_verified: boolean;
    sale_completed: boolean;
    waiting_address: boolean;
    waiting_phone: boolean;
    order_changed: boolean;
    pipeline_changed: boolean;
    customer_changed: boolean;
    old_state: PaymentLifecycleState;
    new_state: PaymentLifecycleState;
};

export type MissingDeliveryField = "address" | "phone";

export function getMissingDeliveryFields(
    address: string | null | undefined,
    phone: string | null | undefined
): MissingDeliveryField[] {
    const missing: MissingDeliveryField[] = [];

    if (!(address ?? "").trim()) {
        missing.push("address");
    }

    if (!normalizePhoneNumber(phone)) {
        missing.push("phone");
    }

    return missing;
}

function normalizeAmount(value: number | undefined): number {
    if (!Number.isFinite(value) || (value ?? 0) <= 0) {
        return 0;
    }

    return Number(value);
}

export function resolveVerifiedTotalAmount(
    currentTotalAmount: number,
    slipAmount: number
): number {
    const normalizedSlipAmount = normalizeAmount(slipAmount);

    if (normalizedSlipAmount > 0) {
        return normalizedSlipAmount;
    }

    return Math.max(0, Number(currentTotalAmount) || 0);
}

function normalizeText(value: string | undefined): string {
    return (value ?? "").trim();
}

function getPendingSnapshot(
    customer: LarkCustomerRecord
): PaymentEvidenceSnapshot & {
    pending_payment: boolean;
} {
    return {
        pending_payment: getLarkBoolean(
            customer.fields[
                CUSTOMER_FIELDS.PENDING_PAYMENT
            ],
            false
        ),
        amount: getLarkNumber(
            customer.fields[
                CUSTOMER_FIELDS.PENDING_SLIP_AMOUNT
            ],
            0
        ),
        bank: getLarkText(
            customer.fields[
                CUSTOMER_FIELDS.PENDING_SLIP_BANK
            ],
            ""
        ).trim(),
        image_url: getLarkText(
            customer.fields[
                CUSTOMER_FIELDS.PENDING_SLIP_IMAGE_URL
            ],
            ""
        ).trim(),
        attachment_tokens: getLarkAttachmentTokens(
            customer.fields[
                CUSTOMER_FIELDS.PENDING_SLIP_ATTACHMENT
            ]
        ),
    };
}

function getOrderPaymentSnapshot(
    order: LarkOrderRecord
): PaymentReviewApplyResult["old_state"] {
    return {
        payment_status: getLarkText(
            order.fields[ORDER_FIELDS.PAYMENT_STATUS],
            "Waiting Payment"
        ),
        order_status: getLarkText(
            order.fields[ORDER_FIELDS.ORDER_STATUS],
            "Waiting Payment"
        ),
        payment_verified: getLarkBoolean(
            order.fields[ORDER_FIELDS.PAYMENT_VERIFIED],
            false
        ),
        slip_amount: getLarkNumber(
            order.fields[ORDER_FIELDS.SLIP_AMOUNT],
            0
        ),
        slip_bank: getLarkText(
            order.fields[ORDER_FIELDS.SLIP_BANK],
            ""
        ).trim(),
        slip_image_url: getLarkText(
            order.fields[ORDER_FIELDS.SLIP_IMAGE_URL],
            ""
        ).trim(),
        slip_attachment_tokens: getLarkAttachmentTokens(
            order.fields[ORDER_FIELDS.SLIP_ATTACHMENT]
        ),
    };
}

function getPaymentLifecycleState(
    order: LarkOrderRecord,
    customer: LarkCustomerRecord,
    pipeline: LarkPipelineRecord
): PaymentLifecycleState {
    return {
        payment_status: getLarkText(
            order.fields[ORDER_FIELDS.PAYMENT_STATUS],
            ""
        ).trim(),
        order_status: getLarkText(
            order.fields[ORDER_FIELDS.ORDER_STATUS],
            ""
        ).trim(),
        payment_verified: getLarkBoolean(
            order.fields[ORDER_FIELDS.PAYMENT_VERIFIED],
            false
        ),
        paid_at: getLarkNumber(
            order.fields[ORDER_FIELDS.PAID_AT],
            0
        ),
        total_amount: getLarkNumber(
            order.fields[ORDER_FIELDS.TOTAL_AMOUNT],
            0
        ),
        slip_amount: getLarkNumber(
            order.fields[ORDER_FIELDS.SLIP_AMOUNT],
            0
        ),
        address: getLarkText(
            order.fields[ORDER_FIELDS.ADDRESS],
            ""
        ).trim(),
        phone:
            normalizePhoneNumber(
                getLarkText(
                    order.fields[ORDER_FIELDS.PHONE],
                    ""
                )
            ) ?? "",
        pipeline_stage: getLarkText(
            pipeline.fields[PIPELINE_FIELDS.STAGE],
            ""
        ).trim(),
        pipeline_status: getLarkText(
            pipeline.fields[PIPELINE_FIELDS.STATUS],
            ""
        ).trim(),
        pipeline_lead_score: getLarkNumber(
            pipeline.fields[PIPELINE_FIELDS.LEAD_SCORE],
            0
        ),
        customer_stage: getLarkText(
            customer.fields[CUSTOMER_FIELDS.CURRENT_STAGE],
            ""
        ).trim(),
        customer_lead_score: getLarkNumber(
            customer.fields[CUSTOMER_FIELDS.LEAD_SCORE],
            0
        ),
        customer_hot_lead: getLarkBoolean(
            customer.fields[CUSTOMER_FIELDS.HOT_LEAD],
            false
        ),
        customer_product_name: getLarkText(
            customer.fields[CUSTOMER_FIELDS.PRODUCT_NAME],
            ""
        ).trim(),
        customer_product_size: getLarkText(
            customer.fields[CUSTOMER_FIELDS.PRODUCT_SIZE],
            ""
        ).trim(),
        customer_product_qty: getLarkNumber(
            customer.fields[CUSTOMER_FIELDS.PRODUCT_QTY],
            0
        ),
        customer_product_unit: getLarkText(
            customer.fields[CUSTOMER_FIELDS.PRODUCT_UNIT],
            ""
        ).trim(),
        customer_pending_payment: getLarkBoolean(
            customer.fields[CUSTOMER_FIELDS.PENDING_PAYMENT],
            false
        ),
        active_order_id: getLarkText(
            customer.fields[
                CUSTOMER_FIELDS.ACTIVE_ORDER_ID
            ],
            ""
        ).trim(),
        active_pipeline_id: getLarkText(
            customer.fields[
                CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID
            ],
            ""
        ).trim(),
    };
}

function mergeEvidence(
    current: PaymentEvidenceSnapshot,
    incoming: PaymentEvidence
): PaymentEvidenceSnapshot {
    const incomingAmount = normalizeAmount(incoming.amount);
    const incomingBank = normalizeText(incoming.bank);
    const incomingImageUrl = normalizeText(
        incoming.image_url
    );
    const incomingAttachmentTokens = [
        ...new Set(
            (incoming.attachment_tokens ?? [])
                .map((token) => token.trim())
                .filter(Boolean)
        ),
    ];

    return {
        amount:
            incomingAmount > 0
                ? incomingAmount
                : current.amount,
        bank: incomingBank || current.bank,
        image_url:
            incomingImageUrl || current.image_url,
        attachment_tokens:
            incomingAttachmentTokens.length > 0
                ? incomingAttachmentTokens
                : current.attachment_tokens,
    };
}

function paymentStatesEqual(
    oldState: PaymentReviewApplyResult["old_state"],
    newState: PaymentReviewApplyResult["new_state"]
): boolean {
    return (
        oldState.payment_status ===
            newState.payment_status &&
        oldState.order_status === newState.order_status &&
        oldState.payment_verified ===
            newState.payment_verified &&
        oldState.slip_amount === newState.slip_amount &&
        oldState.slip_bank === newState.slip_bank &&
        oldState.slip_image_url ===
            newState.slip_image_url &&
        JSON.stringify(oldState.slip_attachment_tokens) ===
            JSON.stringify(newState.slip_attachment_tokens)
    );
}

export function normalizePaymentEvidence(
    evidence: PaymentEvidence,
    fallbackImageUrl = ""
): PaymentEvidenceSnapshot {
    return {
        amount: normalizeAmount(evidence.amount),
        bank: normalizeText(evidence.bank),
        image_url:
            normalizeText(evidence.image_url) ||
            normalizeText(fallbackImageUrl),
        attachment_tokens: [
            ...new Set(
                (evidence.attachment_tokens ?? [])
                    .map((token) => token.trim())
                    .filter(Boolean)
            ),
        ],
    };
}

export async function savePendingPayment(
    env: Env,
    customer: LarkCustomerRecord,
    evidence: PaymentEvidence
): Promise<PendingPaymentSaveResult> {
    const oldState = getPendingSnapshot(customer);
    const merged = mergeEvidence(
        {
            amount: oldState.amount,
            bank: oldState.bank,
            image_url: oldState.image_url,
            attachment_tokens: oldState.attachment_tokens,
        },
        evidence
    );

    const newState = {
        pending_payment: true as const,
        ...merged,
    };

    const changed =
        oldState.pending_payment !== true ||
        oldState.amount !== newState.amount ||
        oldState.bank !== newState.bank ||
        oldState.image_url !== newState.image_url ||
        JSON.stringify(oldState.attachment_tokens) !==
            JSON.stringify(newState.attachment_tokens);

    const record = changed
        ? await updateCustomer(env, customer.record_id, {
              pending_payment: true,
              pending_slip_amount: newState.amount,
              pending_slip_bank: newState.bank,
              pending_slip_image_url:
                  newState.image_url,
              pending_slip_attachment_tokens:
                  newState.attachment_tokens,
          })
        : customer;

    return {
        record,
        changed,
        old_state: oldState,
        new_state: newState,
    };
}

export async function clearPendingPayment(
    env: Env,
    customer: LarkCustomerRecord
): Promise<LarkCustomerRecord> {
    return await updateCustomer(env, customer.record_id, {
        pending_payment: false,
        pending_slip_amount: 0,
        pending_slip_bank: "",
        pending_slip_image_url: "",
        pending_slip_attachment_tokens: [],
    });
}

export async function applyPaymentEvidenceToOrder(
    env: Env,
    orderRecordId: string,
    evidence: PaymentEvidence,
    source: PaymentReviewApplyResult["source"]
): Promise<PaymentReviewApplyResult | null> {
    const order = await getOrderByRecordId(
        env,
        orderRecordId
    );

    if (!order) {
        return null;
    }

    const orderStatus = getLarkText(
        order.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    )
        .trim()
        .toLowerCase();

    if (
        orderStatus === "completed" ||
        orderStatus === "cancelled"
    ) {
        return null;
    }

    const oldState = getOrderPaymentSnapshot(order);
    const merged = mergeEvidence(
        {
            amount: oldState.slip_amount,
            bank: oldState.slip_bank,
            image_url: oldState.slip_image_url,
            attachment_tokens:
                oldState.slip_attachment_tokens,
        },
        evidence
    );

    const newState: PaymentReviewApplyResult["new_state"] = {
        payment_status: "Payment Review",
        order_status: "Payment Review",
        payment_verified: false,
        slip_amount: merged.amount,
        slip_bank: merged.bank,
        slip_image_url: merged.image_url,
        slip_attachment_tokens:
            merged.attachment_tokens,
    };

    const changed = !paymentStatesEqual(
        oldState,
        newState
    );

    const record = changed
        ? await updateOrder(env, order.record_id, {
              payment_status:
                  newState.payment_status,
              order_status: newState.order_status,
              payment_verified:
                  newState.payment_verified,
              slip_amount: newState.slip_amount,
              slip_bank: newState.slip_bank,
              slip_image_url:
                  newState.slip_image_url,
              slip_attachment_tokens:
                  newState.slip_attachment_tokens,
          })
        : order;

    return {
        record,
        changed,
        source,
        old_state: oldState,
        new_state: newState,
        pending_payment_cleared: false,
    };
}

export async function applyPendingPaymentToOrder(
    env: Env,
    customer: LarkCustomerRecord,
    orderRecordId: string
): Promise<PaymentReviewApplyResult | null> {
    const pending = getPendingSnapshot(customer);

    if (!pending.pending_payment) {
        return null;
    }

    const result = await applyPaymentEvidenceToOrder(
        env,
        orderRecordId,
        {
            amount: pending.amount,
            bank: pending.bank,
            image_url: pending.image_url,
            attachment_tokens:
                pending.attachment_tokens,
        },
        "pending_payment"
    );

    if (!result) {
        return null;
    }

    await clearPendingPayment(env, customer);

    return {
        ...result,
        pending_payment_cleared: true,
    };
}

async function applyVerifiedPaymentLifecycle(
    env: Env,
    order: LarkOrderRecord,
    customer: LarkCustomerRecord,
    pipeline: LarkPipelineRecord,
    requireExistingVerification: boolean
): Promise<PaymentLifecycleResult | null> {
    const oldState = getPaymentLifecycleState(
        order,
        customer,
        pipeline
    );

    const normalizedOrderStatus =
        oldState.order_status.toLowerCase();
    const normalizedPipelineStatus =
        oldState.pipeline_status.toLowerCase();
    const normalizedPaymentStatus =
        oldState.payment_status.toLowerCase();

    if (
        normalizedOrderStatus === "cancelled" ||
        normalizedPipelineStatus === "lost"
    ) {
        return null;
    }

    if (
        requireExistingVerification &&
        (!oldState.payment_verified ||
            normalizedPaymentStatus !== "paid")
    ) {
        return null;
    }

    const missingDeliveryFields =
        getMissingDeliveryFields(
            oldState.address,
            oldState.phone
        );
    const addressPresent =
        !missingDeliveryFields.includes("address");
    const phonePresent =
        !missingDeliveryFields.includes("phone");
    const saleCompleted = addressPresent && phonePresent;
    const waitingAddress = !addressPresent;
    const waitingPhone = !phonePresent;
    const missingDeliverySummary = [
        waitingAddress ? "ที่อยู่" : "",
        waitingPhone ? "เบอร์โทรศัพท์" : "",
    ]
        .filter(Boolean)
        .join("และ");
    const paidAt = oldState.paid_at || Date.now();
    const hasDifferentActiveOrder =
        Boolean(oldState.active_order_id) &&
        oldState.active_order_id !== order.record_id;
    const hasDifferentActivePipeline =
        Boolean(oldState.active_pipeline_id) &&
        oldState.active_pipeline_id !== pipeline.record_id;

    /*
     * Order และ Pipeline ที่ส่งเข้า Flow ถูกตรวจ Link กับ Customer แล้ว
     * จึงถือเป็นรอบขายปัจจุบันได้เมื่อ Customer ไม่มี Active ID อื่นชี้อยู่
     * รองรับข้อมูลเก่าที่ Active ID หลุดหรือถูกล้างก่อน Workflow ทำงาน
     */
    const currentSale =
        !hasDifferentActiveOrder &&
        !hasDifferentActivePipeline;

    const targetOrderStatus = saleCompleted
        ? "Completed"
        : "Waiting Address";
    const targetTotalAmount =
        resolveVerifiedTotalAmount(
            oldState.total_amount,
            oldState.slip_amount
        );

    const orderChanged =
        normalizedPaymentStatus !== "paid" ||
        oldState.payment_verified !== true ||
        oldState.order_status !== targetOrderStatus ||
        oldState.paid_at !== paidAt ||
        oldState.total_amount !== targetTotalAmount;

    let nextOrder = order;

    if (orderChanged) {
        nextOrder = await updateOrder(
            env,
            order.record_id,
            {
                payment_status: "Paid",
                payment_verified: true,
                order_status: targetOrderStatus,
                paid_at: paidAt,
                ...(targetTotalAmount > 0 &&
                oldState.total_amount !== targetTotalAmount
                    ? { total_amount: targetTotalAmount }
                    : {}),
            }
        );
    }

    const targetPipelineStage = saleCompleted
        ? "Won"
        : "Closing";
    const targetPipelineStatus = saleCompleted
        ? "won"
        : "open";
    const targetPipelineLeadScore = Math.max(
        100,
        oldState.pipeline_lead_score
    );

    const pipelineChanged =
        oldState.pipeline_stage !== targetPipelineStage ||
        normalizedPipelineStatus !== targetPipelineStatus ||
        oldState.pipeline_lead_score !==
            targetPipelineLeadScore;

    let nextPipeline = pipeline;

    if (pipelineChanged) {
        nextPipeline = await updatePipeline(
            env,
            pipeline.record_id,
            {
                stage: targetPipelineStage,
                status: targetPipelineStatus,
                lead_score: targetPipelineLeadScore,
                ai_summary: saleCompleted
                    ? "Sales ยืนยันการชำระเงินและข้อมูลจัดส่งครบ ปิดการขายสำเร็จ"
                    : `Sales ยืนยันการชำระเงินแล้ว รอลูกค้าส่ง${missingDeliverySummary}`,
                ...(saleCompleted
                    ? { closed_at: Date.now() }
                    : {}),
            }
        );
    }

    let customerChanged = false;
    let nextCustomer = customer;

    if (currentSale) {
        if (saleCompleted) {
            customerChanged =
                oldState.customer_stage !== "Won" ||
                oldState.customer_lead_score !== 100 ||
                oldState.customer_hot_lead !== false ||
                oldState.customer_product_name !== "" ||
                oldState.customer_product_size !== "" ||
                oldState.customer_product_qty !== 0 ||
                oldState.customer_product_unit !== "" ||
                oldState.customer_pending_payment !== false ||
                oldState.active_order_id !== "" ||
                oldState.active_pipeline_id !== "";

            if (customerChanged) {
                nextCustomer = await updateCustomer(
                    env,
                    customer.record_id,
                    {
                        current_stage: "Won",
                        buyer_intent: "Ready To Buy",
                        lead_score: 100,
                        hot_lead: false,
                        ai_summary:
                            "Sales ยืนยันการชำระเงินและข้อมูลจัดส่งครบ ปิดการขายสำเร็จ",
                        active_pipeline_id: "",
                        active_order_id: "",
                        product_name: "",
                        product_size: "",
                        product_qty: 0,
                        product_unit: "",
                        pending_payment: false,
                        pending_slip_amount: 0,
                        pending_slip_bank: "",
                        pending_slip_image_url: "",
                        pending_slip_attachment_tokens: [],
                    }
                );
            }
        } else {
            customerChanged =
                oldState.customer_stage !== "Closing" ||
                oldState.customer_lead_score !== 100;

            if (customerChanged) {
                nextCustomer = await updateCustomer(
                    env,
                    customer.record_id,
                    {
                        current_stage: "Closing",
                        buyer_intent: "Ready To Buy",
                        lead_score: 100,
                        ai_summary:
                            `Sales ยืนยันการชำระเงินแล้ว รอลูกค้าส่ง${missingDeliverySummary}`,
                    }
                );
            }
        }
    }

    const finalOrder =
        (await getOrderByRecordId(
            env,
            order.record_id
        )) ?? nextOrder;
    const finalPipeline =
        (await getPipelineByRecordId(
            env,
            pipeline.record_id
        )) ?? nextPipeline;
    const finalCustomer =
        (await getCustomerByRecordId(
            env,
            customer.record_id
        )) ?? nextCustomer;

    const newState = getPaymentLifecycleState(
        finalOrder,
        finalCustomer,
        finalPipeline
    );

    return {
        customer_record_id: customer.record_id,
        pipeline_record_id: pipeline.record_id,
        customer: finalCustomer,
        pipeline: finalPipeline,
        order: finalOrder,
        current_sale: currentSale,
        already_verified:
            oldState.payment_verified &&
            normalizedPaymentStatus === "paid",
        sale_completed: saleCompleted,
        waiting_address: waitingAddress,
        waiting_phone: waitingPhone,
        order_changed: orderChanged,
        pipeline_changed: pipelineChanged,
        customer_changed: customerChanged,
        old_state: oldState,
        new_state: newState,
    };
}

export async function applyManualPaymentVerification(
    env: Env,
    order: LarkOrderRecord,
    customer: LarkCustomerRecord,
    pipeline: LarkPipelineRecord
): Promise<PaymentLifecycleResult | null> {
    return await applyVerifiedPaymentLifecycle(
        env,
        order,
        customer,
        pipeline,
        false
    );
}

export async function completeVerifiedSaleAfterDeliveryInfo(
    env: Env,
    orderRecordId: string
): Promise<PaymentLifecycleResult | null> {
    const order = await getOrderByRecordId(
        env,
        orderRecordId
    );

    if (!order) {
        return null;
    }

    const customerRecordId = getFirstLinkedRecordId(
        order.fields[ORDER_FIELDS.CUSTOMER]
    );
    const pipelineRecordId = getFirstLinkedRecordId(
        order.fields[ORDER_FIELDS.PIPELINE]
    );

    if (!customerRecordId || !pipelineRecordId) {
        return null;
    }

    const [customer, pipeline] = await Promise.all([
        getCustomerByRecordId(env, customerRecordId),
        getPipelineByRecordId(env, pipelineRecordId),
    ]);

    if (!customer || !pipeline) {
        return null;
    }

    return await applyVerifiedPaymentLifecycle(
        env,
        order,
        customer,
        pipeline,
        true
    );
}

// Backward-compatible alias for existing imports.
export const completeVerifiedSaleAfterAddress =
    completeVerifiedSaleAfterDeliveryInfo;
