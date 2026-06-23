import type { Channel } from "../customers/customer.types";

export type PaymentStatus =
    | "Waiting Payment"
    | "Payment Review"
    | "Paid"
    | "Overdue"
    | "Failed"
    | "Refunded";

export type OrderStatus =
    | "Waiting Payment"
    | "Payment Review"
    | "Waiting Address"
    | "Processing"
    | "Ready to Ship"
    | "Shipped"
    | "Completed"
    | "Cancelled"
    | "Returned";

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

    product_size?: string;

    product_unit?: string;

    quantity: number;

    total_amount: number;

    payment_status: PaymentStatus;

    payment_verified: boolean;

    order_status: OrderStatus;

    sales_owner?: string;

    slip_amount?: number;

    slip_bank?: string;

    slip_image_url?: string;

    slip_attachment_tokens?: string[];

    created_at?: number;

    updated_at?: number;

    paid_at?: number;

    payment_due_at?: number;

    marketplace_store_id?: string;

    marketplace_store_name?: string;

    marketplace_status?: string;

    marketplace_items_json?: string;

    marketplace_event_id?: string;

    marketplace_updated_at?: number;

    currency?: string;

    tracking_number?: string;

    shipping_provider?: string;
}
