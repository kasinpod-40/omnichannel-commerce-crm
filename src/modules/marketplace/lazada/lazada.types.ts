export type LazadaCountryUserInfo = {
    country: string;
    user_id?: string;
    seller_id: string;
    short_code?: string;
};

export type LazadaTokenPayload = {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    refresh_expires_in?: number;
    account?: string;
    country?: string;
    account_platform?: string;
    country_user_info: LazadaCountryUserInfo[];
};

export type LazadaSellerCredential = {
    platform: "Lazada";
    seller_id: string;
    user_id?: string;
    short_code?: string;
    account?: string;
    country: string;
    region: "TH";
    access_token: string;
    refresh_token: string;
    access_token_expires_at: number;
    refresh_token_expires_at: number;
    connected_at: number;
    updated_at: number;
};

export type LazadaApiResponse<T = unknown> = {
    code?: string | number;
    message?: string;
    detail?: unknown;
    request_id?: string;
    data?: T;
    [key: string]: unknown;
};

export type LazadaWebhookEnvelope = {
    seller_id?: string | number;
    message_type?: string | number;
    timestamp?: string | number;
    site?: string;
    data?: Record<string, unknown>;
    [key: string]: unknown;
};

export type LazadaOrderListItem = Record<string, unknown>;

export type LazadaOrderListPage = {
    orders: LazadaOrderListItem[];
    count: number;
    total: number;
    offset: number;
    limit: number;
};
