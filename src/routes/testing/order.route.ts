import type { Env } from "../../config/env";
import { findCustomerByChannelCustomerId } from "../../modules/customers/customer.repository";
import { createTestOrderForCustomer } from "../../modules/orders/order.service";
import { jsonResponse } from "../../utils/response";

export async function handleOrderTest(env: Env): Promise<Response> {
    const customer = await findCustomerByChannelCustomerId(
        env,
        "LINE",
        "line_test_user_001"
    );

    if (!customer) {
        return jsonResponse(
            {
                ok: false,
                message:
                    "Test customer not found. Run /lark/upsert-test-customer first.",
            },
            404
        );
    }

    const result = await createTestOrderForCustomer(env, {
        customer_record_id: customer.record_id,
    });

    return jsonResponse({
        ok: true,
        message: "Order created",
        result,
    });
}