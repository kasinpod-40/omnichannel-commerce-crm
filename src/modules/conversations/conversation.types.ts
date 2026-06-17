export type Channel = "LINE" | "Shopee" | "Lazada" | "TikTok";

export type MessageType = "text" | "image" | "sticker" | "file";

export type Intent =
    | "unknown"
    | "greeting"
    | "general_inquiry"
    | "product_info"
    | "ask_discount"
    | "payment_request"
    | "delivery_address"
    | "lost";

export type ProcessStatus = "processing" | "synced" | "sync_failed";

export interface Conversation {
    customer_record_id?: string;

    channel: Channel;

    external_message_id: string;

    message_type: MessageType;

    message: string;

    image_url?: string;

    intent: Intent;

    lead_score: number;

    hot_lead: boolean;

    ai_summary?: string;

    process_status: ProcessStatus;

    error_message?: string;

    created_at?: number;
}