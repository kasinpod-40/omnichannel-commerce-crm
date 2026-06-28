import type { Env } from "../config/env";
import { sendNotificationByRecordId } from "../modules/notifications/notification.service";
import type { QueueBatchLike } from "./line-event.types";
import type { NotificationQueueMessage } from "./notification-event.types";
import { classifyOperationalError } from "../utils/errors";

export async function handleNotificationQueueBatch(
    batch: QueueBatchLike<NotificationQueueMessage>,
    env: Env
): Promise<void> {
    for (const message of batch.messages) {
        try {
            const result = await sendNotificationByRecordId(
                env,
                message.body.notification_record_id
            );

            if (!result.ok && !result.already_sent) {
                if (result.retryable === false) {
                    console.error("NOTIFICATION_QUEUE_PERMANENT_FAILURE", {
                        queue_message_id: message.id,
                        attempts: message.attempts,
                        notification_record_id: message.body?.notification_record_id,
                        event_id: message.body?.event_id,
                        code: result.error_code ?? "PERMANENT_NOTIFICATION_DELIVERY_ERROR",
                        retryable: false,
                        error: result.error_message,
                    });
                    message.ack();
                    continue;
                }

                throw new Error(
                    result.error_message ||
                        `Notification delivery failed: ${message.body.notification_record_id}`
                );
            }

            message.ack();
        } catch (error) {
            const classification =
                classifyOperationalError(error);

            console.error(
                classification.retryable
                    ? "NOTIFICATION_QUEUE_TRANSIENT_FAILURE"
                    : "NOTIFICATION_QUEUE_PERMANENT_FAILURE",
                {
                    queue_message_id: message.id,
                    attempts: message.attempts,
                    notification_record_id:
                        message.body?.notification_record_id,
                    event_id: message.body?.event_id,
                    code: classification.code,
                    retryable: classification.retryable,
                    status: classification.status,
                    error: classification.message,
                }
            );

            if (!classification.retryable) {
                message.ack();
                continue;
            }

            message.retry({
                delaySeconds: Math.min(
                    60 * Math.max(message.attempts, 1),
                    300
                ),
            });
        }
    }
}
