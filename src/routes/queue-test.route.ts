import type { Env } from "../config/env";
import type { LineEventQueueMessage } from "../queues/line-event.types";
import { jsonResponse } from "../utils/response";

function isAuthorized(request: Request, env: Env): boolean {
    const configured =
        env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "";
    const authorization =
        request.headers.get("Authorization") ?? "";
    const bearer = /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : "";

    return Boolean(configured) && bearer === configured;
}

export async function handleQueueFailureTest(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse(
            { ok: false, message: "Method not allowed" },
            405
        );
    }

    if (!isAuthorized(request, env)) {
        return jsonResponse(
            { ok: false, message: "Unauthorized" },
            401
        );
    }

    let body: Record<string, unknown> = {};

    try {
        const parsed = await request.json();
        body =
            parsed && typeof parsed === "object"
                ? (parsed as Record<string, unknown>)
                : {};
    } catch {
        return jsonResponse(
            { ok: false, message: "Invalid JSON" },
            400
        );
    }

    const mode = body.mode;

    if (mode !== "transient" && mode !== "permanent") {
        return jsonResponse(
            {
                ok: false,
                message:
                    "mode ต้องเป็น transient หรือ permanent",
            },
            400
        );
    }

    const failUntilAttempt = Math.max(
        0,
        Math.trunc(Number(body.fail_until_attempt) || 0)
    );
    const id = crypto.randomUUID();
    const userId =
        typeof body.user_id === "string" &&
        body.user_id.trim()
            ? body.user_id.trim()
            : `queue-test-${id.slice(0, 8)}`;
    const event: LineEventQueueMessage = {
        schema_version: 1,
        channel: "LINE",
        webhook_event_id: `queue-test:${id}`,
        destination: "queue-test",
        is_redelivery: false,
        occurred_at: Date.now(),
        source_type: "user",
        user_id: userId,
        test_failure_mode: mode,
        test_fail_until_attempt: failUntilAttempt,
        message: {
            id: `queue-test-message:${id}`,
            type: "text",
            text: "ทดสอบ Queue Retry",
        },
    };

    await env.LINE_EVENTS_QUEUE.send(event, {
        contentType: "json",
    });

    return jsonResponse({
        ok: true,
        event: {
            webhook_event_id: event.webhook_event_id,
            external_message_id: event.message.id,
            user_id: userId,
            mode,
            fail_until_attempt: failUntilAttempt,
        },
    });
}
