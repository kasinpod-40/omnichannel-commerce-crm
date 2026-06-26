import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    ACTIVITY_FIELDS,
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";

const {
    listCustomers,
    listPipelines,
    listOrders,
    listActivities,
} = vi.hoisted(() => ({
    listCustomers: vi.fn(),
    listPipelines: vi.fn(),
    listOrders: vi.fn(),
    listActivities: vi.fn(),
}));

vi.mock("../customers/customer.repository", () => ({
    listCustomers,
}));
vi.mock("../pipeline/pipeline.repository", () => ({
    listPipelines,
}));
vi.mock("../orders/order.repository", () => ({
    listOrders,
}));
vi.mock("../activities/activity.repository", () => ({
    listActivities,
}));

import {
    clearCommerceDashboardCache,
    getCommerceDashboardSummary,
} from "./commerce-dashboard.service";

const env = {} as any;
const now = new Date("2026-06-26T00:00:00.000Z").getTime();
const daysAgo = (days: number): number =>
    now - days * 24 * 60 * 60 * 1_000;

describe("commerce dashboard summary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearCommerceDashboardCache();

        listCustomers.mockResolvedValue([
            {
                record_id: "rec_customer_current",
                fields: {
                    [CUSTOMER_FIELDS.CREATED_AT]: daysAgo(5),
                },
            },
            {
                record_id: "rec_customer_previous",
                fields: {
                    [CUSTOMER_FIELDS.CREATED_AT]: daysAgo(35),
                },
            },
        ]);

        listPipelines.mockResolvedValue([
            {
                record_id: "rec_pipeline_won",
                fields: {
                    [PIPELINE_FIELDS.STATUS]: "won",
                    [PIPELINE_FIELDS.CLOSED_AT]: daysAgo(4),
                },
            },
            {
                record_id: "rec_pipeline_lost",
                fields: {
                    [PIPELINE_FIELDS.STATUS]: "lost",
                    [PIPELINE_FIELDS.CLOSED_AT]: daysAgo(34),
                },
            },
        ]);

        listOrders.mockResolvedValue([
            {
                record_id: "rec_order_line",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 1_000,
                    [ORDER_FIELDS.PAID_AT]: daysAgo(3),
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(5),
                },
            },
            {
                record_id: "rec_order_tiktok",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "TikTok",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 500,
                    [ORDER_FIELDS.PAID_AT]: daysAgo(33),
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(34),
                },
            },
            {
                record_id: "rec_order_pending",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "Shopee",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Payment Review",
                    [ORDER_FIELDS.ORDER_STATUS]: "Payment Review",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 300,
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(2),
                },
            },
        ]);

        listActivities.mockResolvedValue([
            {
                record_id: "rec_activity_old",
                fields: {
                    [ACTIVITY_FIELDS.EVENT_ID]: "evt-old",
                    [ACTIVITY_FIELDS.ACTION]: "PIPELINE_CREATED",
                    [ACTIVITY_FIELDS.NEW_VALUE]: JSON.stringify({
                        pipeline_record_id: "rec_pipeline_001",
                    }),
                    [ACTIVITY_FIELDS.CREATED_AT]: daysAgo(2),
                },
            },
            {
                record_id: "rec_activity_new",
                fields: {
                    [ACTIVITY_FIELDS.EVENT_ID]: "evt-new",
                    [ACTIVITY_FIELDS.ACTION]: "PAYMENT_VERIFIED",
                    [ACTIVITY_FIELDS.NEW_VALUE]: JSON.stringify({
                        order_record_id: "rec_order_line",
                        payment_status: "Paid",
                    }),
                    [ACTIVITY_FIELDS.CREATED_AT]: daysAgo(1),
                },
            },
        ]);
    });

    it("คืน Contract ที่ Frontend ใช้พร้อมยอดจริงแยกช่องทาง", async () => {
        const result = await getCommerceDashboardSummary(
            env,
            "th",
            now
        );

        expect(result.totals).toEqual({
            revenue_thb: 1_500,
            total_leads: 2,
            close_rate_percent: 50,
            pending_orders: 1,
        });
        expect(result.changes).toMatchObject({
            revenue_percent: 100,
            leads_percent: 0,
            close_rate_percent: 100,
            pending_orders_percent: 100,
        });
        expect(result.channels).toEqual(
            expect.arrayContaining([
                {
                    channel: "LINE",
                    orders: 1,
                    revenue_thb: 1_000,
                    share_percent: 66.67,
                },
                {
                    channel: "TikTok Shop",
                    orders: 1,
                    revenue_thb: 500,
                    share_percent: 33.33,
                },
                {
                    channel: "Shopee",
                    orders: 1,
                    revenue_thb: 0,
                    share_percent: 0,
                },
            ])
        );
        expect(result.recent_activities[0]).toMatchObject({
            id: "evt-new",
            title: "ยืนยันการชำระเงินแล้ว",
            type: "payment",
        });
    });

    it("คืนชื่อกิจกรรมภาษาอังกฤษเมื่อ Frontend ส่ง lang=en", async () => {
        const result = await getCommerceDashboardSummary(
            env,
            "en",
            now
        );

        expect(result.recent_activities[0]?.title).toBe(
            "Payment verified"
        );
        expect(result.recent_activities[0]?.detail).toContain(
            "Order rec_order_line"
        );
    });

    it("ใช้ Cache สั้นเพื่อลดการดึง Lark ซ้ำจาก React Query", async () => {
        await getCommerceDashboardSummary(env, "th", now);
        await getCommerceDashboardSummary(env, "th", now + 1_000);

        expect(listCustomers).toHaveBeenCalledTimes(1);
        expect(listPipelines).toHaveBeenCalledTimes(1);
        expect(listOrders).toHaveBeenCalledTimes(1);
        expect(listActivities).toHaveBeenCalledTimes(1);
    });
});
