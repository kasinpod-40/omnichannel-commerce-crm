import type { Env } from "../../config/env";
import {
    createConversation,
    findConversationByExternalMessageId,
} from "./conversation.repository";
import type { Conversation } from "./conversation.types";

export async function isDuplicateMessage(
    env: Env,
    externalMessageId: string
): Promise<boolean> {
    const existingConversation = await findConversationByExternalMessageId(
        env,
        externalMessageId
    );

    return !!existingConversation;
}

export async function saveConversation(
    env: Env,
    conversation: Conversation
): Promise<{
    duplicate: boolean;
    result?: unknown;
}> {
    const duplicate = await isDuplicateMessage(
        env,
        conversation.external_message_id
    );

    if (duplicate) {
        return {
            duplicate: true,
        };
    }

    const result = await createConversation(env, conversation);

    return {
        duplicate: false,
        result,
    };
}