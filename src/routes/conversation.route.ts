import type { Env } from "../config/env";
import { saveConversation } from "../modules/conversations/conversation.service";
import { jsonResponse } from "../utils/response";

export async function handleConversationTest(env: Env): Promise<Response> {
    const result = await saveConversation(env, {
        channel: "LINE",
        external_message_id: "line_message_test_001",
        message_type: "text",
        message: "ทดสอบบันทึก conversation จาก Worker",
        intent: "unknown",
        lead_score: 0,
        hot_lead: false,
        ai_summary: "Conversation test record",
        process_status: "synced",
    });

    return jsonResponse({
        ok: true,
        message: result.duplicate
            ? "Duplicate message skipped"
            : "Conversation created",
        duplicate: result.duplicate,
        result: result.result ?? null,
    });
}