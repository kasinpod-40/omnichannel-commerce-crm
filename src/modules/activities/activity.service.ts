import type { Env } from "../../config/env";
import {
    createActivity,
    findActivityByEventId,
    type LarkActivityRecord,
} from "./activity.repository";
import type {
    Activity,
    ActivityValue,
} from "./activity.types";

export type RecordActivityResult = {
    duplicate: boolean;
    record: LarkActivityRecord;
};

function serializeActivityValue(
    value: ActivityValue | undefined
): string {
    if (value === undefined) {
        return "";
    }

    if (value === null) {
        return "null";
    }

    if (typeof value === "string") {
        return value;
    }

    if (
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return String(value);
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export async function recordActivityOnce(
    env: Env,
    activity: Activity
): Promise<RecordActivityResult> {
    const normalizedEventId =
        activity.event_id.trim();

    if (!normalizedEventId) {
        throw new Error(
            "Activity event_id is required"
        );
    }

    const existing =
        await findActivityByEventId(
            env,
            normalizedEventId
        );

    if (existing) {
        return {
            duplicate: true,
            record: existing,
        };
    }

    const created = await createActivity(
        env,
        {
            ...activity,
            event_id: normalizedEventId,
            old_value_text:
                serializeActivityValue(
                    activity.old_value
                ),
            new_value_text:
                serializeActivityValue(
                    activity.new_value
                ),
        }
    );

    return {
        duplicate: false,
        record: created,
    };
}