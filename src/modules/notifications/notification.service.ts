import type { Env } from "../../config/env";
import {
    createNotification,
    findNotificationByEventId,
    type LarkNotificationRecord,
} from "./notification.repository";
import type { Notification } from "./notification.types";

export type RecordNotificationResult = {
    duplicate: boolean;
    record: LarkNotificationRecord;
};

export async function recordNotificationOnce(
    env: Env,
    notification: Notification
): Promise<RecordNotificationResult> {
    const normalizedEventId =
        notification.event_id.trim();

    if (!normalizedEventId) {
        throw new Error(
            "Notification event_id is required"
        );
    }

    const existing =
        await findNotificationByEventId(
            env,
            normalizedEventId
        );

    if (existing) {
        return {
            duplicate: true,
            record: existing,
        };
    }

    const created = await createNotification(
        env,
        {
            ...notification,
            event_id: normalizedEventId,
            message: notification.message.trim(),
            status:
                notification.status ?? "Pending",
        }
    );

    return {
        duplicate: false,
        record: created,
    };
}
