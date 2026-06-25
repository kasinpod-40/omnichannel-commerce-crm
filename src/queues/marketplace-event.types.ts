import type { LazadaWebhookEnvelope } from "../modules/marketplace/lazada/lazada.types";

export interface LazadaMarketplaceQueueMessage {
    schema_version: 1;
    channel: "Lazada";
    seller_id: string;
    order_id: string;
    order_status: string;
    message_type: string;
    received_at: number;
    webhook: LazadaWebhookEnvelope;
}

export type MarketplaceEventQueueMessage = LazadaMarketplaceQueueMessage;
