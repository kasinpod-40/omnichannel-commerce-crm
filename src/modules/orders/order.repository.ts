import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import {
    createLarkRecord,
    getLarkRecord,
    updateLarkRecord,
} from "../../providers/lark/lark.provider";
import { toLarkAttachmentFieldValue } from "../../providers/lark/lark-attachment.provider";
import type { Order } from "./order.types";

export type LarkOrderRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

export type UpdateOrderFields = Partial<{
    pipeline_record_id: string;
    customer_name: string;
    phone: string;
    address: string;
    product_name: string;
    product_unit: string;
    quantity: number;
    total_amount: number;
    payment_status: Order["payment_status"];
    payment_verified: boolean;
    order_status: Order["order_status"];
    sales_owner: string;
    slip_amount: number;
    slip_bank: string;
    slip_image_url: string;
    slip_attachment_tokens: string[];
    updated_at: number;
    paid_at: number;
}>;

function normalizeOrderRecord(result: unknown): LarkOrderRecord {
    const data = result as {
        record?: LarkOrderRecord;
        record_id?: string;
        fields?: Record<string, unknown>;
    };

    if (data.record?.record_id) {
        return data.record;
    }

    if (data.record_id) {
        return {
            record_id: data.record_id,
            fields: data.fields ?? {},
        };
    }

    throw new Error(
        `Invalid Lark order record: ${JSON.stringify(result)}`
    );
}

export async function createOrder(
    env: Env,
    order: Order
): Promise<LarkOrderRecord> {
    const now = Date.now();

    const fields: Record<string, unknown> = {
        [ORDER_FIELDS.ORDER_NUMBER]: order.order_number,
        [ORDER_FIELDS.CHANNEL]: order.channel,
        [ORDER_FIELDS.EXTERNAL_ORDER_ID]:
            order.external_order_id ?? "",
        [ORDER_FIELDS.CUSTOMER_NAME]: order.customer_name ?? "",
        [ORDER_FIELDS.PHONE]: order.phone ?? "",
        [ORDER_FIELDS.ADDRESS]: order.address ?? "",
        [ORDER_FIELDS.PRODUCT_NAME]: order.product_name,
        [ORDER_FIELDS.PRODUCT_UNIT]: order.product_unit ?? "",
        [ORDER_FIELDS.QUANTITY]: order.quantity,
        [ORDER_FIELDS.TOTAL_AMOUNT]: order.total_amount,
        [ORDER_FIELDS.PAYMENT_STATUS]: order.payment_status,
        [ORDER_FIELDS.PAYMENT_VERIFIED]:
            order.payment_verified,
        [ORDER_FIELDS.ORDER_STATUS]: order.order_status,
        [ORDER_FIELDS.SALES_OWNER]:
            order.sales_owner ?? "Unassigned",
        [ORDER_FIELDS.SLIP_AMOUNT]:
            order.slip_amount ?? 0,
        [ORDER_FIELDS.SLIP_BANK]:
            order.slip_bank ?? "",
        [ORDER_FIELDS.SLIP_IMAGE_URL]:
            order.slip_image_url ?? "",
        [ORDER_FIELDS.CREATED_AT]:
            order.created_at ?? now,
        [ORDER_FIELDS.UPDATED_AT]:
            order.updated_at ?? now,
    };

    if (
        order.slip_attachment_tokens &&
        order.slip_attachment_tokens.length > 0
    ) {
        fields[ORDER_FIELDS.SLIP_ATTACHMENT] =
            toLarkAttachmentFieldValue(
                order.slip_attachment_tokens
            );
    }

    if (order.paid_at !== undefined) {
        fields[ORDER_FIELDS.PAID_AT] = order.paid_at;
    }

    if (order.customer_record_id) {
        fields[ORDER_FIELDS.CUSTOMER] = [
            order.customer_record_id,
        ];
    }

    if (order.pipeline_record_id) {
        fields[ORDER_FIELDS.PIPELINE] = [
            order.pipeline_record_id,
        ];
    }

    const result = await createLarkRecord(
        env,
        env.ORDERS_TABLE_ID,
        fields
    );

    return normalizeOrderRecord(result);
}

export async function updateOrder(
    env: Env,
    recordId: string,
    fields: UpdateOrderFields
): Promise<LarkOrderRecord> {
    const larkFields: Record<string, unknown> = {};

    if (fields.pipeline_record_id !== undefined) {
        larkFields[ORDER_FIELDS.PIPELINE] =
            fields.pipeline_record_id
                ? [fields.pipeline_record_id]
                : [];
    }

    if (fields.customer_name !== undefined) {
        larkFields[ORDER_FIELDS.CUSTOMER_NAME] =
            fields.customer_name;
    }

    if (fields.phone !== undefined) {
        larkFields[ORDER_FIELDS.PHONE] = fields.phone;
    }

    if (fields.address !== undefined) {
        larkFields[ORDER_FIELDS.ADDRESS] = fields.address;
    }

    if (fields.product_name !== undefined) {
        larkFields[ORDER_FIELDS.PRODUCT_NAME] =
            fields.product_name;
    }

    if (fields.product_unit !== undefined) {
        larkFields[ORDER_FIELDS.PRODUCT_UNIT] =
            fields.product_unit;
    }

    if (fields.quantity !== undefined) {
        larkFields[ORDER_FIELDS.QUANTITY] = fields.quantity;
    }

    if (fields.total_amount !== undefined) {
        larkFields[ORDER_FIELDS.TOTAL_AMOUNT] =
            fields.total_amount;
    }

    if (fields.payment_status !== undefined) {
        larkFields[ORDER_FIELDS.PAYMENT_STATUS] =
            fields.payment_status;
    }

    if (fields.payment_verified !== undefined) {
        larkFields[ORDER_FIELDS.PAYMENT_VERIFIED] =
            fields.payment_verified;
    }

    if (fields.order_status !== undefined) {
        larkFields[ORDER_FIELDS.ORDER_STATUS] =
            fields.order_status;
    }

    if (fields.sales_owner !== undefined) {
        larkFields[ORDER_FIELDS.SALES_OWNER] =
            fields.sales_owner;
    }

    if (fields.slip_amount !== undefined) {
        larkFields[ORDER_FIELDS.SLIP_AMOUNT] =
            fields.slip_amount;
    }

    if (fields.slip_bank !== undefined) {
        larkFields[ORDER_FIELDS.SLIP_BANK] =
            fields.slip_bank;
    }

    if (fields.slip_image_url !== undefined) {
        larkFields[ORDER_FIELDS.SLIP_IMAGE_URL] =
            fields.slip_image_url;
    }

    if (fields.slip_attachment_tokens !== undefined) {
        larkFields[ORDER_FIELDS.SLIP_ATTACHMENT] =
            toLarkAttachmentFieldValue(
                fields.slip_attachment_tokens
            );
    }

    if (fields.paid_at !== undefined) {
        larkFields[ORDER_FIELDS.PAID_AT] =
            fields.paid_at;
    }

    larkFields[ORDER_FIELDS.UPDATED_AT] =
        fields.updated_at ?? Date.now();

    const result = await updateLarkRecord(
        env,
        env.ORDERS_TABLE_ID,
        recordId,
        larkFields
    );

    return normalizeOrderRecord(result);
}

export async function getOrderByRecordId(
    env: Env,
    recordId: string
): Promise<LarkOrderRecord | null> {
    const result = await getLarkRecord(
        env,
        env.ORDERS_TABLE_ID,
        recordId
    );

    if (!result) {
        return null;
    }

    return result as LarkOrderRecord;
}
