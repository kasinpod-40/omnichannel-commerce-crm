import type { Env } from "../config/env";
import {
    verifyLineWebhookSignature,
} from "../providers/line/line.provider";
import type {
    LineEventQueueMessage,
    LineQueueMessageType,
    LineSourceType,
} from "../queues/line-event.types";
import { enqueueLineEvent } from "../queues/producer";
import { jsonResponse } from "../utils/response";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function getString(
    value: unknown,
    fallback = ""
): string {
    return typeof value === "string"
        ? value
        : fallback;
}

function getNumber(
    value: unknown,
    fallback = 0
): number {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : fallback;
}

function parseSupportedMessageEvent(
    destination: string,
    event: unknown
): LineEventQueueMessage | null {
    if (!isRecord(event) || event.type !== "message") {
        return null;
    }

    const source = event.source;
    const message = event.message;

    if (!isRecord(source) || !isRecord(message)) {
        return null;
    }

    const userId = getString(source.userId).trim();
    const messageId = getString(message.id).trim();
    const sourceType = getString(source.type) as LineSourceType;
    const messageType = getString(
        message.type
    ) as LineQueueMessageType;

    if (
        !userId ||
        !messageId ||
        sourceType !== "user" ||
        !["text", "image", "sticker"].includes(messageType)
    ) {
        return null;
    }

    const deliveryContext = isRecord(
        event.deliveryContext
    )
        ? event.deliveryContext
        : {};
    const contentProvider = isRecord(
        message.contentProvider
    )
        ? message.contentProvider
        : {};

    return {
        schema_version: 1,
        channel: "LINE",
        webhook_event_id:
            getString(event.webhookEventId).trim() ||
            `line-webhook-${messageId}`,
        destination,
        is_redelivery:
            deliveryContext.isRedelivery === true,
        occurred_at: getNumber(
            event.timestamp,
            Date.now()
        ),
        source_type: sourceType,
        user_id: userId,
        group_id:
            getString(source.groupId).trim() ||
            undefined,
        room_id:
            getString(source.roomId).trim() ||
            undefined,
        message: {
            id: messageId,
            type: messageType,
            text:
                getString(message.text).trim() ||
                undefined,
            package_id:
                getString(message.packageId).trim() ||
                undefined,
            sticker_id:
                getString(message.stickerId).trim() ||
                undefined,
            content_provider_type:
                contentProvider.type === "external"
                    ? "external"
                    : "line",
            original_content_url:
                getString(
                    contentProvider.originalContentUrl
                ).trim() || undefined,
        },
    };
}

export async function handleLineWebhook(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse(
            {
                ok: false,
                message: "Method not allowed",
            },
            405
        );
    }

    const rawBody = await request.text();
    const signature =
        request.headers.get("x-line-signature") ?? "";

    const signatureValid =
        await verifyLineWebhookSignature(
            rawBody,
            signature,
            env.LINE_CHANNEL_SECRET
        );

    if (!signatureValid) {
        console.warn("LINE_WEBHOOK_SIGNATURE_INVALID");
        return jsonResponse(
            {
                ok: false,
                message: "Invalid LINE signature",
            },
            401
        );
    }

    let body: unknown;

    try {
        body = JSON.parse(rawBody);
    } catch {
        return jsonResponse(
            {
                ok: false,
                message: "Invalid JSON",
            },
            400
        );
    }

    if (!isRecord(body)) {
        return jsonResponse(
            {
                ok: false,
                message: "Invalid webhook body",
            },
            400
        );
    }

    const destination = getString(body.destination).trim();
    const events = Array.isArray(body.events)
        ? body.events
        : [];
    const queueMessages = events
        .map((event) =>
            parseSupportedMessageEvent(
                destination,
                event
            )
        )
        .filter(
            (
                event
            ): event is LineEventQueueMessage =>
                event !== null
        );

    try {
        for (const event of queueMessages) {
            await enqueueLineEvent(env, event);
        }
    } catch (error) {
        console.error(
            "LINE_WEBHOOK_QUEUE_SEND_FAILED",
            error instanceof Error
                ? error.message
                : String(error)
        );

        // Non-2xx lets LINE retry the webhook when redelivery is enabled.
        return jsonResponse(
            {
                ok: false,
                message: "Queue unavailable",
            },
            503
        );
    }

    return jsonResponse({
        ok: true,
        received_events: events.length,
        enqueued_events: queueMessages.length,
    });
}
