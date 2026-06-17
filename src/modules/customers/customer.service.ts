import type { AIAnalysisResult } from "../../ai/ai.types";
import type { Env } from "../../config/env";
import {
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import type {
    Channel,
    Customer,
} from "./customer.types";
import {
    createCustomer,
    findCustomerByChannelCustomerId,
    updateCustomer,
    type LarkCustomerRecord,
} from "./customer.repository";

export type UpsertCustomerInput = {
    channel: Channel;
    channel_customer_id: string;
    customer_name?: string;
    phone?: string;
    last_message?: string;
    ai?: AIAnalysisResult;
};

export async function upsertCustomer(
    env: Env,
    input: UpsertCustomerInput
): Promise<LarkCustomerRecord> {
    const existingCustomer =
        await findCustomerByChannelCustomerId(
            env,
            input.channel,
            input.channel_customer_id
        );

    if (!existingCustomer) {
        const newCustomer: Customer = {
            channel: input.channel,
            channel_customer_id:
                input.channel_customer_id,
            customer_name:
                input.customer_name ?? "Unknown Customer",
            phone: input.phone ?? "",
            current_stage:
                input.ai?.customer_stage ?? "New Lead",
            lead_score: input.ai?.lead_score ?? 0,
            hot_lead: input.ai?.hot_lead ?? false,
            ai_summary: input.ai?.ai_summary ?? "",
            last_message: input.last_message ?? "",
            message_count: 1,
            sales_owner: "Unassigned",
        };

        return await createCustomer(env, newCustomer);
    }

    const existingFields =
        existingCustomer.fields;

    const existingStage = getLarkText(
        existingFields.current_stage,
        "New Lead"
    ) as Customer["current_stage"];

    return await updateCustomer(
        env,
        existingCustomer.record_id,
        {
            customer_name:
                input.customer_name ??
                getLarkText(
                    existingFields.customer_name,
                    "Unknown Customer"
                ),

            phone:
                input.phone ??
                getLarkText(
                    existingFields.phone,
                    ""
                ),

            current_stage:
                input.ai?.customer_stage ??
                existingStage,

            lead_score:
                input.ai?.lead_score ??
                getLarkNumber(
                    existingFields.lead_score,
                    0
                ),

            hot_lead:
                input.ai?.hot_lead ??
                getLarkBoolean(
                    existingFields.hot_lead,
                    false
                ),

            ai_summary:
                input.ai?.ai_summary ??
                getLarkText(
                    existingFields.ai_summary,
                    ""
                ),

            last_message:
                input.last_message ?? "",

            message_count:
                getLarkNumber(
                    existingFields.message_count,
                    0
                ) + 1,
        }
    );
}

export async function markCustomerLost(
    env: Env,
    customer: LarkCustomerRecord
): Promise<LarkCustomerRecord> {
    return await updateCustomer(
        env,
        customer.record_id,
        {
            current_stage: "Lost",
            lead_score: 0,
            hot_lead: false,

            active_pipeline_id: "",
            active_order_id: "",
        }
    );
}