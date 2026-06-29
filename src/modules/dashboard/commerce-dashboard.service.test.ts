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
                    [CUSTOMER_FIELDS.CUSTOMER_NAME]: "คุณมินท์",
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
                    [CUSTOMER_FIELDS.HOT_LEAD]: true,
                    [CUSTOMER_FIELDS.SALES_OWNER]: "Sales A",
                    [CUSTOMER_FIELDS.PHONE]: "0812345678",
                    [CUSTOMER_FIELDS.CREATED_AT]: daysAgo(5),
                },
            },
            {
                record_id: "rec_customer_previous",
                fields: {
                    [CUSTOMER_FIELDS.CUSTOMER_NAME]: "คุณพลอย",
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Interested",
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
                    [ORDER_FIELDS.SALES_OWNER]: "Sales A",
                    [ORDER_FIELDS.ADDRESS]: "กรุงเทพฯ",
                    [ORDER_FIELDS.CUSTOMER]: ["rec_customer_current"],
                    [ORDER_FIELDS.PAID_AT]: daysAgo(3),
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(5),
                },
            },
            {
                record_id: "rec_order_tiktok",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "TikTok",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.ORDER_STATUS]: "Ready to Ship",
                    [ORDER_FIELDS.MARKETPLACE_STATUS]: "READY_TO_SHIP",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 500,
                    [ORDER_FIELDS.SALES_OWNER]: "Sales B",
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
                    [ACTIVITY_FIELDS.CUSTOMER]: ["rec_customer_current"],
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
            pending_orders: 2,
        });
        expect(result.changes).toMatchObject({
            revenue_percent: 100,
            leads_percent: 0,
            close_rate_percent: 100,
            pending_orders_percent: 0,
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
                    orders: 0,
                    revenue_thb: 0,
                    share_percent: 0,
                },
            ])
        );
        expect(result.revenue_trend.current_period).toHaveLength(7);
        expect(result.revenue_trend.current_period.reduce(
            (sum, point) => sum + point.revenue_thb,
            0
        )).toBe(1_000);
        expect(result.action_counts).toEqual({
            payment_review: 1,
            waiting_payment: 0,
            missing_delivery: 0,
            ready_to_ship: 1,
            hot_leads: 1,
            marketplace_ready_to_ship: 1,
            total: 4,
        });
        expect(result.pipeline_stages).toEqual([
            { stage: "New Lead", count: 0 },
            { stage: "Interested", count: 1 },
            { stage: "Negotiating", count: 0 },
            { stage: "Closing", count: 1 },
            { stage: "Won", count: 0 },
            { stage: "Lost", count: 0 },
        ]);
        expect(result.sales_performance).toEqual([
            {
                sales_owner: "Sales A",
                revenue_thb: 1_000,
                paid_orders: 1,
                active_leads: 1,
                hot_leads: 1,
            },
            {
                sales_owner: "Sales B",
                revenue_thb: 500,
                paid_orders: 1,
                active_leads: 0,
                hot_leads: 0,
            },
            {
                sales_owner: null,
                revenue_thb: 0,
                paid_orders: 0,
                active_leads: 1,
                hot_leads: 0,
            },
        ]);
        expect(result.order_statuses).toEqual([
            { status: "pending_review", count: 1 },
            { status: "waiting_payment", count: 0 },
            { status: "waiting_delivery", count: 0 },
            { status: "ready_to_ship", count: 1 },
            { status: "in_progress", count: 1 },
            { status: "completed", count: 0 },
            { status: "cancelled", count: 0 },
        ]);
        expect(result.recent_activities[0]).toMatchObject({
            id: "evt-new",
            title: "ยืนยันการชำระเงินแล้ว",
            detail: "ลูกค้า คุณมินท์ · Order rec_order_line · Paid",
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
        expect(result.recent_activities[0]?.detail).toBe(
            "Customer คุณมินท์ · Order rec_order_line · Paid"
        );
    });


    it("จัดกลุ่มสถานะ Order จริงโดยใช้ Payment, หลักฐาน และข้อมูลจัดส่งชุดเดียวกับหน้า Orders", async () => {
        listCustomers.mockResolvedValue([
            {
                record_id: "rec_customer_valid",
                fields: {
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
                    [CUSTOMER_FIELDS.PHONE]: "081-234-5678",
                },
            },
            {
                record_id: "rec_customer_invalid_phone",
                fields: {
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Interested",
                    [CUSTOMER_FIELDS.PHONE]: "12345",
                },
            },
        ]);
        listPipelines.mockResolvedValue([]);
        listActivities.mockResolvedValue([]);
        listOrders.mockResolvedValue([
            {
                record_id: "rec_line_ready",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.CUSTOMER]: ["rec_customer_valid"],
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.ADDRESS]: "99/1 กรุงเทพฯ",
                },
            },
            {
                record_id: "rec_line_missing_address",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE OA",
                    [ORDER_FIELDS.CUSTOMER]: ["rec_customer_valid"],
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.ADDRESS]: "",
                },
            },
            {
                record_id: "rec_line_invalid_phone",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.CUSTOMER]: ["rec_customer_invalid_phone"],
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.ADDRESS]: "เชียงใหม่",
                },
            },
            {
                record_id: "rec_line_review",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
                    [ORDER_FIELDS.ORDER_STATUS]: "Draft",
                    [ORDER_FIELDS.SLIP_ATTACHMENT]: [{ file_token: "file_001" }],
                },
            },
            {
                record_id: "rec_line_waiting",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
                    [ORDER_FIELDS.ORDER_STATUS]: "Draft",
                },
            },
            {
                record_id: "rec_market_ready",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "TikTok Shop",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.ORDER_STATUS]: "Processing",
                    [ORDER_FIELDS.MARKETPLACE_STATUS]: "READY_TO_SHIP",
                },
            },
            {
                record_id: "rec_market_completed",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "Shopee",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.ORDER_STATUS]: "Delivered",
                },
            },
            {
                record_id: "rec_cancelled",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "Lazada",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Pending",
                    [ORDER_FIELDS.ORDER_STATUS]: "Cancelled",
                },
            },
        ]);

        const result = await getCommerceDashboardSummary(env, "th", now);

        expect(result.order_statuses).toEqual([
            { status: "pending_review", count: 1 },
            { status: "waiting_payment", count: 1 },
            { status: "waiting_delivery", count: 2 },
            { status: "ready_to_ship", count: 1 },
            { status: "in_progress", count: 1 },
            { status: "completed", count: 1 },
            { status: "cancelled", count: 1 },
        ]);
        expect(result.action_counts).toEqual({
            payment_review: 1,
            waiting_payment: 1,
            missing_delivery: 2,
            ready_to_ship: 1,
            hot_leads: 0,
            marketplace_ready_to_ship: 1,
            total: 6,
        });
    });

    it("นับจำนวน Order ใน Donut จากฐาน Paid เดียวกับยอดขาย ไม่รวม Draft หรือ Payment Review", async () => {
        listCustomers.mockResolvedValue([]);
        listPipelines.mockResolvedValue([]);
        listActivities.mockResolvedValue([]);
        listOrders.mockResolvedValue([
            {
                record_id: "rec_paid",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 900,
                    [ORDER_FIELDS.PAID_AT]: daysAgo(1),
                },
            },
            {
                record_id: "rec_unpaid",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
                    [ORDER_FIELDS.ORDER_STATUS]: "Draft",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 500,
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
                },
            },
        ]);

        const result = await getCommerceDashboardSummary(env, "th", now);
        const line = result.channels.find((item) => item.channel === "LINE");

        expect(line).toEqual({
            channel: "LINE",
            orders: 1,
            revenue_thb: 900,
            share_percent: 100,
        });
        expect(result.totals.revenue_thb).toBe(900);
    });

    it("แบ่งวันของกราฟตาม Asia/Bangkok ที่ขอบเที่ยงคืน ไม่ใช้วัน UTC", async () => {
        const bangkokNow = new Date("2026-06-26T16:30:00.000Z").getTime();
        listCustomers.mockResolvedValue([]);
        listPipelines.mockResolvedValue([]);
        listActivities.mockResolvedValue([]);
        listOrders.mockResolvedValue([
            {
                record_id: "rec_current_boundary",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 700,
                    [ORDER_FIELDS.PAID_AT]: new Date("2026-06-19T17:00:00.000Z").getTime(),
                },
            },
            {
                record_id: "rec_previous_boundary",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 300,
                    [ORDER_FIELDS.PAID_AT]: new Date("2026-06-19T16:59:59.999Z").getTime(),
                },
            },
        ]);

        const result = await getCommerceDashboardSummary(env, "th", bangkokNow);

        expect(result.revenue_trend.current_period[0]).toMatchObject({
            date: "2026-06-20",
            revenue_thb: 700,
            paid_orders: 1,
        });
        expect(result.revenue_trend.previous_period[6]).toMatchObject({
            date: "2026-06-19",
            revenue_thb: 300,
            paid_orders: 1,
        });
    });

    it("คืนโครงกราฟครบพร้อมศูนย์เมื่อ Lark ยังไม่มีข้อมูล", async () => {
        listCustomers.mockResolvedValue([]);
        listPipelines.mockResolvedValue([]);
        listOrders.mockResolvedValue([]);
        listActivities.mockResolvedValue([]);

        const result = await getCommerceDashboardSummary(env, "th", now);

        expect(result.totals).toEqual({
            revenue_thb: 0,
            total_leads: 0,
            close_rate_percent: 0,
            pending_orders: 0,
        });
        expect(result.revenue_trend.current_period).toHaveLength(7);
        expect(result.revenue_trend.previous_period).toHaveLength(7);
        expect(result.revenue_trend.current_period.every((point) => point.revenue_thb === 0)).toBe(true);
        expect(result.channels).toHaveLength(4);
        expect(result.pipeline_stages).toHaveLength(6);
        expect(result.order_statuses).toHaveLength(7);
        expect(result.sales_performance).toEqual([]);
        expect(result.action_counts.total).toBe(0);
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
