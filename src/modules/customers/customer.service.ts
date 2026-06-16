import type { Env } from "../../config/env";
import type { Channel, Customer } from "./customer.types";
import {
    createCustomer,
    findCustomerByChannelCustomerId,
    updateCustomer,
} from "./customer.repository";

export type UpsertCustomerInput = {
    channel: Channel;
    channel_customer_id: string;
    customer_name?: string;
    phone?: string;
    last_message?: string;
};

export async function upsertCustomer(
    env: Env,
    input: UpsertCustomerInput
): Promise<unknown> {
    const existingCustomer = await findCustomerByChannelCustomerId(
        env,
        input.channel,
        input.channel_customer_id
    );

    if (!existingCustomer) {
        const newCustomer: Customer = {
            channel: input.channel,
            channel_customer_id: input.channel_customer_id,
            customer_name: input.customer_name ?? "Unknown Customer",
            phone: input.phone ?? "",
            current_stage: "New Lead",
            lead_score: 0,
            hot_lead: false,
            ai_summary: "",
            last_message: input.last_message ?? "",
            message_count: 1,
            sales_owner: "Unassigned",
        };

        return await createCustomer(env, newCustomer);
    }

    const oldMessageCount =
        Number(existingCustomer.fields.message_count ?? 0) || 0;

    return await updateCustomer(env, existingCustomer.record_id, {
        customer_name:
            input.customer_name ??
            String(existingCustomer.fields.customer_name ?? "Unknown Customer"),
        phone: input.phone ?? String(existingCustomer.fields.phone ?? ""),
        last_message: input.last_message ?? "",
        message_count: oldMessageCount + 1,
    });
}