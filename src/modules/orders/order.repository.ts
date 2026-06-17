import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { createLarkRecord } from "../../providers/lark/lark.provider";
import type { Order } from "./order.types";

export async function createOrder(
    env: Env,
    order: Order
): Promise<unknown> {
    const fields: Record<string, unknown> = {
        [ORDER_FIELDS.ORDER_NUMBER]: order.order_number,
        [ORDER_FIELDS.CHANNEL]: order.channel,
        [ORDER_FIELDS.EXTERNAL_ORDER_ID]: order.external_order_id ?? "",
        [ORDER_FIELDS.CUSTOMER_NAME]: order.customer_name ?? "",
        [ORDER_FIELDS.PHONE]: order.phone ?? "",
        [ORDER_FIELDS.ADDRESS]: order.address ?? "",
        [ORDER_FIELDS.PRODUCT_NAME]: order.product_name,
        [ORDER_FIELDS.QUANTITY]: order.quantity,
        [ORDER_FIELDS.TOTAL_AMOUNT]: order.total_amount,
        [ORDER_FIELDS.PAYMENT_STATUS]: order.payment_status,
        [ORDER_FIELDS.PAYMENT_VERIFIED]: order.payment_verified,
        [ORDER_FIELDS.ORDER_STATUS]: order.order_status,
        [ORDER_FIELDS.SALES_OWNER]: order.sales_owner ?? "Unassigned",
        [ORDER_FIELDS.CREATED_AT]: order.created_at ?? Date.now(),
    };

    if (order.customer_record_id) {
        fields[ORDER_FIELDS.CUSTOMER] = [order.customer_record_id];
    }

    if (order.pipeline_record_id) {
        fields[ORDER_FIELDS.PIPELINE] = [order.pipeline_record_id];
    }

    return await createLarkRecord(env, env.ORDERS_TABLE_ID, fields);
}