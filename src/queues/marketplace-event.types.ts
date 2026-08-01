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

export interface PcOrderSyncQueueMessage {
    schema_version: 1;
    kind: "pc_order_sync";
    event_id: string;
    order_record_id: string;
    requested_at: number;
    source: "payment" | "marketplace" | "order" | "dashboard" | "lark_workflow" | "reconcile";
}

export interface PcProductionCompleteQueueMessage {
    schema_version: 1;
    kind: "pc_production_complete";
    event_id: string;
    production_record_id: string;
    actual_qty: number;
    idempotency_key: string;
    owner?: string;
    requested_at: number;
    source: "dashboard" | "lark_workflow";
}

export interface PcMaterialRefreshQueueMessage {
    schema_version: 1;
    kind: "pc_material_refresh";
    event_id: string;
    requested_at: number;
    source: "dashboard" | "lark_workflow" | "reconcile";
}

export type PcInventoryQueueMessage =
    | PcOrderSyncQueueMessage
    | PcProductionCompleteQueueMessage
    | PcMaterialRefreshQueueMessage;

export type MarketplaceEventQueueMessage =
    | LazadaMarketplaceQueueMessage
    | PcInventoryQueueMessage;

export function isPcInventoryQueueMessage(
    message: MarketplaceEventQueueMessage
): message is PcInventoryQueueMessage {
    return "kind" in message && message.kind.startsWith("pc_");
}
