import type { Env } from "../config/env";
import {
    handleLineDlqBatch,
    handleNotificationDlqBatch,
} from "../queues/dead-letter.consumer";
import { handleLineQueueBatch } from "../queues/line-event.consumer";
import type {
    LineEventQueueMessage,
    QueueBatchLike,
} from "../queues/line-event.types";
import { handleNotificationQueueBatch } from "../queues/notification.consumer";
import type { NotificationQueueMessage } from "../queues/notification-event.types";

export async function handleQueueEvent(
    batch: QueueBatchLike<unknown>,
    env: Env
): Promise<void> {
    if (batch.queue === "crm-line-events-dlq") {
        await handleLineDlqBatch(
            batch as QueueBatchLike<LineEventQueueMessage>,
            env
        );
        return;
    }

    if (batch.queue === "crm-notifications-dlq") {
        await handleNotificationDlqBatch(
            batch as QueueBatchLike<NotificationQueueMessage>,
            env
        );
        return;
    }

    if (batch.queue === "crm-notifications") {
        await handleNotificationQueueBatch(
            batch as QueueBatchLike<NotificationQueueMessage>,
            env
        );
        return;
    }

    await handleLineQueueBatch(
        batch as QueueBatchLike<LineEventQueueMessage>,
        env
    );
}
