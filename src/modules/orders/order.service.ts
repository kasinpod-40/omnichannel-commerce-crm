import type { Env } from "../../config/env";
import { createOrder } from "./order.repository";

function generateOrderNumber(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const random = Math.floor(Math.random() * 9000) + 1000;

    return `ORD-${yyyy}${mm}${dd}-${random}`;
}

export async function createTestOrderForCustomer(
    env: Env,
    input: {
        customer_record_id: string;
        pipeline_record_id?: string;
    }
): Promise<unknown> {
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