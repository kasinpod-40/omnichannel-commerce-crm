import type { Env } from "../../config/env";
import { createCustomer } from "../../modules/customers/customer.repository";
import { upsertCustomer } from "../../modules/customers/customer.service";
import { getTenantAccessToken } from "../../providers/lark/lark.provider";
import { jsonResponse } from "../../utils/response";

export async function handleLarkTest(env: Env): Promise<Response> {
    const token = await getTenantAccessToken(env);

    return jsonResponse({
        ok: true,
        token_received: !!token,
    });
}

export async function handleCreateTestCustomer(env: Env): Promise<Response> {
    const now = Date.now();

    const result = await createCustomer(env, {
        channel: "LINE",
        channel_customer_id: `test_${now}`,
        customer_name: "Test Customer",
        phone: "0800000000",
        current_stage: "New Lead",
        buyer_intent: "Just Browsing",
        lead_score: 0,
        hot_lead: false,
        ai_summary: "Created from Customer Repository",
        last_message: "Hello from Customer Repository",
        message_count: 1,
        sales_owner: "Unassigned",
    });

    return jsonResponse({
        ok: true,
        message: "Test customer created via repository",
        result,
    });
}

export async function handleUpsertTestCustomer(env: Env): Promise<Response> {
    const result = await upsertCustomer(env, {
        channel: "LINE",
        channel_customer_id: "line_test_user_001",
        customer_name: "LINE Test User",
        phone: "0800000000",
        last_message: `Test message at ${new Date().toISOString()}`,
    });

    return jsonResponse({
        ok: true,
        message: "Test customer upsert completed",
        result,
    });
}