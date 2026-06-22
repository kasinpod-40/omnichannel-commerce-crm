import type { Env } from "../../config/env";
import { CONVERSATION_FIELDS } from "../../core/lark-fields";
import { getLarkText } from "../../utils/lark-field-value";
import {
    createConversation,
    findConversationByExternalMessageId,
    updateConversation,
    updateConversationCustomer,
    updateConversationProcessStatus,
    type LarkConversationRecord,
} from "./conversation.repository";
import type {
    Conversation,
    ProcessStatus,
} from "./conversation.types";

export type SaveConversationResult = {
    duplicate: boolean;
    resumed: boolean;
    result: LarkConversationRecord;
};

export function getConversationProcessStatus(
    conversation: LarkConversationRecord
): ProcessStatus {
    const status = getLarkText(
        conversation.fields[CONVERSATION_FIELDS.PROCESS_STATUS],
        "processing"
    ).trim();

    if (status === "synced" || status === "failed") {
        return status;
    }

    return "processing";
}

export async function isDuplicateMessage(
    env: Env,
    externalMessageId: string
): Promise<boolean> {
    const existingConversation =
        await findConversationByExternalMessageId(
            env,
            externalMessageId
        );

    return (
        existingConversation !== null &&
        getConversationProcessStatus(existingConversation) === "synced"
    );
}

export async function saveConversation(
    env: Env,
    conversation: Conversation,
    existingConversation?: LarkConversationRecord | null
): Promise<SaveConversationResult> {
    const existing =
        existingConversation === undefined
            ? await findConversationByExternalMessageId(
                  env,
                  conversation.external_message_id
              )
            : existingConversation;

    if (
        existing &&
        getConversationProcessStatus(existing) === "synced"
    ) {
        return {
            duplicate: true,
            resumed: false,
            result: existing,
        };
    }

    if (existing) {
        const updated = await updateConversation(
            env,
            existing.record_id,
            {
                ...conversation,
                process_status: "processing",
                error_message: "",
            }
        );

        return {
            duplicate: false,
            resumed: true,
            result: updated,
        };
    }

    const created = await createConversation(env, {
        ...conversation,
        process_status: "processing",
        error_message: "",
    });

    return {
        duplicate: false,
        resumed: false,
        result: created,
    };
}

export async function markConversationSynced(
    env: Env,
    recordId: string
): Promise<LarkConversationRecord> {
    return await updateConversationProcessStatus(
        env,
        recordId,
        "synced",
        ""
    );
}

export async function markConversationFailed(
    env: Env,
    recordId: string,
    error: unknown
): Promise<LarkConversationRecord> {
    const errorMessage =
        error instanceof Error
            ? error.message
            : String(error);

    return await updateConversationProcessStatus(
        env,
        recordId,
        "failed",
        errorMessage.slice(0, 1000)
    );
}

export async function markConversationFailedByExternalMessageId(
    env: Env,
    externalMessageId: string,
    error: unknown
): Promise<LarkConversationRecord | null> {
    const existing =
        await findConversationByExternalMessageId(
            env,
            externalMessageId
        );

    if (!existing) {
        return null;
    }

    if (getConversationProcessStatus(existing) === "synced") {
        return existing;
    }

    return await markConversationFailed(
        env,
        existing.record_id,
        error
    );
}

export async function linkConversationToCustomer(
    env: Env,
    recordId: string,
    customerRecordId: string
): Promise<LarkConversationRecord> {
    return await updateConversationCustomer(
        env,
        recordId,
        customerRecordId
    );
}
