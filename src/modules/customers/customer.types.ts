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

    lead_score: number;

    hot_lead: boolean;

    ai_summary?: string;

    last_message?: string;

    message_count: number;

    sales_owner?: string;

    created_at?: number;

    updated_at?: number;
}