import type { Env } from "../config/env";
import { analyzeMessage } from "../ai/ai.service";
import { saveConversation, isDuplicateMessage } from "../modules/conversations/conversation.service";
import type {
    Channel,
    MessageType,
} from "../modules/conversations/conversation.types";
import { upsertCustomer } from "../modules/customers/customer.service";
import { createPipelineIfNeeded } from "../modules/pipeline/pipeline.service";
import { createOrderIfReadyToBuy } from "../modules/orders/order.service";

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
    const duplicate = await isDuplicateMessage(env, input.external_message_id);

    if (duplicate) {
        return {
            ok: true,
            duplicate: true,
        };
    }

    const ai = await analyzeMessage(input.message);

    const customer = await upsertCustomer(env, {
        channel: input.channel,
        channel_customer_id: input.channel_customer_id,
        customer_name: input.customer_name,
        phone: input.phone,
        last_message: input.message,
        ai,
    });

    const conversationResult = await saveConversation(env, {
        customer_record_id: customer.record_id,
        channel: input.channel,
        external_message_id: input.external_message_id,
        message_type: input.message_type,
        message: input.message,
        image_url: input.image_url,
        intent: ai.intent === "lost" ? "lost" : "unknown",
        lead_score: ai.lead_score,
        hot_lead: ai.hot_lead,
        ai_summary: ai.ai_summary,
        process_status: "synced",
    });

    let pipeline = null;
    let order = null;

    if (
        ai.intent === "purchase_intent" ||
        ai.intent === "ready_to_buy"
    ) {
        pipeline = await createPipelineIfNeeded(env, customer, {
            lead_score: ai.lead_score,
            ai_summary: ai.ai_summary,
        });
    }

    if (ai.intent === "ready_to_buy") {
        order = await createOrderIfReadyToBuy(env, customer, pipeline, {
            message: input.message,
        });
    }

    return {
        ok: true,
        duplicate: conversationResult.duplicate,
        customer,
        conversation: conversationResult.result ?? null,
        pipeline,
        order,
        ai,
    };
}