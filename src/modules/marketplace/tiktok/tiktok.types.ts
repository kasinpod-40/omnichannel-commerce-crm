export type TikTokTokenPayload = {
    access_token: string;
    refresh_token: string;
    access_token_expire_in?: number;
    refresh_token_expire_in?: number;
    open_id?: string;
    seller_name?: string;
    seller_base_region?: string;
    granted_scopes?: string[];
};

export type TikTokAuthorizedShop = {
    shop_cipher: string;
    shop_id: string;
    shop_name: string;
    region: string;
    seller_type?: string;
};

export type TikTokShopCredential = {
    platform: "TikTok";
    shop_cipher: string;
    shop_id: string;
    shop_name: string;
    region: string;
    seller_type?: string;
    open_id?: string;
    access_token: string;
    refresh_token: string;
    access_token_expires_at: number;
    refresh_token_expires_at: number;
    granted_scopes: string[];
    connected_at: number;
    updated_at: number;
};

export type TikTokApiResponse<T = unknown> = {
    code?: number;
    message?: string;
    request_id?: string;
    data?: T;
    [key: string]: unknown;
};

export type TikTokWebhookEnvelope = {
    type?: string | number;
    event?: string;
    event_id?: string;
    event_idempotency_key?: string;
    request_id?: string;
    timestamp?: number | string;
    shop_id?: string;
    shop_cipher?: string;
    data?: Record<string, unknown>;
    challenge?: string;
    [key: string]: unknown;
};
