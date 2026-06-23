import type { Env } from "../config/env";
import { NOTIFICATION_FIELDS } from "../core/lark-fields";
import { markConversationFailedByExternalMessageId } from "../modules/conversations/conversation.service";
import {
    getNotificationByRecordId,
    updateNotificationDelivery,
} from "../modules/notifications/notification.repository";
import { getLarkNumber } from "../utils/lark-field-value";
import type {
    LineEventQueueMessage,
    QueueBatchLike,
} from "./line-event.types";
import type { NotificationQueueMessage } from "./notification-event.types";

export async function handleLineDlqBatch(
    batch: QueueBatchLike<LineEventQueueMessage>,
    env: Env
): Promise<void> {
    for (const message of batch.messages) {
        const lineMessageId = message.body?.message?.id ?? "";
        const errorMessage =
            `DLQ_EXHAUSTED: LINE event failed after ${message.attempts} attempts`;

        try {
            if (lineMessageId) {
                await markConversationFailedByExternalMessageId(
                    env,
                    lineMessageId,
                    errorMessage
                );
            }
        } catch (error) {
            console.error("LINE_DLQ_STATUS_UPDATE_FAILED", {
                queue_message_id: message.id,
                line_message_id: lineMessageId,
                error:
                    error instanceof Error
                        ? error.message
                        : String(error),
            });
        }

        console.error("LINE_EVENT_MOVED_TO_DLQ", {
            queue_message_id: message.id,
            attempts: message.attempts,
            line_message_id: lineMessageId,
            webhook_event_id:
                message.body?.webhook_event_id,
            user_id: message.body?.user_id,
        });

        message.ack();
    }
}

export async function handleNotificationDlqBatch(
    batch: QueueBatchLike<NotificationQueueMessage>,
    env: Env
): Promise<void> {
    for (const message of batch.messages) {
        const notificationRecordId =
            message.body?.notification_record_id ?? "";

        try {
            if (notificationRecordId) {
                const notification =
                    await getNotificationByRecordId(
                        env,
                        notificationRecordId
                    );

                if (notification) {
                    const attemptCount = Math.max(
                        message.attempts,
                        getLarkNumber(
                            notification.fields[
                                NOTIFICATION_FIELDS.ATTEMPT_COUNT
                            ],
                            0
                        )
                    );

                    await updateNotificationDelivery(
                        env,
                        notificationRecordId,
                        {
                            status: "Failed",
                            attempt_count: attemptCount,
                            error_message:
                                `DLQ_EXHAUSTED: notification failed after ${message.attempts} attempts`,
                        }
                    );
                }
            }
        } catch (error) {
            console.error(
                "NOTIFICATION_DLQ_STATUS_UPDATE_FAILED",
                {
                    queue_message_id: message.id,
                    notification_record_id:
                        notificationRecordId,
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error),
                }
            );
        }

        console.error("NOTIFICATION_MOVED_TO_DLQ", {
            queue_message_id: message.id,
            attempts: message.attempts,
            notification_record_id:
                notificationRecordId,
            event_id: message.body?.event_id,
        });

        message.ack();
    }
}
