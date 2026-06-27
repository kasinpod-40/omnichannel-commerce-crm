import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";

const { listOrders, listLazadaCredentials, listTikTokCredentials, listEvents } = vi.hoisted(() => ({
    listOrders: vi.fn(),
    listLazadaCredentials: vi.fn(),
    listTikTokCredentials: vi.fn(),
    listEvents: vi.fn(),
}));
vi.mock("../orders/order.repository", () => ({ listOrders }));
vi.mock("./lazada/lazada.token-store", () => ({ listLazadaCredentials }));
vi.mock("./tiktok/tiktok.token-store", () => ({ listTikTokCredentials }));
vi.mock("./marketplace-event-log", () => ({ listMarketplaceDashboardEvents: listEvents }));

import {
    getMarketplaceDetail,
    getMarketplaceStatus,
    getMarketplaceSyncHistory,
} from "./marketplace-dashboard-status.service";

const env = {
    LARK_APP_TOKEN: "app",
    ORDERS_TABLE_ID: "orders",
} as any;

beforeEach(() => {
    vi.clearAllMocks();
    clearDashboardReadCache();
    const now = Date.now();
    listEvents.mockResolvedValue(null);
    listOrders.mockResolvedValue([{
        record_id: "rec_order_1",
        fields: {
            [ORDER_FIELDS.CHANNEL]: "Lazada",
            [ORDER_FIELDS.MARKETPLACE_STORE_NAME]: "ร้าน Lazada TH",
            [ORDER_FIELDS.MARKETPLACE_STATUS]: "ready_to_ship",
            [ORDER_FIELDS.MARKETPLACE_EVENT_ID]: "event-1",
            [ORDER_FIELDS.CREATED_AT]: now,
            [ORDER_FIELDS.UPDATED_AT]: now,
            [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: now,
        },
    }]);
    listLazadaCredentials.mockResolvedValue([{
        seller_id: "seller-1",
        account: "seller@example.com",
        updated_at: now,
    }]);
    listTikTokCredentials.mockResolvedValue([]);
});

describe("marketplace dashboard status service", () => {
    it("แยก Connection status ออกจาก History", async () => {
        const result = await getMarketplaceStatus(env);
        const lazada = result.connections.find((item) => item.platform === "Lazada");
        expect(lazada).toMatchObject({
            seller_account: "seller@example.com",
            oauth_connected: true,
            order_sync_active: true,
            health: "healthy",
        });
        expect(result).not.toHaveProperty("items");
    });

    it("แบ่ง History จาก endpoint แยกและเรียงล่าสุดแบบ stable", async () => {
        const result = await getMarketplaceSyncHistory(env, "th", { page: 2, page_size: 1 });
        expect(result.pagination).toEqual({ page: 2, page_size: 1, total: 2, total_pages: 2 });
        expect(result.items).toHaveLength(1);
    });

    it("Drawer ได้ History ของ Marketplace ที่เลือกโดยไม่อิงหน้าตาราง", async () => {
        const result = await getMarketplaceDetail(env, "lazada", "th");
        expect(result?.connection.platform).toBe("Lazada");
        expect(result?.recent_events.every((item) => item.platform === "Lazada")).toBe(true);
    });

    it("ใช้ Event Log จริงจาก KV เมื่อมีข้อมูล", async () => {
        listEvents.mockResolvedValue({
            items: [{
                id: "event-real",
                platform: "Lazada",
                event_type: "order_sync",
                result: "failed",
                detail: "API_TIMEOUT",
                occurred_at: new Date().toISOString(),
            }],
            page: 1,
            page_size: 10,
            total: 1,
            total_pages: 1,
        });
        const result = await getMarketplaceSyncHistory(env, "th", { page: 1, page_size: 10 });
        expect(result.items[0]).toMatchObject({ id: "event-real", result: "failed" });
    });
});
