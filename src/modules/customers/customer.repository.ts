import type { Env } from "../../config/env";
import {
    createLarkRecord,
    searchLarkRecords,
    updateLarkRecord,
} from "../../providers/lark/lark.provider";
import type { Channel, Customer, CustomerStage } from "./customer.types";

export type LarkCustomerRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

export async function createCustomer(
    env: Env,
    customer: Customer
): Promise<unknown> {
    const now = Date.now();

    return await createLarkRecord(env, env.CUSTOMERS_TABLE_ID, {
        channel: customer.channel,
        channel_customer_id: customer.channel_customer_id,
        customer_name: customer.customer_name,
        phone: customer.phone ?? "",
        current_stage: customer.current_stage,
        lead_score: customer.lead_score,
        hot_lead: customer.hot_lead,
        ai_summary: customer.ai_summary ?? "",
        last_message: customer.last_message ?? "",
        message_count: customer.message_count,
        sales_owner: customer.sales_owner ?? "Unassigned",
        created_at: now,
        updated_at: now,
    });
}

export async function findCustomerByChannelCustomerId(
    env: Env,
    channel: Channel,
    channelCustomerId: string
): Promise<LarkCustomerRecord | null> {
    const records = await searchLarkRecords(env, env.CUSTOMERS_TABLE_ID, {
        conjunction: "and",
        conditions: [
            {
                field_name: "channel",
                operator: "is",
                value: [channel],
            },
            {
                field_name: "channel_customer_id",
                operator: "is",
                value: [channelCustomerId],
            },
        ],
    });

    if (records.length === 0) {
        return null;
    }

    return records[0] as LarkCustomerRecord;
}

export async function updateCustomer(
    env: Env,
    recordId: string,
    fields: Partial<{
        customer_name: string;
        phone: string;
        current_stage: CustomerStage;
        lead_score: number;
        hot_lead: boolean;
        ai_summary: string;
        last_message: string;
        message_count: number;
        sales_owner: string;
        updated_at: number;
    }>
): Promise<unknown> {
    return await updateLarkRecord(env, env.CUSTOMERS_TABLE_ID, recordId, {
        ...fields,
        updated_at: Date.now(),
    });
}