import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_FIELDS } from "../../core/lark-fields";

const { listOrders } = vi.hoisted(() => ({
    listOrders: vi.fn(),
}));

vi.mock("../orders/order.repository", () => ({
    listOrders,
}));

import { buildMarketplaceDashboardSummary } from "./marketplace-dashboard.service";

const env = {} as any;
const june23 = Date.parse("2026-06-23T10:00:00+07:00");
const june24 = Date.parse("2026-06-24T10:00:00+07:00");

function order(
    recordId: string,
    fields: Record<string, unknown>
): { record_id: string; fields: Record<string, unknown> } {
    return { record_id: recordId, fields };
}

describe("marketplace dashboard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listOrders.mockResolvedValue([
            order("line-1", {
                [ORDER_FIELDS.CHANNEL]: "LINE",
                [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                [ORDER_FIELDS.TOTAL_AMOUNT]: 9999,
                [ORDER_FIELDS.CREATED_AT]: june23,
            }),
            order("lazada-1", {
                [ORDER_FIELDS.CHANNEL]: "Lazada",
                [ORDER_FIELDS.MARKETPLACE_STORE_ID]: "lz-store-1",
                [ORDER_FIELDS.MARKETPLACE_STORE_NAME]: "Lazada Main",
                [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                [ORDER_FIELDS.MARKETPLACE_STATUS]: "completed",
                [ORDER_FIELDS.TOTAL_AMOUNT]: 100,
                [ORDER_FIELDS.CREATED_AT]: june23,
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: june24,
            }),
            order("shopee-1", {
                [ORDER_FIELDS.CHANNEL]: "Shopee",
                [ORDER_FIELDS.MARKETPLACE_STORE_ID]: "sp-store-1",
                [ORDER_FIELDS.MARKETPLACE_STORE_NAME]: "Shopee Main",
                [ORDER_FIELDS.ORDER_STATUS]: "Ready to Ship",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                [ORDER_FIELDS.MARKETPLACE_STATUS]: "READY_TO_SHIP",
                [ORDER_FIELDS.TOTAL_AMOUNT]: 200,
                [ORDER_FIELDS.CREATED_AT]: june23,
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: june23,
            }),
            order("tiktok-1", {
                [ORDER_FIELDS.CHANNEL]: "TikTok",
                [ORDER_FIELDS.MARKETPLACE_STORE_ID]: "tt-store-1",
                [ORDER_FIELDS.MARKETPLACE_STORE_NAME]: "TikTok Main",
                [ORDER_FIELDS.ORDER_STATUS]: "Cancelled",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                [ORDER_FIELDS.MARKETPLACE_STATUS]: "CANCELLED",
                [ORDER_FIELDS.TOTAL_AMOUNT]: 300,
                [ORDER_FIELDS.CREATED_AT]: june24,
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: june24,
            }),
            order("lazada-2", {
                [ORDER_FIELDS.CHANNEL]: "Lazada",
                [ORDER_FIELDS.MARKETPLACE_STORE_ID]: "lz-store-1",
                [ORDER_FIELDS.MARKETPLACE_STORE_NAME]: "Lazada Main",
                [ORDER_FIELDS.ORDER_STATUS]: "Waiting Payment",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
                [ORDER_FIELDS.MARKETPLACE_STATUS]: "unpaid",
                [ORDER_FIELDS.TOTAL_AMOUNT]: 50,
                [ORDER_FIELDS.CREATED_AT]: june24,
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: june24,
            }),
        ]);
    });

    it("aggregates Shopee, Lazada and TikTok while excluding LINE", async () => {
        const result = await buildMarketplaceDashboardSummary(env);

        expect(result.totals.orders).toBe(4);
        expect(result.totals.stores).toBe(3);
        expect(result.totals.active).toBe(2);
        expect(result.totals.completed).toBe(1);
        expect(result.totals.cancelled).toBe(1);
        expect(result.totals.paid).toBe(2);
        expect(result.totals.waiting_payment).toBe(1);
        expect(result.totals.gross_order_value).toBe(350);
        expect(result.totals.paid_revenue).toBe(300);
        expect(result.totals.completed_revenue).toBe(100);
        expect(result.totals.average_order_value).toBe(116.67);
        expect(result.totals.latest_marketplace_update_at).toBe(june24);
        expect(result.by_channel).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    key: "Lazada",
                    orders: 2,
                    gross_order_value: 150,
                }),
                expect.objectContaining({
                    key: "Shopee",
                    orders: 1,
                    paid_revenue: 200,
                }),
                expect.objectContaining({
                    key: "TikTok",
                    orders: 1,
                    cancellation_rate_pct: 100,
                }),
            ])
        );
        expect(result.by_order_status).toEqual({
            Completed: 1,
            "Ready to Ship": 1,
            Cancelled: 1,
            "Waiting Payment": 1,
        });
    });

    it("filters by marketplace channel and Thailand date boundaries", async () => {
        const result = await buildMarketplaceDashboardSummary(env, {
            channel: "Lazada",
            date_from_ms: Date.parse("2026-06-24T00:00:00+07:00"),
            date_to_ms: Date.parse("2026-06-24T23:59:59.999+07:00"),
        });

        expect(result.totals.orders).toBe(1);
        expect(result.totals.waiting_payment).toBe(1);
        expect(result.by_channel.find((row) => row.key === "Lazada")?.orders).toBe(1);
        expect(result.by_channel.find((row) => row.key === "Shopee")?.orders).toBe(0);
    });

    it("filters by store without mixing stores across channels", async () => {
        const result = await buildMarketplaceDashboardSummary(env, {
            store_id: "lz-store-1",
        });

        expect(result.totals.orders).toBe(2);
        expect(result.by_store).toHaveLength(1);
        expect(result.by_store[0]).toEqual(
            expect.objectContaining({
                channel: "Lazada",
                store_id: "lz-store-1",
                store_name: "Lazada Main",
            })
        );
    });
});
