import type { BuyerIntent } from "../../ai/ai.types";

export type CustomerStage =
    | "New Lead"
    | "Interested"
    | "Negotiating"
    | "Closing"
    | "Won"
    | "Lost";

export type Channel =
    | "LINE"
    | "Shopee"
    | "Lazada"
    | "TikTok";

export interface Customer {
    customer_id?: string;

    channel: Channel;

    channel_customer_id: string;

    customer_name: string;

    phone?: string;

    current_stage: CustomerStage;

    buyer_intent: BuyerIntent;

    lead_score: number;

    hot_lead: boolean;

    ai_summary?: string;

    last_message?: string;

    message_count: number;

    product_name?: string;

    product_size?: string;

    product_qty?: number;

    product_unit?: string;

    pending_payment?: boolean;

    pending_slip_amount?: number;

    pending_slip_bank?: string;

    pending_slip_image_url?: string;

    pending_slip_attachment_tokens?: string[];

    sales_owner?: string;

    created_at?: number;

    updated_at?: number;
}
