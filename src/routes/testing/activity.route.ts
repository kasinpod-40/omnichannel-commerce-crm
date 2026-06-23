import type { Env } from "../../config/env";
import { getCustomerByRecordId } from "../../modules/customers/customer.repository";
import { recordActivityOnce } from "../../modules/activities/activity.service";
import { jsonResponse } from "../../utils/response";

export async function handleActivityTest(
    request: Request,
    env: Env
): Promise<Response> {
    const url = new URL(request.url);

    const customerRecordId =
        url.searchParams
            .get("customer_record_id")
            ?.trim() ?? "";

    const eventId =
        url.searchParams
            .get("event_id")
            ?.trim() ?? "";

    if (!customerRecordId) {
        return jsonResponse(
            {
                ok: false,
                message:
                    "กรุณาระบุ customer_record_id",
            },
            400
        );
    }

    if (!eventId) {
        return jsonResponse(
            {
                ok: false,
                message:
                    "กรุณาระบุ event_id",
            },
            400
        );
    }

    const customer =
        await getCustomerByRecordId(
            env,
            customerRecordId
        );

    if (!customer) {
        return jsonResponse(
            {
                ok: false,
                message:
                    "ไม่พบ Customer record",
                customer_record_id:
                    customerRecordId,
            },
            404
        );
    }

    const result =
        await recordActivityOnce(env, {
            event_id: eventId,
            customer_record_id:
                customerRecordId,
            action: "MESSAGE_RECEIVED",
            old_value: null,
            new_value: {
                source: "activity_test",
                message:
                    "ทดสอบระบบ Activity Audit Log",
            },
        });

    return jsonResponse({
        ok: true,
        result,
    });
}