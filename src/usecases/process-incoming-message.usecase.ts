import type { Env } from "../config/env";
import { analyzeMessage } from "../ai/ai.service";
import { saveConversation } from "../modules/conversations/conversation.service";
import type {
    Channel,
    MessageType,
} from "../modules/conversations/conversation.types";
import { upsertCustomer } from "../modules/customers/customer.service";

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
    ai?: unknown;
}> {
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
        intent: ai.intent === "purchase_intent" ? "product_info" : "unknown",
        lead_score: ai.lead_score,
        hot_lead: ai.hot_lead,
        ai_summary: ai.ai_summary,
        process_status: "synced",
    });

    return {
        ok: true,
        duplicate: conversationResult.duplicate,
        customer,
        conversation: conversationResult.result ?? null,
        ai,
    };
}