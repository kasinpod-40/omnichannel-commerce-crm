import { analyzeImageBytes } from "../ai/image-ai.service";
import type { Env } from "../config/env";
import { markConversationFailedByExternalMessageId } from "../modules/conversations/conversation.service";
import { uploadLarkBitableImage } from "../providers/lark/lark-attachment.provider";
import {
    downloadExternalContent,
    downloadLineMessageContent,
    getLineUserProfile,
} from "../providers/line/line.provider";
import { processIncomingMessage } from "../usecases/process-incoming-message.usecase";
import type {
    LineEventQueueMessage,
    QueueBatchLike,
} from "./line-event.types";

function extensionFromMimeType(mimeType: string): string {
    const normalized = mimeType.toLowerCase();

    if (normalized.includes("png")) {
        return "png";
    }

    if (normalized.includes("webp")) {
        return "webp";
    }

    if (normalized.includes("gif")) {
        return "gif";
    }

    return "jpg";
}

function createFallbackCustomerName(userId: string): string {
    return `LINE User ${userId.slice(-6)}`;
}

function createCustomerNameResolver(
    env: Env,
    userId: string
): () => Promise<string> {
    let pending: Promise<string> | null = null;

    return async () => {
        if (!pending) {
            pending = (async () => {
                const profile = await getLineUserProfile(
                    env,
                    userId
                );

                return (
                    profile?.displayName?.trim() ||
                    createFallbackCustomerName(userId)
                );
            })();
        }

        return await pending;
    };
}

async function processTextEvent(
    env: Env,
    event: LineEventQueueMessage,
    customerNameResolver: () => Promise<string>
): Promise<void> {
    await processIncomingMessage(env, {
        channel: "LINE",
        channel_customer_id: event.user_id,
        external_message_id: event.message.id,
        message_type: "text",
        message: event.message.text ?? "",
        customer_name_resolver: customerNameResolver,
        phone: "",
        occurred_at: event.occurred_at,
        webhook_event_id: event.webhook_event_id,
        is_redelivery: event.is_redelivery,
    });
}

async function processStickerEvent(
    env: Env,
    event: LineEventQueueMessage,
    customerNameResolver: () => Promise<string>
): Promise<void> {
    const packageId = event.message.package_id ?? "";
    const stickerId = event.message.sticker_id ?? "";

    await processIncomingMessage(env, {
        channel: "LINE",
        channel_customer_id: event.user_id,
        external_message_id: event.message.id,
        message_type: "sticker",
        message:
            `LINE Sticker package=${packageId} sticker=${stickerId}`,
        customer_name_resolver: customerNameResolver,
        phone: "",
        occurred_at: event.occurred_at,
        webhook_event_id: event.webhook_event_id,
        is_redelivery: event.is_redelivery,
    });
}

async function processImageEvent(
    env: Env,
    event: LineEventQueueMessage,
    customerNameResolver: () => Promise<string>
): Promise<void> {
    const downloaded =
        event.message.content_provider_type === "external" &&
        event.message.original_content_url
            ? await downloadExternalContent(
                  event.message.original_content_url
              )
            : await downloadLineMessageContent(
                  env,
                  event.message.id
              );

    if (!downloaded.mime_type.startsWith("image/")) {
        throw new Error(
            `LINE message is not an image: ${downloaded.mime_type}`
        );
    }

    const extension = extensionFromMimeType(
        downloaded.mime_type
    );
    const fileName =
        `line-${event.message.id}.${extension}`;

    const [imageAnalysis, attachmentToken] =
        await Promise.all([
            analyzeImageBytes(
                env,
                downloaded.bytes,
                downloaded.mime_type,
                `line-message://${event.message.id}`
            ),
            uploadLarkBitableImage(env, {
                file_name: fileName,
                mime_type: downloaded.mime_type,
                bytes: downloaded.bytes,
            }),
        ]);

    const attachmentTokens = [attachmentToken];
    const isPaymentSlip =
        imageAnalysis.image_type === "payment_slip";

    await processIncomingMessage(env, {
        channel: "LINE",
        channel_customer_id: event.user_id,
        external_message_id: event.message.id,
        message_type: "image",
        message: imageAnalysis.summary || "ลูกค้าส่งรูปภาพ",
        customer_name_resolver: customerNameResolver,
        phone: "",
        image_url: "",
        image_attachment_tokens: attachmentTokens,
        slip_amount: isPaymentSlip
            ? imageAnalysis.slip_amount
            : undefined,
        slip_bank: isPaymentSlip
            ? imageAnalysis.slip_bank
            : undefined,
        slip_image_url: "",
        slip_attachment_tokens: isPaymentSlip
            ? attachmentTokens
            : undefined,
        image_analysis_result: imageAnalysis,
        occurred_at: event.occurred_at,
        webhook_event_id: event.webhook_event_id,
        is_redelivery: event.is_redelivery,
    });
}

export async function processLineQueueEvent(
    env: Env,
    event: LineEventQueueMessage
): Promise<void> {
    const customerNameResolver =
        createCustomerNameResolver(
            env,
            event.user_id
        );

    if (event.message.type === "text") {
        await processTextEvent(
            env,
            event,
            customerNameResolver
        );
        return;
    }

    if (event.message.type === "sticker") {
        await processStickerEvent(
            env,
            event,
            customerNameResolver
        );
        return;
    }

    await processImageEvent(
        env,
        event,
        customerNameResolver
    );
}

export async function handleLineQueueBatch(
    batch: QueueBatchLike<LineEventQueueMessage>,
    env: Env
): Promise<void> {
    for (const message of batch.messages) {
        try {
            await processLineQueueEvent(
                env,
                message.body
            );
            message.ack();
        } catch (error) {
            try {
                await markConversationFailedByExternalMessageId(
                    env,
                    message.body.message.id,
                    error
                );
            } catch (statusError) {
                console.warn(
                    "LINE_QUEUE_MARK_FAILED_SKIPPED",
                    statusError instanceof Error
                        ? statusError.message
                        : String(statusError)
                );
            }

            console.error(
                "LINE_QUEUE_PROCESSING_FAILED",
                {
                    queue_message_id: message.id,
                    attempts: message.attempts,
                    line_message_id:
                        message.body?.message?.id,
                    webhook_event_id:
                        message.body?.webhook_event_id,
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error),
                }
            );

            message.retry({
                delaySeconds: Math.min(
                    30 * Math.max(message.attempts, 1),
                    300
                ),
            });
        }
    }
}
