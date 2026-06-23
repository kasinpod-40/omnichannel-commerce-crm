import type {
    ImageAnalysisOverride,
    ImageType,
} from "../../ai/image-ai.types";
import type { Env } from "../../config/env";
import type { MessageType } from "../../modules/conversations/conversation.types";
import { processIncomingMessage } from "../../usecases/process-incoming-message.usecase";
import { jsonResponse } from "../../utils/response";

function parseMessageType(
    value: string | null
): MessageType {
    return value === "image" ? "image" : "text";
}

function parseImageType(
    value: string | null
): ImageType | undefined {
    if (
        value === "product_image" ||
        value === "payment_slip" ||
        value === "other"
    ) {
        return value;
    }

    return undefined;
}

function parseOptionalNumber(
    value: string | null
): number | undefined {
    if (value === null || value.trim() === "") {
        return undefined;
    }

    const parsed = Number(
        value.replace(/,/g, "").trim()
    );

    return Number.isFinite(parsed)
        ? parsed
        : undefined;
}

function createImageAnalysisOverride(
    url: URL,
    slipAmount?: number,
    slipBank?: string
): ImageAnalysisOverride | undefined {
    const imageType = parseImageType(
        url.searchParams.get("image_type")
    );

    if (!imageType) {
        return undefined;
    }

    return {
        image_type: imageType,
        product_name:
            url.searchParams
                .get("image_product_name")
                ?.trim() || "",
        slip_amount: slipAmount ?? 0,
        slip_bank: slipBank ?? "",
        confidence:
            parseOptionalNumber(
                url.searchParams.get(
                    "image_confidence"
                )
            ) ?? 0.99,
        summary:
            url.searchParams
                .get("image_summary")
                ?.trim() || "",
    };
}

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
        undefined;

    const messageType = parseMessageType(
        url.searchParams.get("message_type")
    );

    const imageUrl =
        url.searchParams.get("image_url")?.trim() ||
        undefined;

    const slipAmount = parseOptionalNumber(
        url.searchParams.get("slip_amount")
    );

    const slipBank =
        url.searchParams.get("slip_bank")?.trim() ||
        undefined;

    const imageAnalysisOverride =
        createImageAnalysisOverride(
            url,
            slipAmount,
            slipBank
        );

    const result = await processIncomingMessage(env, {
        channel: "LINE",
        channel_customer_id: channelCustomerId,
        external_message_id: externalMessageId,
        message_type: messageType,
        message,
        customer_name: customerName,
        phone,
        image_url: imageUrl,
        slip_amount: slipAmount,
        slip_bank: slipBank,
        slip_image_url: imageUrl,
        image_analysis_override:
            imageAnalysisOverride,
    });

    return jsonResponse({
        ok: true,
        test_input: {
            channel: "LINE",
            channel_customer_id: channelCustomerId,
            external_message_id: externalMessageId,
            message_type: messageType,
            message,
            image_url: imageUrl ?? "",
            image_type_override:
                imageAnalysisOverride?.image_type ?? "",
            image_product_name:
                imageAnalysisOverride?.product_name ?? "",
            image_confidence:
                imageAnalysisOverride?.confidence ?? 0,
            slip_amount: slipAmount ?? 0,
            slip_bank: slipBank ?? "",
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
        channel_customer_id:
            "line_process_user_001",
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
