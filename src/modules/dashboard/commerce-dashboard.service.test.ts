import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    ACTIVITY_FIELDS,
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";
import { parseDashboardPeriod } from "./dashboard-period";

const { listCustomers, listPipelines, listOrders, listActivities } = vi.hoisted(() => ({
    listCustomers: vi.fn(),
    listPipelines: vi.fn(),
    listOrders: vi.fn(),
    listActivities: vi.fn(),
}));

vi.mock("../customers/customer.repository", () => ({ listCustomers }));
vi.mock("../pipeline/pipeline.repository", () => ({ listPipelines }));
vi.mock("../orders/order.repository", () => ({ listOrders }));
vi.mock("../activities/activity.repository", () => ({ listActivities }));

import {
    clearCommerceDashboardCache,
    getCommerceDashboardSummary,
} from "./commerce-dashboard.service";

const env = {
    LARK_APP_TOKEN: "app",
    CUSTOMERS_TABLE_ID: "customers",
    PIPELINE_TABLE_ID: "pipelines",
    ORDERS_TABLE_ID: "orders",
    ACTIVITIES_TABLE_ID: "activities",
} as any;
const now = new Date("2026-06-26T00:00:00.000Z").getTime();
const daysAgo = (days: number): number => now - days * 24 * 60 * 60 * 1_000;
const june = parseDashboardPeriod("month", "2026-06", now);

function activity(action: string, at: number, orderId = ""): Record<string, unknown> {
    return {
        record_id: `${action}-${at}`,
        fields: {
            [ACTIVITY_FIELDS.EVENT_ID]: `${action}-${at}`,
            [ACTIVITY_FIELDS.ACTION]: action,
            [ACTIVITY_FIELDS.CUSTOMER]: ["rec_customer_current"],
            [ACTIVITY_FIELDS.NEW_VALUE]: JSON.stringify({
                order_record_id: orderId,
                payment_status: action === "PAYMENT_VERIFIED" ? "Paid" : undefined,
            }),
            [ACTIVITY_FIELDS.CREATED_AT]: at,
        },
    };
}

describe("commerce dashboard summary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        clearCommerceDashboardCache();
        clearDashboardReadCache();

        listCustomers.mockResolvedValue([
            {
                record_id: "rec_customer_current",
                fields: {
                    [CUSTOMER_FIELDS.CUSTOMER_NAME]: "คุณมินท์",
                    [CUSTOMER_FIELDS.CHANNEL]: "LINE",
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
                    [CUSTOMER_FIELDS.HOT_LEAD]: true,
                    [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "rec_pipeline_open",
                    [CUSTOMER_FIELDS.SALES_OWNER]: "Sales A",
                    [CUSTOMER_FIELDS.PHONE]: "0812345678",
                    [CUSTOMER_FIELDS.CREATED_AT]: daysAgo(5),
                },
            },
            {
                record_id: "rec_customer_previous",
                fields: {
                    [CUSTOMER_FIELDS.CUSTOMER_NAME]: "คุณพลอย",
                    [CUSTOMER_FIELDS.CHANNEL]: "TikTok Shop",
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Interested",
                    [CUSTOMER_FIELDS.CREATED_AT]: daysAgo(35),
                },
            },
        ]);

        listPipelines.mockResolvedValue([
            {
                record_id: "rec_pipeline_open",
                fields: {
                    [PIPELINE_FIELDS.CUSTOMER]: ["rec_customer_current"],
                    [PIPELINE_FIELDS.STATUS]: "open",
                    [PIPELINE_FIELDS.STAGE]: "Closing",
                    [PIPELINE_FIELDS.CREATED_AT]: daysAgo(5),
                },
            },
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
                    [ORDER_FIELDS.CUSTOMER]: ["rec_customer_current"],
                    [ORDER_FIELDS.CUSTOMER_NAME]: "คุณมินท์",
                    [ORDER_FIELDS.PHONE]: "0812345678",
                    [ORDER_FIELDS.ADDRESS]: "กรุงเทพฯ",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 1_000,
                    [ORDER_FIELDS.SALES_OWNER]: "Sales A",
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
                record_id: "rec_order_review",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Payment Review",
                    [ORDER_FIELDS.ORDER_STATUS]: "Payment Review",
                    [ORDER_FIELDS.SLIP_ATTACHMENT]: [{ file_token: "file_review" }],
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 300,
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(2),
                },
            },
        ]);

        listActivities.mockResolvedValue([
            activity("PAYMENT_SLIP_RECEIVED", daysAgo(2), "rec_order_review"),
            activity("PAYMENT_VERIFIED", daysAgo(1), "rec_order_line"),
        ]);
    });

    it("returns real monthly analytics and current work queues from one source of truth", async () => {
        const result = await getCommerceDashboardSummary(env, "th", june, now);

        expect(result.period).toMatchObject({
            mode: "month",
            value: "2026-06",
            granularity: "day",
        });
        expect(result.totals).toEqual({
            revenue_thb: 1_000,
            total_leads: 1,
            close_rate_percent: 100,
            paid_orders: 1,
            pending_orders: 0,
        });
        expect(result.changes).toMatchObject({
            revenue_percent: 100,
            leads_percent: 0,
            close_rate_percent: 100,
            paid_orders_percent: 0,
        });
        expect(result.channels.find((item) => item.channel === "LINE")).toEqual({
            channel: "LINE",
            orders: 1,
            revenue_thb: 1_000,
            share_percent: 100,
        });
        expect(result.revenue_trend.current_period).toHaveLength(30);
        expect(
            result.revenue_trend.current_period.reduce(
                (sum, point) => sum + point.revenue_thb,
                0
            )
        ).toBe(1_000);
        expect(result.action_counts).toEqual({
            payment_review: 1,
            waiting_new_slip: 0,
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
                sales_owner: null,
                revenue_thb: 0,
                paid_orders: 0,
                active_leads: 1,
                hot_leads: 0,
            },
        ]);
        expect(result.order_statuses).toEqual([
            { status: "pending_review", count: 1 },
            { status: "waiting_new_slip", count: 0 },
            { status: "waiting_payment", count: 0 },
            { status: "waiting_delivery", count: 0 },
            { status: "ready_to_ship", count: 1 },
            { status: "in_progress", count: 0 },
            { status: "completed", count: 0 },
            { status: "cancelled", count: 0 },
        ]);
        expect(result.recent_activities[0]).toMatchObject({
            title: "ยืนยันการชำระเงินแล้ว",
            detail: "ลูกค้า คุณมินท์ · Order rec_order_line",
            type: "payment",
        });
    });

    it("filters every dashboard metric by the selected channel scope", async () => {
        const line = await getCommerceDashboardSummary(env, "th", june, now, "line");
        expect(line.totals).toMatchObject({ revenue_thb: 1_000, paid_orders: 1, total_leads: 1 });
        expect(line.channels.find((item) => item.channel === "LINE")).toMatchObject({
            orders: 1,
            revenue_thb: 1_000,
        });
        expect(line.action_counts).toMatchObject({
            payment_review: 1,
            ready_to_ship: 1,
            hot_leads: 1,
            marketplace_ready_to_ship: 0,
            total: 3,
        });
        expect(line.sales_performance.some((item) => item.sales_owner === "Sales B")).toBe(false);

        const marketplaces = await getCommerceDashboardSummary(
            env,
            "th",
            june,
            now,
            "marketplaces"
        );
        expect(marketplaces.totals).toMatchObject({ revenue_thb: 0, paid_orders: 0, total_leads: 0 });
        expect(marketplaces.action_counts).toMatchObject({
            payment_review: 0,
            ready_to_ship: 0,
            hot_leads: 0,
            marketplace_ready_to_ship: 1,
            total: 1,
        });
        expect(marketplaces.channels.find((item) => item.channel === "LINE")).toMatchObject({
            orders: 0,
            revenue_thb: 0,
        });
    });

    it("returns localized activity text", async () => {
        const result = await getCommerceDashboardSummary(env, "en", june, now);
        expect(result.recent_activities[0]).toMatchObject({
            title: "Payment verified",
            detail: "Customer คุณมินท์ · Order rec_order_line",
        });
    });

    it("classifies mutually exclusive operational queues and excludes terminal records", async () => {
        listCustomers.mockResolvedValue([
            {
                record_id: "rec_customer_valid",
                fields: {
                    [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Valid",
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
                    [CUSTOMER_FIELDS.PHONE]: "081-234-5678",
                },
            },
            {
                record_id: "rec_customer_invalid_phone",
                fields: {
                    [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Invalid Phone",
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Interested",
                    [CUSTOMER_FIELDS.PHONE]: "12345",
                },
            },
        ]);
        listPipelines.mockResolvedValue([]);
        listActivities.mockResolvedValue([
            activity("PAYMENT_SLIP_RECEIVED", daysAgo(3), "rec_rejected"),
            activity("PAYMENT_REVIEW_REJECTED", daysAgo(2), "rec_rejected"),
            activity("PAYMENT_REVIEW_REJECTED", daysAgo(3), "rec_new_slip"),
            activity("PAYMENT_SLIP_RECEIVED", daysAgo(2), "rec_new_slip"),
        ]);
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
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
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
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
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
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
                },
            },
            {
                record_id: "rec_line_review",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
                    [ORDER_FIELDS.ORDER_STATUS]: "Draft",
                    [ORDER_FIELDS.SLIP_ATTACHMENT]: [{ file_token: "file_001" }],
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
                },
            },
            {
                record_id: "rec_rejected",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
                    [ORDER_FIELDS.ORDER_STATUS]: "Draft",
                    [ORDER_FIELDS.SLIP_ATTACHMENT]: [{ file_token: "old" }],
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
                },
            },
            {
                record_id: "rec_new_slip",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
                    [ORDER_FIELDS.ORDER_STATUS]: "Draft",
                    [ORDER_FIELDS.SLIP_ATTACHMENT]: [{ file_token: "new" }],
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
                },
            },
            {
                record_id: "rec_line_waiting",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
                    [ORDER_FIELDS.ORDER_STATUS]: "Draft",
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
                },
            },
            {
                record_id: "rec_market_ready",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "TikTok Shop",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.ORDER_STATUS]: "Processing",
                    [ORDER_FIELDS.MARKETPLACE_STATUS]: "READY_TO_SHIP",
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
                },
            },
            {
                record_id: "rec_market_completed",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "Shopee",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.ORDER_STATUS]: "Delivered",
                    [ORDER_FIELDS.MARKETPLACE_STATUS]: "Delivered",
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
                },
            },
            {
                record_id: "rec_cancelled",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "Lazada",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Pending",
                    [ORDER_FIELDS.ORDER_STATUS]: "Cancelled",
                    [ORDER_FIELDS.CREATED_AT]: daysAgo(1),
                },
            },
        ]);

        const result = await getCommerceDashboardSummary(env, "th", june, now);

        expect(result.action_counts).toEqual({
            payment_review: 2,
            waiting_new_slip: 1,
            waiting_payment: 1,
            missing_delivery: 2,
            ready_to_ship: 1,
            hot_leads: 0,
            marketplace_ready_to_ship: 1,
            total: 8,
        });
        expect(result.order_statuses).toEqual([
            { status: "pending_review", count: 2 },
            { status: "waiting_new_slip", count: 1 },
            { status: "waiting_payment", count: 1 },
            { status: "waiting_delivery", count: 2 },
            { status: "ready_to_ship", count: 2 },
            { status: "in_progress", count: 0 },
            { status: "completed", count: 1 },
            { status: "cancelled", count: 1 },
        ]);
    });

    it("uses paid orders consistently for revenue and channel order counts", async () => {
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

        const result = await getCommerceDashboardSummary(env, "th", june, now);
        expect(result.channels.find((item) => item.channel === "LINE")).toEqual({
            channel: "LINE",
            orders: 1,
            revenue_thb: 900,
            share_percent: 100,
        });
        expect(result.totals).toMatchObject({ revenue_thb: 900, paid_orders: 1 });
    });

    it("groups monthly trend by Asia/Bangkok date at the UTC boundary", async () => {
        const period = parseDashboardPeriod("month", "2026-06", now);
        listCustomers.mockResolvedValue([]);
        listPipelines.mockResolvedValue([]);
        listActivities.mockResolvedValue([]);
        listOrders.mockResolvedValue([
            {
                record_id: "rec_june_20",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 700,
                    [ORDER_FIELDS.PAID_AT]: new Date("2026-06-19T17:00:00.000Z").getTime(),
                },
            },
            {
                record_id: "rec_june_19",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 300,
                    [ORDER_FIELDS.PAID_AT]: new Date("2026-06-19T16:59:59.999Z").getTime(),
                },
            },
        ]);

        const result = await getCommerceDashboardSummary(env, "th", period, now);
        expect(result.revenue_trend.current_period.find((point) => point.key === "2026-06-20")).toMatchObject({
            revenue_thb: 700,
            paid_orders: 1,
        });
        expect(result.revenue_trend.current_period.find((point) => point.key === "2026-06-19")).toMatchObject({
            revenue_thb: 300,
            paid_orders: 1,
        });
    });

    it("includes real May and June records in a custom May-June range", async () => {
        const range = parseDashboardPeriod(
            "range",
            "2026-05-01..2026-06-29",
            Date.parse("2026-06-29T16:59:00.000Z")
        );
        const result = await getCommerceDashboardSummary(env, "th", range, now);

        expect(result.period).toMatchObject({
            mode: "range",
            value: "2026-05-01..2026-06-29",
            granularity: "week",
        });
        expect(result.totals).toMatchObject({
            revenue_thb: 1_500,
            paid_orders: 2,
            total_leads: 2,
        });
        expect(
            result.revenue_trend.current_period.reduce(
                (sum, point) => sum + point.revenue_thb,
                0
            )
        ).toBe(1_500);
    });

    it("returns complete zero-state structures", async () => {
        listCustomers.mockResolvedValue([]);
        listPipelines.mockResolvedValue([]);
        listOrders.mockResolvedValue([]);
        listActivities.mockResolvedValue([]);

        const result = await getCommerceDashboardSummary(env, "th", june, now);

        expect(result.totals).toEqual({
            revenue_thb: 0,
            total_leads: 0,
            close_rate_percent: 0,
            paid_orders: 0,
            pending_orders: 0,
        });
        expect(result.revenue_trend.current_period).toHaveLength(30);
        expect(result.revenue_trend.previous_period).toHaveLength(31);
        expect(result.revenue_trend.current_period.every((point) => point.revenue_thb === 0)).toBe(true);
        expect(result.channels).toHaveLength(4);
        expect(result.pipeline_stages).toHaveLength(6);
        expect(result.order_statuses).toHaveLength(8);
        expect(result.sales_performance).toEqual([]);
        expect(result.action_counts.total).toBe(0);
    });

    it("uses short summary and shared record caches", async () => {
        await getCommerceDashboardSummary(env, "th", june, now);
        await getCommerceDashboardSummary(env, "th", june, now + 1_000);

        expect(listCustomers).toHaveBeenCalledTimes(1);
        expect(listPipelines).toHaveBeenCalledTimes(1);
        expect(listOrders).toHaveBeenCalledTimes(1);
        expect(listActivities).toHaveBeenCalledTimes(1);
    });
});
