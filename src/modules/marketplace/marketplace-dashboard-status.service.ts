import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import {
    normalizeChannel,
    nullableText,
    readTimestamp,
    toIso,
} from "../dashboard-read/dashboard-read.shared";
import { getDashboardOrders } from "../dashboard-read/dashboard-read.records";
import type { DashboardLanguage } from "../dashboard-read/dashboard-read.types";
import {
    listMarketplaceDashboardEvents,
    type MarketplaceDashboardEvent,
} from "./marketplace-event-log";
import { listLazadaCredentials } from "./lazada/lazada.token-store";
import type { LazadaSellerCredential } from "./lazada/lazada.types";
import { listTikTokCredentials } from "./tiktok/tiktok.token-store";
import type { TikTokShopCredential } from "./tiktok/tiktok.types";

export type MarketplacePlatformResponse = "Shopee" | "Lazada" | "TikTok Shop";
export type MarketplaceHealthResponse = "healthy" | "attention" | "disconnected";

export type MarketplaceConnectionResponse = {
    platform: MarketplacePlatformResponse;
    seller_account: string;
    country: "TH";
    currency: "THB";
    health: MarketplaceHealthResponse;
    oauth_connected: boolean;
    webhook_active: boolean;
    order_sync_active: boolean;
    orders_today: number;
    last_webhook_at: string | null;
    last_order_sync_at: string | null;
    last_error: string | null;
};

export type MarketplaceStatusResponse = {
    connections: MarketplaceConnectionResponse[];
    updated_at: string;
};

export type MarketplaceSyncHistoryResponse = {
    items: MarketplaceDashboardEvent[];
    pagination: {
        page: number;
        page_size: number;
        total: number;
        total_pages: number;
    };
    updated_at: string;
};

export type MarketplaceDetailResponse = {
    connection: MarketplaceConnectionResponse;
    recent_events: MarketplaceDashboardEvent[];
    updated_at: string;
};

export type MarketplaceHistoryQuery = {
    page: number;
    page_size: number;
    platform?: MarketplacePlatformResponse;
};

type MarketplaceOrderSnapshot = {
    record_id: string;
    platform: MarketplacePlatformResponse;
    store_name: string | null;
    store_id: string | null;
    marketplace_status: string | null;
    event_id: string | null;
    created_at_ms: number;
    updated_at_ms: number;
};

type MarketplaceReadData = {
    orders: Awaited<ReturnType<typeof getDashboardOrders>>;
    lazada: LazadaSellerCredential[];
    tiktok: TikTokShopCredential[];
};

const PLATFORMS: MarketplacePlatformResponse[] = ["Shopee", "Lazada", "TikTok Shop"];

async function safeLazadaCredentials(env: Env): Promise<LazadaSellerCredential[]> {
    try {
        return await listLazadaCredentials(env);
    } catch (error) {
        if (error instanceof Error && error.message === "MARKETPLACE_TOKENS_KV_NOT_CONFIGURED") return [];
        throw error;
    }
}

async function safeTikTokCredentials(env: Env): Promise<TikTokShopCredential[]> {
    try {
        return await listTikTokCredentials(env);
    } catch (error) {
        if (error instanceof Error && error.message === "MARKETPLACE_TOKENS_KV_NOT_CONFIGURED") return [];
        throw error;
    }
}

async function loadMarketplaceReadData(env: Env): Promise<MarketplaceReadData> {
    const [orders, lazada, tiktok] = await Promise.all([
        getDashboardOrders(env),
        safeLazadaCredentials(env),
        safeTikTokCredentials(env),
    ]);
    return { orders, lazada, tiktok };
}

function toPlatform(channel: ReturnType<typeof normalizeChannel>): MarketplacePlatformResponse | null {
    return channel === "LINE" ? null : channel;
}

function snapshotOrders(records: Awaited<ReturnType<typeof getDashboardOrders>>): MarketplaceOrderSnapshot[] {
    return records.flatMap((record) => {
        const platform = toPlatform(normalizeChannel(record.fields[ORDER_FIELDS.CHANNEL]));
        if (!platform) return [];
        const createdAt = readTimestamp(record.fields[ORDER_FIELDS.CREATED_AT]);
        const marketplaceUpdatedAt = readTimestamp(record.fields[ORDER_FIELDS.MARKETPLACE_UPDATED_AT]);
        const updatedAt = marketplaceUpdatedAt || readTimestamp(record.fields[ORDER_FIELDS.UPDATED_AT], createdAt);

        return [{
            record_id: record.record_id,
            platform,
            store_name: nullableText(record.fields[ORDER_FIELDS.MARKETPLACE_STORE_NAME]),
            store_id: nullableText(record.fields[ORDER_FIELDS.MARKETPLACE_STORE_ID]),
            marketplace_status: nullableText(record.fields[ORDER_FIELDS.MARKETPLACE_STATUS]),
            event_id: nullableText(record.fields[ORDER_FIELDS.MARKETPLACE_EVENT_ID]),
            created_at_ms: createdAt,
            updated_at_ms: updatedAt,
        }];
    });
}

function bangkokDateKey(timestamp: number): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(timestamp));
}

function latestOrder(items: MarketplaceOrderSnapshot[]): MarketplaceOrderSnapshot | null {
    return [...items].sort((left, right) => {
        const time = right.updated_at_ms - left.updated_at_ms;
        return time !== 0 ? time : right.record_id.localeCompare(left.record_id);
    })[0] ?? null;
}

function credentialInfo(
    platform: MarketplacePlatformResponse,
    data: MarketplaceReadData
): { connected: boolean; seller: string | null; updatedAt: number } {
    if (platform === "Lazada") {
        const credential = [...data.lazada].sort((a, b) => b.updated_at - a.updated_at)[0];
        return {
            connected: Boolean(credential),
            seller: credential?.account || credential?.seller_id || null,
            updatedAt: credential?.updated_at ?? 0,
        };
    }

    if (platform === "TikTok Shop") {
        const credential = [...data.tiktok].sort((a, b) => b.updated_at - a.updated_at)[0];
        return {
            connected: Boolean(credential),
            seller: credential?.shop_name || credential?.shop_id || null,
            updatedAt: credential?.updated_at ?? 0,
        };
    }

    return { connected: false, seller: null, updatedAt: 0 };
}

function health(connected: boolean, hasRecentSync: boolean, hasOrders: boolean): MarketplaceHealthResponse {
    if (connected && hasRecentSync) return "healthy";
    if (connected || hasOrders) return "attention";
    return "disconnected";
}

function buildConnections(
    data: MarketplaceReadData,
    language: DashboardLanguage,
    now = Date.now()
): MarketplaceConnectionResponse[] {
    const orders = snapshotOrders(data.orders);
    const today = bangkokDateKey(now);

    return PLATFORMS.map((platform) => {
        const platformOrders = orders.filter((order) => order.platform === platform);
        const latest = latestOrder(platformOrders);
        const credentials = credentialInfo(platform, data);
        const hasRecentSync = Boolean(latest && now - latest.updated_at_ms <= 24 * 60 * 60 * 1000);
        const seller = credentials.seller || latest?.store_name || latest?.store_id || (
            language === "th" ? "ยังไม่ได้เชื่อมต่อ" : "Not connected"
        );
        const connected = credentials.connected;
        const hasOrders = platformOrders.length > 0;
        const connectionHealth = health(connected, hasRecentSync, hasOrders);

        return {
            platform,
            seller_account: seller,
            country: "TH",
            currency: "THB",
            health: connectionHealth,
            oauth_connected: connected,
            webhook_active: hasRecentSync,
            order_sync_active: hasRecentSync,
            orders_today: platformOrders.filter((order) => bangkokDateKey(order.created_at_ms) === today).length,
            last_webhook_at: latest ? toIso(latest.updated_at_ms) : null,
            last_order_sync_at: latest ? toIso(latest.updated_at_ms) : null,
            last_error: connectionHealth === "disconnected"
                ? "OAUTH_NOT_CONNECTED"
                : connectionHealth === "attention" && !connected
                    ? "OAUTH_NOT_CONNECTED"
                    : connectionHealth === "attention" && !hasRecentSync
                        ? "ORDER_SYNC_STALE"
                        : null,
        };
    });
}

function snapshotHistory(data: MarketplaceReadData): MarketplaceDashboardEvent[] {
    const orders = snapshotOrders(data.orders);
    const orderHistory = orders.map((order) => ({
        id: `snapshot:order:${order.record_id}:${order.event_id ?? "none"}`,
        platform: order.platform,
        event_type: "order_sync" as const,
        result: "success" as const,
        detail: order.marketplace_status || "ORDER_UPDATED",
        occurred_at: toIso(order.updated_at_ms),
    }));

    const credentialHistory: MarketplaceDashboardEvent[] = [
        ...data.lazada.map((credential) => ({
            id: `snapshot:oauth:lazada:${credential.seller_id}`,
            platform: "Lazada" as const,
            event_type: "oauth_refresh" as const,
            result: "success" as const,
            detail: "TOKEN_UPDATED",
            occurred_at: toIso(credential.updated_at),
        })),
        ...data.tiktok.map((credential) => ({
            id: `snapshot:oauth:tiktok:${credential.shop_id}`,
            platform: "TikTok Shop" as const,
            event_type: "oauth_refresh" as const,
            result: "success" as const,
            detail: "TOKEN_UPDATED",
            occurred_at: toIso(credential.updated_at),
        })),
    ];

    return [...orderHistory, ...credentialHistory].sort((left, right) => {
        const time = Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
        return time !== 0 ? time : right.id.localeCompare(left.id);
    });
}

function platformFromId(marketplaceId: string): MarketplacePlatformResponse | null {
    const normalized = marketplaceId.trim().toLowerCase();
    if (normalized === "shopee") return "Shopee";
    if (normalized === "lazada") return "Lazada";
    if (normalized === "tiktok-shop" || normalized === "tiktok") return "TikTok Shop";
    return null;
}

/** สถานะ Connection ไม่รวม History เพื่อให้การเปลี่ยนหน้าตารางไม่คำนวณ Overview ใหม่ */
export async function getMarketplaceStatus(
    env: Env,
    language: DashboardLanguage = "th"
): Promise<MarketplaceStatusResponse> {
    const data = await loadMarketplaceReadData(env);
    return {
        connections: buildConnections(data, language),
        updated_at: new Date().toISOString(),
    };
}

/** History endpoint แยก รองรับ Event Log จริงใน KV และ fallback Snapshot สำหรับข้อมูลก่อนอัปเกรด */
export async function getMarketplaceSyncHistory(
    env: Env,
    _language: DashboardLanguage = "th",
    query: MarketplaceHistoryQuery = { page: 1, page_size: 10 }
): Promise<MarketplaceSyncHistoryResponse> {
    const eventPage = await listMarketplaceDashboardEvents(env, query);
    if (eventPage && eventPage.total > 0) {
        return {
            items: eventPage.items,
            pagination: {
                page: eventPage.page,
                page_size: eventPage.page_size,
                total: eventPage.total,
                total_pages: eventPage.total_pages,
            },
            updated_at: new Date().toISOString(),
        };
    }

    const data = await loadMarketplaceReadData(env);
    const allItems = snapshotHistory(data).filter((item) => !query.platform || item.platform === query.platform);
    const totalPages = Math.max(1, Math.ceil(allItems.length / query.page_size));
    const safePage = Math.min(Math.max(query.page, 1), totalPages);
    const start = (safePage - 1) * query.page_size;

    return {
        items: allItems.slice(start, start + query.page_size),
        pagination: {
            page: safePage,
            page_size: query.page_size,
            total: allItems.length,
            total_pages: totalPages,
        },
        updated_at: new Date().toISOString(),
    };
}

/** Drawer ใช้ Query ของตัวเอง จึงไม่เปลี่ยน Loading/History ตามหน้าตารางหลัก */
export async function getMarketplaceDetail(
    env: Env,
    marketplaceId: string,
    language: DashboardLanguage = "th"
): Promise<MarketplaceDetailResponse | null> {
    const platform = platformFromId(marketplaceId);
    if (!platform) return null;

    const [status, history] = await Promise.all([
        getMarketplaceStatus(env, language),
        getMarketplaceSyncHistory(env, language, { page: 1, page_size: 20, platform }),
    ]);
    const connection = status.connections.find((item) => item.platform === platform);
    if (!connection) return null;

    return {
        connection,
        recent_events: history.items,
        updated_at: new Date().toISOString(),
    };
}
