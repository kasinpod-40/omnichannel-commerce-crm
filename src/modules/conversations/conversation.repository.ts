import type { Env } from "../../config/env";
import { CONVERSATION_FIELDS } from "../../core/lark-fields";
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
        [CONVERSATION_FIELDS.CHANNEL]: conversation.channel,
        [CONVERSATION_FIELDS.EXTERNAL_MESSAGE_ID]:
            conversation.external_message_id,
        [CONVERSATION_FIELDS.MESSAGE_TYPE]: conversation.message_type,
        [CONVERSATION_FIELDS.MESSAGE]: conversation.message,
        [CONVERSATION_FIELDS.IMAGE_URL]: conversation.image_url ?? "",
        [CONVERSATION_FIELDS.INTENT]: conversation.intent,
        [CONVERSATION_FIELDS.LEAD_SCORE]: conversation.lead_score,
        [CONVERSATION_FIELDS.HOT_LEAD]: conversation.hot_lead,
        [CONVERSATION_FIELDS.AI_SUMMARY]: conversation.ai_summary ?? "",
        [CONVERSATION_FIELDS.PROCESS_STATUS]: conversation.process_status,
        [CONVERSATION_FIELDS.ERROR_MESSAGE]: conversation.error_message ?? "",
        [CONVERSATION_FIELDS.CREATED_AT]: conversation.created_at ?? Date.now(),
    };

    if (conversation.customer_record_id) {
        fields[CONVERSATION_FIELDS.CUSTOMER] = [
            conversation.customer_record_id,
        ];
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
                field_name: CONVERSATION_FIELDS.EXTERNAL_MESSAGE_ID,
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