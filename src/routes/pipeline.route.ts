import type { Env } from "../config/env";
import { findCustomerByChannelCustomerId } from "../modules/customers/customer.repository";
import { createOpenPipelineForCustomer } from "../modules/pipeline/pipeline.service";
import { jsonResponse } from "../utils/response";

export async function handlePipelineTest(env: Env): Promise<Response> {
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

    const result = await createOpenPipelineForCustomer(env, {
        customer_record_id: customer.record_id,
        lead_score: 50,
        ai_summary: "Created pipeline from Worker test",
        sales_owner: "Unassigned",
    });

    return jsonResponse({
        ok: true,
        message: "Pipeline created",
        result,
    });
}