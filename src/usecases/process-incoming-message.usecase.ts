import { analyzeMessage } from "../ai/ai.service";
import type { AIIntent } from "../ai/ai.types";
import type { Env } from "../config/env";
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
import type { PipelineStage } from "../modules/pipeline/pipeline.types";

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

async function reloadCustomer(
    env: Env,
    input: ProcessIncomingMessageInput,
    fallback: LarkCustomerRecord
): Promise<LarkCustomerRecord> {
    return (
        (await findCustomerByChannelCustomerId(
            env,
            input.channel,
            input.channel_customer_id
        )) ?? fallback
    );
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
    ai?: unknown;
}> {
    const duplicate = await isDuplicateMessage(
        env,
        input.external_message_id
    );

    if (duplicate) {
        return {
            ok: true,
            duplicate: true,
        };
    }

    const ai = await analyzeMessage(input.message);

    const upsertedCustomer = await upsertCustomer(env, {
        channel: input.channel,
        channel_customer_id: input.channel_customer_id,
        customer_name: input.customer_name,
        phone: input.phone,
        last_message: input.message,
        ai,
    });

    let latestCustomer = await reloadCustomer(
        env,
        input,
        upsertedCustomer
    );

    const conversationResult = await saveConversation(env, {
        customer_record_id: latestCustomer.record_id,
        channel: input.channel,
        external_message_id: input.external_message_id,
        message_type: input.message_type,
        message: input.message,
        image_url: input.image_url,
        intent: ai.intent,
        lead_score: ai.lead_score,
        hot_lead: ai.hot_lead,
        ai_summary: ai.ai_summary,
        process_status: "synced",
    });

    if (ai.intent === "lost") {
        const lostPipeline = await markActivePipelineLost(
            env,
            latestCustomer
        );

        const cancelledOrder = await cancelActiveOrder(
            env,
            latestCustomer
        );

        const lostCustomer = await markCustomerLost(
            env,
            latestCustomer
        );

        return {
            ok: true,
            duplicate: conversationResult.duplicate,
            customer: lostCustomer,
            conversation: conversationResult.result ?? null,
            pipeline: lostPipeline,
            order: cancelledOrder,
            ai,
        };
    }

    let pipeline = null;
    let order = null;

    const pipelineStage = getPipelineStage(ai.intent);

    if (pipelineStage) {
        pipeline = await createPipelineIfNeeded(
            env,
            latestCustomer,
            {
                stage: pipelineStage,
                lead_score: ai.lead_score,
                ai_summary: ai.ai_summary,
            }
        );

        latestCustomer = await reloadCustomer(
            env,
            input,
            latestCustomer
        );
    }

    if (ai.intent === "ready_to_buy") {
        order = await createOrderIfReadyToBuy(
            env,
            latestCustomer,
            pipeline,
            {
                message: input.message,
                quantity: ai.quantity ?? 1,
            }
        );

        latestCustomer = await reloadCustomer(
            env,
            input,
            latestCustomer
        );
    }

    if (ai.intent === "delivery_address") {
        order = await updateActiveOrderAddress(
            env,
            latestCustomer,
            ai.address ?? input.message
        );

        latestCustomer = await reloadCustomer(
            env,
            input,
            latestCustomer
        );
    }

    if (ai.intent === "payment_slip") {
        order = await markActiveOrderPaymentReview(
            env,
            latestCustomer
        );

        latestCustomer = await reloadCustomer(
            env,
            input,
            latestCustomer
        );
    }

    return {
        ok: true,
        duplicate: conversationResult.duplicate,
        customer: latestCustomer,
        conversation: conversationResult.result ?? null,
        pipeline,
        order,
        ai,
    };
}