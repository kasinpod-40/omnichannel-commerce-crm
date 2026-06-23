import type {
    MarketplaceChannel,
    MarketplaceOrderInput,
} from "../marketplace.types";

export type MarketplaceSimulationEnvelope = {
    webhook: unknown;
    order_detail_response: unknown;
    order_items_response?: unknown;
    store_name?: string;
    dry_run?: boolean;
};

export type MarketplaceAdapterResult = {
    channel: MarketplaceChannel;
    region: "TH";
    currency: "THB";
    normalized: MarketplaceOrderInput;
    source: {
        webhook_order_id: string;
        webhook_status: string;
        webhook_timestamp?: number | string;
    };
};

export type MarketplaceAdapter = (
    envelope: MarketplaceSimulationEnvelope
) => MarketplaceAdapterResult;
