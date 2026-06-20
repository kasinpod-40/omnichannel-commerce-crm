import type { Env } from "../../config/env";
import { NOTIFICATION_FIELDS } from "../../core/lark-fields";
import {
    createLarkRecord,
    getLarkRecord,
    searchLarkRecords,
    updateLarkRecord,
} from "../../providers/lark/lark.provider";
import type {
    Notification,
    NotificationDeliveryUpdate,
} from "./notification.types";

export type LarkNotificationRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

function normalizeNotificationRecord(
    result: unknown
): LarkNotificationRecord {
    const data = result as {
        record?: LarkNotificationRecord;
        record_id?: string;
        id?: string;
        fields?: Record<string, unknown>;
    };

    if (data.record?.record_id) {
        return data.record;
    }

    const recordId = data.record_id ?? data.id;

    if (recordId) {
        return {
            record_id: recordId,
            fields: data.fields ?? {},
        };
    }

    throw new Error(
        `Invalid Lark notification record: ${JSON.stringify(result)}`
    );
}

export async function findNotificationByEventId(
    env: Env,
    eventId: string
): Promise<LarkNotificationRecord | null> {
    const records = await searchLarkRecords(
        env,
        env.NOTIFICATIONS_TABLE_ID,
        {
            conjunction: "and",
            conditions: [
                {
                    field_name:
                        NOTIFICATION_FIELDS.EVENT_ID,
                    operator: "is",
                    value: [eventId],
                },
            ],
        }
    );

    if (records.length === 0) {
        return null;
    }

    return normalizeNotificationRecord(records[0]);
}

export async function createNotification(
    env: Env,
    notification: Notification
): Promise<LarkNotificationRecord> {
    const fields: Record<string, unknown> = {
        [NOTIFICATION_FIELDS.EVENT_ID]:
            notification.event_id,

        [NOTIFICATION_FIELDS.NOTIFICATION_TYPE]:
            notification.notification_type,

        [NOTIFICATION_FIELDS.CUSTOMER]: [
            notification.customer_record_id,
        ],

        [NOTIFICATION_FIELDS.MESSAGE]:
            notification.message,

        [NOTIFICATION_FIELDS.PAYLOAD_JSON]:
            notification.payload
                ? JSON.stringify(notification.payload)
                : "",

        [NOTIFICATION_FIELDS.STATUS]:
            notification.status ?? "Pending",

        [NOTIFICATION_FIELDS.ATTEMPT_COUNT]: 0,

        [NOTIFICATION_FIELDS.ERROR_MESSAGE]: "",

        [NOTIFICATION_FIELDS.CREATED_AT]:
            notification.created_at ?? Date.now(),
    };

    const result = await createLarkRecord(
        env,
        env.NOTIFICATIONS_TABLE_ID,
        fields
    );

    return normalizeNotificationRecord(result);
}

export async function getNotificationByRecordId(
    env: Env,
    recordId: string
): Promise<LarkNotificationRecord | null> {
    const result = await getLarkRecord(
        env,
        env.NOTIFICATIONS_TABLE_ID,
        recordId
    );

    if (!result) {
        return null;
    }

    return normalizeNotificationRecord(result);
}

export async function findPendingNotifications(
    env: Env,
    limit = 10
): Promise<LarkNotificationRecord[]> {
    const safeLimit = Math.min(
        Math.max(Math.trunc(limit), 1),
        20
    );

    const records = await searchLarkRecords(
        env,
        env.NOTIFICATIONS_TABLE_ID,
        {
            conjunction: "and",
            conditions: [
                {
                    field_name:
                        NOTIFICATION_FIELDS.STATUS,
                    operator: "is",
                    value: ["Pending"],
                },
            ],
        }
    );

    return records
        .slice(0, safeLimit)
        .map(normalizeNotificationRecord);
}

export async function updateNotificationDelivery(
    env: Env,
    recordId: string,
    input: NotificationDeliveryUpdate
): Promise<LarkNotificationRecord> {
    const fields: Record<string, unknown> = {
        [NOTIFICATION_FIELDS.STATUS]: input.status,
        [NOTIFICATION_FIELDS.ATTEMPT_COUNT]:
            input.attempt_count,
        [NOTIFICATION_FIELDS.ERROR_MESSAGE]:
            input.error_message ?? "",
    };

    if (input.status === "Sent") {
        fields[NOTIFICATION_FIELDS.SENT_AT] =
            input.sent_at ?? Date.now();
    }

    const result = await updateLarkRecord(
        env,
        env.NOTIFICATIONS_TABLE_ID,
        recordId,
        fields
    );

    return normalizeNotificationRecord(result);
}
