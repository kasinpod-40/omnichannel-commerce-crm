import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationQueueMessage } from "./notification-event.types";
import type { QueueBatchLike } from "./line-event.types";

const { sendNotificationByRecordId } = vi.hoisted(() => ({
    sendNotificationByRecordId: vi.fn(),
}));

vi.mock("../modules/notifications/notification.service", () => ({
    sendNotificationByRecordId,
}));

import { handleNotificationQueueBatch } from "./notification.consumer";

function createBatch() {
    const ack = vi.fn();
    const retry = vi.fn();
    const body: NotificationQueueMessage = {
        schema_version: 1,
        notification_record_id: "noti-001",
        event_id: "PAYMENT_REVIEW:rec-order-001",
        created_at: Date.now(),
    };

    const batch: QueueBatchLike<NotificationQueueMessage> = {
        queue: "crm-notifications",
        messages: [{
            id: "queue-noti-1",
            timestamp: new Date(),
            body,
            attempts: 1,
            ack,
            retry,
        }],
    };

    return { batch, ack, retry };
}

describe("notification queue error disposition", () => {
    beforeEach(() => vi.clearAllMocks());

    it("acknowledges permanent keyword mismatch without retrying", async () => {
        sendNotificationByRecordId.mockResolvedValue({
            ok: false,
            already_sent: false,
            retryable: false,
            error_code: "LARK_GROUP_WEBHOOK_KEYWORD_MISMATCH",
            error_message: "keyword mismatch (19024)",
        });
        const { batch, ack, retry } = createBatch();

        await handleNotificationQueueBatch(batch, {} as any);

        expect(ack).toHaveBeenCalledOnce();
        expect(retry).not.toHaveBeenCalled();
    });

    it("retries transient delivery failures", async () => {
        sendNotificationByRecordId.mockResolvedValue({
            ok: false,
            already_sent: false,
            retryable: true,
            error_code: "TRANSIENT_INTEGRATION_ERROR",
            error_message: "temporary network failure",
        });
        const { batch, ack, retry } = createBatch();

        await handleNotificationQueueBatch(batch, {} as any);

        expect(retry).toHaveBeenCalledOnce();
        expect(ack).not.toHaveBeenCalled();
    });
});
