import type { Env } from "../config/env";
import { processIncomingMessage } from "../usecases/process-incoming-message.usecase";
import { jsonResponse } from "../utils/response";

export async function handleProcessMessageTest(env: Env): Promise<Response> {
    const now = Date.now();

    const result = await processIncomingMessage(env, {
        channel: "LINE",
        channel_customer_id: "line_process_user_001",
        external_message_id: `line_msg_${now}`,
        message_type: "text",
        message: "เอา 10 ตัวครับ",
        customer_name: "Process Test User",
        phone: "0800000000",
    });

    return jsonResponse({
        ok: true,
        result,
    });
}