import type { Env } from "../../config/env";
import { CUSTOMER_FIELDS } from "../../core/lark-fields";
import { updateCustomer, type LarkCustomerRecord } from "../customers/customer.repository";
import type { LarkPipelineRecord } from "../pipeline/pipeline.repository";
import { createOrder, type LarkOrderRecord } from "./order.repository";

function generateOrderNumber(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const random = Math.floor(Math.random() * 9000) + 1000;

    return `ORD-${yyyy}${mm}${dd}-${random}`;
}

function getFirstLinkedRecordId(value: unknown): string | null {
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }

    const first = value[0] as any;

    if (typeof first === "string") {
        return first;
    }

    return first?.record_id ?? first?.id ?? null;
}

export async function createTestOrderForCustomer(
    env: Env,
    input: {
        customer_record_id: string;
        pipeline_record_id?: string;
    }
): Promise<LarkOrderRecord> {
    return await createOrder(env, {
        order_number: generateOrderNumber(),
        customer_record_id: input.customer_record_id,
        pipeline_record_id: input.pipeline_record_id,
        channel: "LINE",
        external_order_id: "",
        customer_name: "LINE Test User",
        phone: "0800000000",
        address: "Test Address",
        product_name: "Test Product",
        quantity: 1,
        total_amount: 999,
        payment_status: "Waiting Payment",
        payment_verified: false,
        order_status: "Waiting Payment",
        sales_owner: "Unassigned",
    });
}

export async function createOrderIfReadyToBuy(
    env: Env,
    customer: LarkCustomerRecord,
    pipeline: LarkPipelineRecord | null,
    input: {
        product_name?: string;
        quantity?: number;
        total_amount?: number;
        message?: string;
    }
): Promise<LarkOrderRecord | null> {
    const activeOrderId = getFirstLinkedRecordId(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_ORDER]
    );

    if (activeOrderId) {
        return null;
    }

    const order = await createOrder(env, {
        order_number: generateOrderNumber(),
        customer_record_id: customer.record_id,
        pipeline_record_id: pipeline?.record_id,
        channel: "LINE",
        external_order_id: "",
        customer_name: String(customer.fields[CUSTOMER_FIELDS.CUSTOMER_NAME] ?? ""),
        phone: String(customer.fields[CUSTOMER_FIELDS.PHONE] ?? ""),
        address: "",
        product_name: input.product_name ?? input.message ?? "สินค้าในแชท",
        quantity: input.quantity ?? 1,
        total_amount: input.total_amount ?? 0,
        payment_status: "Waiting Payment",
        payment_verified: false,
        order_status: "Waiting Payment",
        sales_owner: "Unassigned",
    });

    await updateCustomer(env, customer.record_id, {
        active_order: [order.record_id],
    });

    return order;
}