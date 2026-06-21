import type {
    AIAnalysisResult,
    ActionIntent,
    BuyerIntent,
} from "../../ai/ai.types";
import type { Env } from "../../config/env";
import { CUSTOMER_FIELDS } from "../../core/lark-fields";
import {
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { normalizePhoneNumber } from "../../utils/phone";
import type {
    Channel,
    Customer,
    CustomerStage,
} from "./customer.types";
import {
    createCustomer,
    findCustomerByChannelCustomerId,
    updateCustomer,
    type LarkCustomerRecord,
} from "./customer.repository";

export type UpsertCustomerInput = {
    channel: Channel;
    channel_customer_id: string;
    customer_name?: string;
    phone?: string;
    last_message?: string;
    ai?: AIAnalysisResult;
    increment_message_count?: boolean;
    existing_customer?: LarkCustomerRecord | null;
    force_new_sales_cycle?: boolean;
};

const STAGE_RANK: Record<CustomerStage, number> = {
    "New Lead": 0,
    Interested: 1,
    Negotiating: 2,
    Closing: 3,
    Won: 4,
    Lost: 4,
};

const BUYER_INTENT_RANK: Record<BuyerIntent, number> = {
    "Just Browsing": 0,
    Interested: 1,
    "Purchase Intent": 2,
    "Ready To Buy": 3,
};

function normalizeCustomerStage(
    value: unknown
): CustomerStage {
    const stage = getLarkText(
        value,
        "New Lead"
    );

    if (
        stage === "New Lead" ||
        stage === "Interested" ||
        stage === "Negotiating" ||
        stage === "Closing" ||
        stage === "Won" ||
        stage === "Lost"
    ) {
        return stage;
    }

    return "New Lead";
}

function normalizeBuyerIntent(
    value: unknown
): BuyerIntent {
    const buyerIntent = getLarkText(
        value,
        "Just Browsing"
    );

    if (
        buyerIntent === "Just Browsing" ||
        buyerIntent === "Interested" ||
        buyerIntent === "Purchase Intent" ||
        buyerIntent === "Ready To Buy"
    ) {
        return buyerIntent;
    }

    return "Just Browsing";
}

export function isMeaningfulNewCycleIntent(
    intent: ActionIntent
): boolean {
    return (
        intent === "ask_price" ||
        intent === "ask_discount" ||
        intent === "product_info" ||
        intent === "product_order" ||
        intent === "payment_request" ||
        intent === "payment_slip" ||
        intent === "delivery_address"
    );
}

export function isStartingNewSalesCycle(
    existingStage: CustomerStage,
    _ai: AIAnalysisResult
): boolean {
    /*
     * Closed customers must start with a clean sales context on the
     * very next inbound message, including a simple greeting.
     * Keeping Won/Lost data until a purchase-intent message caused
     * stale stage, score, product and quantity to leak into the next cycle.
     */
    return (
        existingStage === "Won" ||
        existingStage === "Lost"
    );
}

function mergeCustomerStage(
    existingStage: CustomerStage,
    ai: AIAnalysisResult
): CustomerStage {
    if (ai.intent === "lost") {
        return "Lost";
    }

    if (
        existingStage === "Won" ||
        existingStage === "Lost"
    ) {
        if (isMeaningfulNewCycleIntent(ai.intent)) {
            return ai.customer_stage;
        }

        return existingStage;
    }

    if (
        STAGE_RANK[ai.customer_stage] >=
        STAGE_RANK[existingStage]
    ) {
        return ai.customer_stage;
    }

    return existingStage;
}

function mergeBuyerIntent(
    existingBuyerIntent: BuyerIntent,
    existingStage: CustomerStage,
    ai: AIAnalysisResult
): BuyerIntent {
    if (ai.intent === "lost") {
        return "Just Browsing";
    }

    if (
        existingStage === "Won" ||
        existingStage === "Lost"
    ) {
        if (isMeaningfulNewCycleIntent(ai.intent)) {
            return ai.buyer_intent;
        }

        return existingBuyerIntent;
    }

    if (
        BUYER_INTENT_RANK[ai.buyer_intent] >=
        BUYER_INTENT_RANK[existingBuyerIntent]
    ) {
        return ai.buyer_intent;
    }

    return existingBuyerIntent;
}

function mergeLeadScore(
    existingScore: number,
    existingStage: CustomerStage,
    ai: AIAnalysisResult
): number {
    if (ai.intent === "lost") {
        return 0;
    }

    if (isStartingNewSalesCycle(existingStage, ai)) {
        return ai.lead_score;
    }

    if (
        existingStage === "Won" ||
        existingStage === "Lost"
    ) {
        return existingScore;
    }

    return Math.max(existingScore, ai.lead_score);
}

function mergeHotLead(
    existingHotLead: boolean,
    existingStage: CustomerStage,
    ai: AIAnalysisResult
): boolean {
    if (ai.intent === "lost") {
        return false;
    }

    if (isStartingNewSalesCycle(existingStage, ai)) {
        return ai.hot_lead;
    }

    if (
        existingStage === "Won" ||
        existingStage === "Lost"
    ) {
        return existingHotLead;
    }

    return existingHotLead || ai.hot_lead;
}

export async function upsertCustomer(
    env: Env,
    input: UpsertCustomerInput
): Promise<LarkCustomerRecord> {
    const incomingPhone =
        normalizePhoneNumber(input.phone) ??
        normalizePhoneNumber(input.ai?.phone);

    const existingCustomer =
        input.existing_customer !== undefined
            ? input.existing_customer
            : await findCustomerByChannelCustomerId(
                  env,
                  input.channel,
                  input.channel_customer_id
              );

    if (!existingCustomer) {
        const newCustomer: Customer = {
            channel: input.channel,
            channel_customer_id:
                input.channel_customer_id,
            customer_name:
                input.customer_name ??
                "Unknown Customer",
            phone: incomingPhone ?? "",
            current_stage:
                input.ai?.customer_stage ??
                "New Lead",
            buyer_intent:
                input.ai?.buyer_intent ??
                "Just Browsing",
            lead_score:
                input.ai?.lead_score ?? 0,
            hot_lead:
                input.ai?.hot_lead ?? false,
            ai_summary:
                input.ai?.ai_summary ?? "",
            last_message:
                input.last_message ?? "",
            message_count: 1,
            product_name:
                input.ai?.product_name ?? "",
            product_qty:
                input.ai?.quantity ?? 0,
            product_unit:
                input.ai?.product_unit ?? "",
            pending_payment: false,
            pending_slip_amount: 0,
            pending_slip_bank: "",
            pending_slip_image_url: "",
            pending_slip_attachment_tokens: [],
            sales_owner: "Unassigned",
        };

        return await createCustomer(
            env,
            newCustomer
        );
    }

    const existingFields =
        existingCustomer.fields;

    const existingStage =
        normalizeCustomerStage(
            existingFields[
                CUSTOMER_FIELDS.CURRENT_STAGE
            ]
        );

    const existingBuyerIntent =
        normalizeBuyerIntent(
            existingFields[
                CUSTOMER_FIELDS.BUYER_INTENT
            ]
        );

    const existingLeadScore = getLarkNumber(
        existingFields[
            CUSTOMER_FIELDS.LEAD_SCORE
        ],
        0
    );

    const existingHotLead = getLarkBoolean(
        existingFields[
            CUSTOMER_FIELDS.HOT_LEAD
        ],
        false
    );

    /*
     * A lost/cancel message closes the current sales cycle. It must never be
     * interpreted as the first message of a new cycle, even when a retry sees
     * Customer.current_stage = Lost from a previous partial attempt.
     * Otherwise active IDs are cleared before Pipeline/Order can be closed.
     */
    const isLostTransition = input.ai?.intent === "lost";

    const startingNewSalesCycle =
        !isLostTransition &&
        (input.force_new_sales_cycle === true ||
            (input.ai
                ? isStartingNewSalesCycle(
                      existingStage,
                      input.ai
                  )
                : false));

    const nextStage = input.ai
        ? startingNewSalesCycle
            ? input.ai.customer_stage
            : mergeCustomerStage(
                  existingStage,
                  input.ai
              )
        : existingStage;

    const nextBuyerIntent = input.ai
        ? startingNewSalesCycle
            ? input.ai.buyer_intent
            : mergeBuyerIntent(
                  existingBuyerIntent,
                  existingStage,
                  input.ai
              )
        : existingBuyerIntent;

    const nextLeadScore = input.ai
        ? startingNewSalesCycle
            ? input.ai.lead_score
            : mergeLeadScore(
                  existingLeadScore,
                  existingStage,
                  input.ai
              )
        : existingLeadScore;

    const nextHotLead = input.ai
        ? startingNewSalesCycle
            ? input.ai.hot_lead
            : mergeHotLead(
                  existingHotLead,
                  existingStage,
                  input.ai
              )
        : existingHotLead;

    return await updateCustomer(
        env,
        existingCustomer.record_id,
        {
            customer_name:
                input.customer_name ??
                getLarkText(
                    existingFields[
                        CUSTOMER_FIELDS.CUSTOMER_NAME
                    ],
                    "Unknown Customer"
                ),

            phone:
                incomingPhone ??
                getLarkText(
                    existingFields[
                        CUSTOMER_FIELDS.PHONE
                    ],
                    ""
                ),

            current_stage: nextStage,

            buyer_intent:
                nextBuyerIntent,

            lead_score:
                nextLeadScore,

            hot_lead:
                nextHotLead,

            ai_summary:
                input.ai?.ai_summary ??
                getLarkText(
                    existingFields[
                        CUSTOMER_FIELDS.AI_SUMMARY
                    ],
                    ""
                ),

            last_message:
                input.last_message ?? "",

            message_count:
                getLarkNumber(
                    existingFields[
                        CUSTOMER_FIELDS.MESSAGE_COUNT
                    ],
                    0
                ) +
                (input.increment_message_count === false
                    ? 0
                    : 1),

            product_name: startingNewSalesCycle
                ? input.ai?.product_name ?? ""
                : input.ai?.product_name ??
                  getLarkText(
                      existingFields[
                          CUSTOMER_FIELDS.PRODUCT_NAME
                      ],
                      ""
                  ),

            product_qty: startingNewSalesCycle
                ? input.ai?.quantity ?? 0
                : input.ai?.quantity ??
                  getLarkNumber(
                      existingFields[
                          CUSTOMER_FIELDS.PRODUCT_QTY
                      ],
                      0
                  ),

            product_unit: startingNewSalesCycle
                ? input.ai?.product_unit ?? ""
                : input.ai?.product_unit ??
                  getLarkText(
                      existingFields[
                          CUSTOMER_FIELDS.PRODUCT_UNIT
                      ],
                      ""
                  ),

            ...(startingNewSalesCycle
                ? {
                      active_pipeline_id: "",
                      active_order_id: "",
                      pending_payment: false,
                      pending_slip_amount: 0,
                      pending_slip_bank: "",
                      pending_slip_image_url: "",
                      pending_slip_attachment_tokens: [],
                  }
                : {}),
        }
    );
}

export async function markCustomerLost(
    env: Env,
    customer: LarkCustomerRecord
): Promise<LarkCustomerRecord> {
    return await updateCustomer(
        env,
        customer.record_id,
        {
            current_stage: "Lost",
            buyer_intent: "Just Browsing",
            lead_score: 0,
            hot_lead: false,

            active_pipeline_id: "",
            active_order_id: "",

            product_name: "",
            product_qty: 0,
            product_unit: "",

            pending_payment: false,
            pending_slip_amount: 0,
            pending_slip_bank: "",
            pending_slip_image_url: "",
            pending_slip_attachment_tokens: [],
            ai_summary:
                "ลูกค้ายกเลิกการซื้อ รอเริ่มการขายใหม่",
        }
    );
}
