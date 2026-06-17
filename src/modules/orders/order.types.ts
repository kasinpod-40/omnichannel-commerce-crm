import type { Channel } from "../customers/customer.types";

export type PaymentStatus = "Waiting Payment" | "Paid" | "Failed" | "Refunded";

export type OrderStatus =
    | "Waiting Payment"
    | "Payment Review"
    | "Waiting Address"
    | "Completed"
    | "Cancelled";

export interface Order {
    order_number: string;

    customer_record_id?: string;

    pipeline_record_id?: string;

    channel: Channel;

    external_order_id?: string;

    customer_name?: string;

    phone?: string;

    address?: string;

    product_name: string;

    quantity: number;

    total_amount: number;

    payment_status: PaymentStatus;

    payment_verified: boolean;

    order_status: OrderStatus;

    sales_owner?: string;

    created_at?: number;
}