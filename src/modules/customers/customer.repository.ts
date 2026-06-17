import type { Env } from "../../config/env";
import { CUSTOMER_FIELDS } from "../../core/lark-fields";
import {
    createLarkRecord,
    getLarkRecord,
    searchLarkRecords,
    updateLarkRecord,
} from "../../providers/lark/lark.provider";
import type {
    Channel,
    Customer,
    CustomerStage,
} from "./customer.types";

export type LarkCustomerRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

export type UpdateCustomerFields = Partial<{
    customer_name: string;
    phone: string;
    current_stage: CustomerStage;
    lead_score: number;
    hot_lead: boolean;
    ai_summary: string;
    last_message: string;
    message_count: number;
    active_pipeline_id: string;
    active_order_id: string;
    sales_owner: string;
    updated_at: number;
}>;

function normalizeCustomerRecord(
    result: unknown
): LarkCustomerRecord {
    const data = result as {
        record?: LarkCustomerRecord;
        record_id?: string;
        id?: string;
        fields?: Record<string, unknown>;
    };

    if (data.record?.record_id) {
        return data.record;
    }

    const recordId = data.record_id ?? data.id;

    if (recordId) {
        return {
            record_id: recordId,
            fields: data.fields ?? {},
        };
    }

    throw new Error(
        `Invalid Lark customer record: ${JSON.stringify(result)}`
    );
}

export async function createCustomer(
    env: Env,
    customer: Customer
): Promise<LarkCustomerRecord> {
    const now = Date.now();

    const fields: Record<string, unknown> = {
        [CUSTOMER_FIELDS.CHANNEL]: customer.channel,
        [CUSTOMER_FIELDS.CHANNEL_CUSTOMER_ID]:
            customer.channel_customer_id,
        [CUSTOMER_FIELDS.CUSTOMER_NAME]:
            customer.customer_name,
        [CUSTOMER_FIELDS.PHONE]: customer.phone ?? "",
        [CUSTOMER_FIELDS.CURRENT_STAGE]:
            customer.current_stage,
        [CUSTOMER_FIELDS.LEAD_SCORE]:
            customer.lead_score,
        [CUSTOMER_FIELDS.HOT_LEAD]:
            customer.hot_lead,
        [CUSTOMER_FIELDS.AI_SUMMARY]:
            customer.ai_summary ?? "",
        [CUSTOMER_FIELDS.LAST_MESSAGE]:
            customer.last_message ?? "",
        [CUSTOMER_FIELDS.MESSAGE_COUNT]:
            customer.message_count,
        [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "",
        [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "",
        [CUSTOMER_FIELDS.SALES_OWNER]:
            customer.sales_owner ?? "Unassigned",
        [CUSTOMER_FIELDS.CREATED_AT]: now,
        [CUSTOMER_FIELDS.UPDATED_AT]: now,
    };

    const result = await createLarkRecord(
        env,
        env.CUSTOMERS_TABLE_ID,
        fields
    );

    return normalizeCustomerRecord(result);
}

export async function getCustomerByRecordId(
    env: Env,
    recordId: string
): Promise<LarkCustomerRecord | null> {
    const result = await getLarkRecord(
        env,
        env.CUSTOMERS_TABLE_ID,
        recordId
    );

    if (!result) {
        return null;
    }

    return normalizeCustomerRecord(result);
}

export async function findCustomerByChannelCustomerId(
    env: Env,
    channel: Channel,
    channelCustomerId: string
): Promise<LarkCustomerRecord | null> {
    const records = await searchLarkRecords(
        env,
        env.CUSTOMERS_TABLE_ID,
        {
            conjunction: "and",
            conditions: [
                {
                    field_name: CUSTOMER_FIELDS.CHANNEL,
                    operator: "is",
                    value: [channel],
                },
                {
                    field_name:
                        CUSTOMER_FIELDS.CHANNEL_CUSTOMER_ID,
                    operator: "is",
                    value: [channelCustomerId],
                },
            ],
        }
    );

    if (records.length === 0) {
        return null;
    }

    return records[0] as LarkCustomerRecord;
}

export async function updateCustomer(
    env: Env,
    recordId: string,
    fields: UpdateCustomerFields
): Promise<LarkCustomerRecord> {
    const larkFields: Record<string, unknown> = {};

    if (fields.customer_name !== undefined) {
        larkFields[CUSTOMER_FIELDS.CUSTOMER_NAME] =
            fields.customer_name;
    }

    if (fields.phone !== undefined) {
        larkFields[CUSTOMER_FIELDS.PHONE] =
            fields.phone;
    }

    if (fields.current_stage !== undefined) {
        larkFields[CUSTOMER_FIELDS.CURRENT_STAGE] =
            fields.current_stage;
    }

    if (fields.lead_score !== undefined) {
        larkFields[CUSTOMER_FIELDS.LEAD_SCORE] =
            fields.lead_score;
    }

    if (fields.hot_lead !== undefined) {
        larkFields[CUSTOMER_FIELDS.HOT_LEAD] =
            fields.hot_lead;
    }

    if (fields.ai_summary !== undefined) {
        larkFields[CUSTOMER_FIELDS.AI_SUMMARY] =
            fields.ai_summary;
    }

    if (fields.last_message !== undefined) {
        larkFields[CUSTOMER_FIELDS.LAST_MESSAGE] =
            fields.last_message;
    }

    if (fields.message_count !== undefined) {
        larkFields[CUSTOMER_FIELDS.MESSAGE_COUNT] =
            fields.message_count;
    }

    if (fields.active_pipeline_id !== undefined) {
        larkFields[CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID] =
            fields.active_pipeline_id;
    }

    if (fields.active_order_id !== undefined) {
        larkFields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID] =
            fields.active_order_id;
    }

    if (fields.sales_owner !== undefined) {
        larkFields[CUSTOMER_FIELDS.SALES_OWNER] =
            fields.sales_owner;
    }

    larkFields[CUSTOMER_FIELDS.UPDATED_AT] =
        fields.updated_at ?? Date.now();

    const result = await updateLarkRecord(
        env,
        env.CUSTOMERS_TABLE_ID,
        recordId,
        larkFields
    );

    return normalizeCustomerRecord(result);
}