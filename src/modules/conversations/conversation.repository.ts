import type { Env } from "../../config/env";
import {
    createLarkRecord,
    searchLarkRecords,
} from "../../providers/lark/lark.provider";
import type { Conversation } from "./conversation.types";

export async function createConversation(
    env: Env,
    conversation: Conversation
): Promise<unknown> {
    const fields: Record<string, unknown> = {
        channel: conversation.channel,
        external_message_id: conversation.external_message_id,
        message_type: conversation.message_type,
        message: conversation.message,
        image_url: conversation.image_url ?? "",
        intent: conversation.intent,
        lead_score: conversation.lead_score,
        hot_lead: conversation.hot_lead,
        ai_summary: conversation.ai_summary ?? "",
        process_status: conversation.process_status,
        error_message: conversation.error_message ?? "",
        created_at: conversation.created_at ?? Date.now(),
    };

    if (conversation.customer_record_id) {
        fields.customer = [conversation.customer_record_id];
    }

    return await createLarkRecord(env, env.CONVERSATIONS_TABLE_ID, fields);
}

export async function findConversationByExternalMessageId(
    env: Env,
    externalMessageId: string
): Promise<unknown | null> {
    const records = await searchLarkRecords(env, env.CONVERSATIONS_TABLE_ID, {
        conjunction: "and",
        conditions: [
            {
                field_name: "external_message_id",
                operator: "is",
                value: [externalMessageId],
            },
        ],
    });

    if (records.length === 0) {
        return null;
    }

    return records[0];
}