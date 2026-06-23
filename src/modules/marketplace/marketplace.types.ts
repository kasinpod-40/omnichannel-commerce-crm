import type { Channel } from "../customers/customer.types";
import type {
    OrderStatus,
    PaymentStatus,
} from "../orders/order.types";

export type MarketplaceChannel = Extract<
    Channel,
    "Shopee" | "Lazada" | "TikTok"
>;

export type MarketplaceOrderItem = {
    sku?: string;
    name: string;
    variant?: string;
    quantity: number;
    unit_price?: number;
};

export type MarketplaceBuyer = {
    id: string;
    name?: string;
    phone?: string;
    address?: string;
};

export type MarketplaceOrderInput = {
    channel: MarketplaceChannel;
    event_id: string;
    store_id: string;
    store_name?: string;
    external_order_id: string;
    buyer: MarketplaceBuyer;
    items: MarketplaceOrderItem[];
    currency?: string;
    total_amount: number;
    marketplace_status: string;
    marketplace_payment_status?: string;
    tracking_number?: string;
    shipping_provider?: string;
    created_at?: number | string;
    updated_at?: number | string;
    paid_at?: number | string;
};

export type MarketplaceStatusMapping = {
    order_status: OrderStatus;
    payment_status: PaymentStatus;
    payment_verified: boolean;
};

export type MarketplaceOrderUpsertResult = {
    action: "created" | "updated" | "duplicate" | "stale";
    customer_record_id: string;
    order_record_id: string;
    channel: MarketplaceChannel;
    external_order_id: string;
    order_status: OrderStatus;
    payment_status: PaymentStatus;
};
