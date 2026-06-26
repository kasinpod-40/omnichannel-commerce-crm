import type { Env } from "../../config/env";
import { CONVERSATION_FIELDS } from "../../core/lark-fields";
import {
    createLarkRecord,
    listLarkRecords,
    searchLarkRecords,
    updateLarkRecord,
} from "../../providers/lark/lark.provider";
import { toLarkAttachmentFieldValue } from "../../providers/lark/lark-attachment.provider";
import type {
    Conversation,
    ProcessStatus,
} from "./conversation.types";

export type LarkConversationRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

function normalizeConversationRecord(
    result: unknown
): LarkConversationRecord {
    const data = result as {
        record?: LarkConversationRecord;
        record_id?: string;
        id?: string;
        fields?: Record<string, unknown>;
    };

    if (data.record?.record_id) {
        return data.record;
    }

    const recordId = data.record_id ?? data.id;

    if (recordId) {
        return {
            record_id: recordId,
            fields: data.fields ?? {},
        };
    }

    throw new Error(
        `Invalid Lark conversation record: ${JSON.stringify(result)}`
    );
}

function buildConversationFields(
    conversation: Conversation
): Record<string, unknown> {
    const fields: Record<string, unknown> = {
        [CONVERSATION_FIELDS.CHANNEL]: conversation.channel,
        [CONVERSATION_FIELDS.EXTERNAL_MESSAGE_ID]:
            conversation.external_message_id,
        [CONVERSATION_FIELDS.MESSAGE_TYPE]:
            conversation.message_type,
        [CONVERSATION_FIELDS.MESSAGE]: conversation.message,
        [CONVERSATION_FIELDS.INTENT]: conversation.intent,
        [CONVERSATION_FIELDS.BUYER_INTENT]:
            conversation.buyer_intent,
        [CONVERSATION_FIELDS.LEAD_SCORE]:
            conversation.lead_score,
        [CONVERSATION_FIELDS.HOT_LEAD]:
            conversation.hot_lead,
        [CONVERSATION_FIELDS.AI_SUMMARY]:
            conversation.ai_summary ?? "",
        [CONVERSATION_FIELDS.PROCESS_STATUS]:
            conversation.process_status,
        [CONVERSATION_FIELDS.ERROR_MESSAGE]:
            conversation.error_message ?? "",
        [CONVERSATION_FIELDS.CREATED_AT]:
            conversation.created_at ?? Date.now(),
    };

    const imageUrl = conversation.image_url?.trim();

    if (imageUrl) {
        fields[CONVERSATION_FIELDS.IMAGE_URL] = {
            link: imageUrl,
            text: "Open image",
        };
    }

    if (conversation.image_type) {
        fields[CONVERSATION_FIELDS.IMAGE_TYPE] =
            conversation.image_type;
    }

    if (
        conversation.image_attachment_tokens &&
        conversation.image_attachment_tokens.length > 0
    ) {
        fields[CONVERSATION_FIELDS.IMAGE_ATTACHMENT] =
            toLarkAttachmentFieldValue(
                conversation.image_attachment_tokens
            );
    }

    if (conversation.customer_record_id) {
        fields[CONVERSATION_FIELDS.CUSTOMER] = [
            conversation.customer_record_id,
        ];
    }

    return fields;
}

export async function createConversation(
    env: Env,
    conversation: Conversation
): Promise<LarkConversationRecord> {
    const result = await createLarkRecord(
        env,
        env.CONVERSATIONS_TABLE_ID,
        buildConversationFields(conversation)
    );

    return normalizeConversationRecord(result);
}

export async function updateConversation(
    env: Env,
    recordId: string,
    conversation: Conversation
): Promise<LarkConversationRecord> {
    const result = await updateLarkRecord(
        env,
        env.CONVERSATIONS_TABLE_ID,
        recordId,
        buildConversationFields(conversation)
    );

    return normalizeConversationRecord(result);
}

export async function updateConversationProcessStatus(
    env: Env,
    recordId: string,
    status: ProcessStatus,
    errorMessage = ""
): Promise<LarkConversationRecord> {
    const result = await updateLarkRecord(
        env,
        env.CONVERSATIONS_TABLE_ID,
        recordId,
        {
            [CONVERSATION_FIELDS.PROCESS_STATUS]: status,
            [CONVERSATION_FIELDS.ERROR_MESSAGE]: errorMessage,
        }
    );

    return normalizeConversationRecord(result);
}


export async function updateConversationCustomer(
    env: Env,
    recordId: string,
    customerRecordId: string
): Promise<LarkConversationRecord> {
    const result = await updateLarkRecord(
        env,
        env.CONVERSATIONS_TABLE_ID,
        recordId,
        {
            [CONVERSATION_FIELDS.CUSTOMER]: customerRecordId
                ? [customerRecordId]
                : [],
        }
    );

    return normalizeConversationRecord(result);
}

export async function findConversationByExternalMessageId(
    env: Env,
    externalMessageId: string
): Promise<LarkConversationRecord | null> {
    const records = await searchLarkRecords(
        env,
        env.CONVERSATIONS_TABLE_ID,
        {
            conjunction: "and",
            conditions: [
                {
                    field_name:
                        CONVERSATION_FIELDS.EXTERNAL_MESSAGE_ID,
                    operator: "is",
                    value: [externalMessageId],
                },
            ],
        }
    );

    if (records.length === 0) {
        return null;
    }

    return normalizeConversationRecord(records[0]);
}

/** ดึง Conversation ทั้งหมดสำหรับ Dashboard read model และ Customer timeline */
export async function listConversations(
    env: Env
): Promise<LarkConversationRecord[]> {
    const records = await listLarkRecords(
        env,
        env.CONVERSATIONS_TABLE_ID
    );

    return records.map(normalizeConversationRecord);
}
