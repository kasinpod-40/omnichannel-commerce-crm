import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperationalError } from "../utils/errors";
import type { LineEventQueueMessage, QueueBatchLike } from "./line-event.types";

const { processIncomingMessage, markConversationFailed } = vi.hoisted(
    () => ({
        processIncomingMessage: vi.fn(),
        markConversationFailed: vi.fn(),
    })
);

vi.mock("../usecases/process-incoming-message.usecase", () => ({
    processIncomingMessage,
}));

vi.mock("../modules/conversations/conversation.service", () => ({
    markConversationFailedByExternalMessageId:
        markConversationFailed,
}));

import { handleLineQueueBatch } from "./line-event.consumer";

function createBatch() {
    const ack = vi.fn();
    const retry = vi.fn();
    const body: LineEventQueueMessage = {
        schema_version: 1,
        channel: "LINE",
        webhook_event_id: "webhook-1",
        destination: "destination",
        is_redelivery: false,
        occurred_at: Date.now(),
        source_type: "user",
        user_id: "user-1",
        message: {
            id: "message-1",
            type: "text",
            text: "hello",
        },
    };

    const batch: QueueBatchLike<LineEventQueueMessage> = {
        queue: "crm-line-events",
        messages: [
            {
                id: "queue-1",
                timestamp: new Date(),
                body,
                attempts: 1,
                ack,
                retry,
            },
        ],
    };

    return { batch, ack, retry };
}

describe("LINE queue error disposition", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        markConversationFailed.mockResolvedValue(null);
    });

    it("retries transient failures", async () => {
        processIncomingMessage.mockRejectedValue(
            new OperationalError(
                "GEMINI_503",
                "Gemini failed: 503 UNAVAILABLE",
                { retryable: true, status: 503 }
            )
        );
        const { batch, ack, retry } = createBatch();

        await handleLineQueueBatch(batch, {} as any);

        expect(retry).toHaveBeenCalledOnce();
        expect(ack).not.toHaveBeenCalled();
    });

    it("acks permanent data invariant failures without retrying", async () => {
        processIncomingMessage.mockRejectedValue(
            new Error("PIPELINE_INVARIANT_MULTIPLE_OPEN")
        );
        const { batch, ack, retry } = createBatch();

        await handleLineQueueBatch(batch, {} as any);

        expect(ack).toHaveBeenCalledOnce();
        expect(retry).not.toHaveBeenCalled();
    });
    it("retries an injected transient failure before business processing", async () => {
        const { batch, ack, retry } = createBatch();
        batch.messages[0].body.test_failure_mode = "transient";
        batch.messages[0].body.test_fail_until_attempt = 2;

        await handleLineQueueBatch(batch, {} as any);

        expect(retry).toHaveBeenCalledOnce();
        expect(ack).not.toHaveBeenCalled();
        expect(processIncomingMessage).not.toHaveBeenCalled();
    });

});
