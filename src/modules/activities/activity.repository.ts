import type { Env } from "../../config/env";
import { ACTIVITY_FIELDS } from "../../core/lark-fields";
import {
    createLarkRecord,
    searchLarkRecords,
    listLarkRecords,
} from "../../providers/lark/lark.provider";
import type { Activity } from "./activity.types";

export type LarkActivityRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

function normalizeActivityRecord(
    result: unknown
): LarkActivityRecord {
    const data = result as {
        record?: LarkActivityRecord;
        record_id?: string;
        id?: string;
        fields?: Record<string, unknown>;
    };

    if (data.record?.record_id) {
        return data.record;
    }

    const recordId =
        data.record_id ?? data.id;

    if (recordId) {
        return {
            record_id: recordId,
            fields: data.fields ?? {},
        };
    }

    throw new Error(
        `Invalid Lark activity record: ${JSON.stringify(result)}`
    );
}

export async function findActivityByEventId(
    env: Env,
    eventId: string
): Promise<LarkActivityRecord | null> {
    const records = await searchLarkRecords(
        env,
        env.ACTIVITIES_TABLE_ID,
        {
            conjunction: "and",
            conditions: [
                {
                    field_name: ACTIVITY_FIELDS.EVENT_ID,
                    operator: "is",
                    value: [eventId],
                },
            ],
        }
    );

    if (records.length === 0) {
        return null;
    }

    return normalizeActivityRecord(records[0]);
}

export async function createActivity(
    env: Env,
    activity: Activity & {
        old_value_text: string;
        new_value_text: string;
    }
): Promise<LarkActivityRecord> {
    const fields: Record<string, unknown> = {
        [ACTIVITY_FIELDS.EVENT_ID]:
            activity.event_id,

        [ACTIVITY_FIELDS.ACTION]:
            activity.action,

        [ACTIVITY_FIELDS.OLD_VALUE]:
            activity.old_value_text,

        [ACTIVITY_FIELDS.NEW_VALUE]:
            activity.new_value_text,

        [ACTIVITY_FIELDS.CREATED_AT]:
            activity.created_at ?? Date.now(),
    };


    // เอกสาร Marketplace/ข้อมูลเก่าอาจไม่มี Customer link แต่ Audit ยังต้องบันทึกได้
    if (activity.customer_record_id?.trim()) {
        fields[ACTIVITY_FIELDS.CUSTOMER] = [activity.customer_record_id.trim()];
    }

    const result = await createLarkRecord(
        env,
        env.ACTIVITIES_TABLE_ID,
        fields
    );

    return normalizeActivityRecord(result);
}

/** ดึง Activity ทั้งหมดสำหรับหน้า Dashboard และรายงานภายใน */
export async function listActivities(
    env: Env
): Promise<LarkActivityRecord[]> {
    const records = await listLarkRecords(
        env,
        env.ACTIVITIES_TABLE_ID
    );

    return records.map(normalizeActivityRecord);
}
