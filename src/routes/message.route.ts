import type { Env } from "../config/env";
import { processIncomingMessage } from "../usecases/process-incoming-message.usecase";
import { jsonResponse } from "../utils/response";

export async function handleProcessMessageTest(
    request: Request,
    env: Env
): Promise<Response> {
    const url = new URL(request.url);

    const message =
        url.searchParams.get("message")?.trim() ||
        "ขอดูสินค้าหน่อยครับ";

    const channelCustomerId =
        url.searchParams
            .get("channel_customer_id")
            ?.trim() || "line_process_user_001";

    const externalMessageId =
        url.searchParams
            .get("external_message_id")
            ?.trim() || `line_msg_${Date.now()}`;

    const customerName =
        url.searchParams
            .get("customer_name")
            ?.trim() || "Process Test User";

    const phone =
        url.searchParams.get("phone")?.trim() ||
        "0800000000";

    const result = await processIncomingMessage(env, {
        channel: "LINE",
        channel_customer_id: channelCustomerId,
        external_message_id: externalMessageId,
        message_type: "text",
        message,
        customer_name: customerName,
        phone,
    });

    return jsonResponse({
        ok: true,
        test_input: {
            channel: "LINE",
            channel_customer_id: channelCustomerId,
            external_message_id: externalMessageId,
            message,
        },
        result,
    });
}

export async function handleProcessLostTest(
    env: Env
): Promise<Response> {
    const now = Date.now();

    const result = await processIncomingMessage(env, {
        channel: "LINE",
        channel_customer_id: "line_process_user_001",
        external_message_id: `line_lost_${now}`,
        message_type: "text",
        message: "ไม่เอาแล้วครับ",
        customer_name: "Process Test User",
        phone: "0800000000",
    });

    return jsonResponse({
        ok: true,
        result,
    });
}