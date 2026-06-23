import type { Env } from "../config/env";
import type { NotificationQueueMessage } from "./notification-event.types";

export async function enqueueNotificationDelivery(
    env: Env,
    message: NotificationQueueMessage
): Promise<void> {
    await env.NOTIFICATION_QUEUE.send(message, {
        contentType: "json",
    });
}
