import type { Env } from "../../config/env";
import { NOTIFICATION_FIELDS } from "../../core/lark-fields";
import {
    createLarkRecord,
    searchLarkRecords,
} from "../../providers/lark/lark.provider";
import type { Notification } from "./notification.types";

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

        [NOTIFICATION_FIELDS.STATUS]:
            notification.status ?? "Pending",

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
