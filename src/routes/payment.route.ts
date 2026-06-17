import type { Env } from "../config/env";
import { verifyPayment } from "../usecases/verify-payment.usecase";
import { jsonResponse } from "../utils/response";

export async function handleVerifyPaymentTest(
    request: Request,
    env: Env
): Promise<Response> {
    const url = new URL(request.url);

    const orderRecordId =
        url.searchParams
            .get("order_record_id")
            ?.trim() ?? "";

    if (!orderRecordId) {
        return jsonResponse(
            {
                ok: false,
                message:
                    "กรุณาระบุ order_record_id",
                example:
                    "/payment/verify-test?order_record_id=recxxxxxxxx",
            },
            400
        );
    }

    const result = await verifyPayment(env, {
        order_record_id: orderRecordId,
    });

    return jsonResponse(
        {
            ok: result.ok,
            result,
        },
        result.ok ? 200 : 400
    );
}