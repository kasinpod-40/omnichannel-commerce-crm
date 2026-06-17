import type { Env } from "../../config/env";
import { CUSTOMER_FIELDS } from "../../core/lark-fields";
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
        [CUSTOMER_FIELDS.CHANNEL]: customer.channel,
        [CUSTOMER_FIELDS.CHANNEL_CUSTOMER_ID]: customer.channel_customer_id,
        [CUSTOMER_FIELDS.CUSTOMER_NAME]: customer.customer_name,
        [CUSTOMER_FIELDS.PHONE]: customer.phone ?? "",
        [CUSTOMER_FIELDS.CURRENT_STAGE]: customer.current_stage,
        [CUSTOMER_FIELDS.LEAD_SCORE]: customer.lead_score,
        [CUSTOMER_FIELDS.HOT_LEAD]: customer.hot_lead,
        [CUSTOMER_FIELDS.AI_SUMMARY]: customer.ai_summary ?? "",
        [CUSTOMER_FIELDS.LAST_MESSAGE]: customer.last_message ?? "",
        [CUSTOMER_FIELDS.MESSAGE_COUNT]: customer.message_count,
        [CUSTOMER_FIELDS.SALES_OWNER]: customer.sales_owner ?? "Unassigned",
        [CUSTOMER_FIELDS.CREATED_AT]: now,
        [CUSTOMER_FIELDS.UPDATED_AT]: now,
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
                field_name: CUSTOMER_FIELDS.CHANNEL,
                operator: "is",
                value: [channel],
            },
            {
                field_name: CUSTOMER_FIELDS.CHANNEL_CUSTOMER_ID,
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
        [CUSTOMER_FIELDS.UPDATED_AT]: Date.now(),
    });
}