import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_FIELDS, CUSTOMER_FIELDS, ORDER_FIELDS } from "../../core/lark-fields";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";

const { listCustomers, listOrders, listActivities } = vi.hoisted(() => ({
    listCustomers: vi.fn(),
    listOrders: vi.fn(),
    listActivities: vi.fn(),
}));
vi.mock("../customers/customer.repository", () => ({ listCustomers }));
vi.mock("./order.repository", () => ({ listOrders }));
vi.mock("../activities/activity.repository", () => ({ listActivities }));

import { getOrderDetail, getOrderList } from "./order-dashboard.service";

const env = {
    LARK_APP_TOKEN: "app",
    CUSTOMERS_TABLE_ID: "customers",
    ORDERS_TABLE_ID: "orders",
    ACTIVITIES_TABLE_ID: "activities",
} as any;

const baseQuery = {
    search: "",
    channel: null,
    order_status: null,
    payment_status: null,
    work_queue: null,
    date_basis: null,
    date_from_ms: null,
    date_to_ms: null,
    sort: "updated_desc" as const,
    page: 1,
    page_size: 10,
};

beforeEach(() => {
    vi.clearAllMocks();
    clearDashboardReadCache();
    listActivities.mockResolvedValue([]);
    listCustomers.mockResolvedValue([{
        record_id: "rec_customer_1",
        fields: {
            [CUSTOMER_FIELDS.CUSTOMER_NAME]: "คุณมินท์",
            [CUSTOMER_FIELDS.CHANNEL]: "LINE",
            [CUSTOMER_FIELDS.PHONE]: "0891234567",
            [CUSTOMER_FIELDS.SALES_OWNER]: "Sales A",
        },
    }]);
    listOrders.mockResolvedValue([
        {
            record_id: "rec_order_1",
            fields: {
                [ORDER_FIELDS.CUSTOMER]: ["rec_customer_1"],
                [ORDER_FIELDS.CHANNEL]: "LINE",
                [ORDER_FIELDS.ORDER_NUMBER]: [{ text: "ORD-20260630-024117-6F9E27" }],
                [ORDER_FIELDS.PRODUCT_NAME]: "สินค้า A",
                [ORDER_FIELDS.QUANTITY]: 2,
                [ORDER_FIELDS.TOTAL_AMOUNT]: 1000,
                [ORDER_FIELDS.ORDER_STATUS]: "Payment Review",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
                [ORDER_FIELDS.CREATED_AT]: 1_780_000_000_000,
                [ORDER_FIELDS.UPDATED_AT]: 1_780_000_100_000,
            },
        },
        {
            record_id: "rec_order_2",
            fields: {
                [ORDER_FIELDS.CUSTOMER]: ["rec_customer_1"],
                [ORDER_FIELDS.CHANNEL]: "TikTok",
                [ORDER_FIELDS.ORDER_NUMBER]: "ORD-INTERNAL-MARKETPLACE-001",
                [ORDER_FIELDS.EXTERNAL_ORDER_ID]: { value: "tt-001" },
                [ORDER_FIELDS.PRODUCT_NAME]: "สินค้า B",
                [ORDER_FIELDS.QUANTITY]: 1,
                [ORDER_FIELDS.TOTAL_AMOUNT]: 500,
                [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                [ORDER_FIELDS.MARKETPLACE_EVENT_ID]: "event-1",
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: 1_780_000_200_000,
                [ORDER_FIELDS.CREATED_AT]: 1_780_000_050_000,
                [ORDER_FIELDS.UPDATED_AT]: 1_780_000_200_000,
            },
        },
    ]);
});

describe("order dashboard service", () => {
    it("normalize สถานะ Backend ให้ตรง Contract ของ Frontend", async () => {
        const result = await getOrderList(env, baseQuery);
        expect(result.items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                order_id: "rec_order_1",
                order_number: "ORD-20260630-024117-6F9E27",
                display_order_number: "ORD-20260630-024117-6F9E27",
                order_status: "Draft",
                payment_status: "Pending",
            }),
            expect.objectContaining({
                order_id: "rec_order_2",
                channel: "TikTok Shop",
                order_number: "ORD-INTERNAL-MARKETPLACE-001",
                external_order_id: "tt-001",
                display_order_number: "tt-001",
                order_status: "Completed",
                sync_status: "synced",
            }),
        ]));
    });

    it("Pagination ปรับเลขหน้าที่เกินกลับหน้าสุดท้าย", async () => {
        const result = await getOrderList(env, { ...baseQuery, page: 99, page_size: 1 });
        expect(result.page).toBe(2);
        expect(result.total_pages).toBe(2);
        expect((await getOrderDetail(env, result.items[0]!.order_id))?.order_id).toBe(result.items[0]!.order_id);
    });

    it("ใช้ Work Queue เดียวกับ Action Center และคืนเฉพาะรายการที่ตรง Queue", async () => {
        listCustomers.mockResolvedValue([{
            record_id: "rec_customer_1",
            fields: {
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "คุณมินท์",
                [CUSTOMER_FIELDS.PHONE]: "0812345678",
            },
        }]);
        listOrders.mockResolvedValue([
            {
                record_id: "review",
                fields: {
                    [ORDER_FIELDS.CUSTOMER]: ["rec_customer_1"],
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.ORDER_STATUS]: "Draft",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Pending",
                    [ORDER_FIELDS.SLIP_ATTACHMENT]: [{ file_token: "review" }],
                    [ORDER_FIELDS.CREATED_AT]: 1_780_000_000_000,
                },
            },
            {
                record_id: "new-slip",
                fields: {
                    [ORDER_FIELDS.CUSTOMER]: ["rec_customer_1"],
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.ORDER_STATUS]: "Draft",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Pending",
                    [ORDER_FIELDS.SLIP_ATTACHMENT]: [{ file_token: "old" }],
                    [ORDER_FIELDS.CREATED_AT]: 1_780_000_000_000,
                },
            },
            {
                record_id: "waiting",
                fields: {
                    [ORDER_FIELDS.CUSTOMER]: ["rec_customer_1"],
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.ORDER_STATUS]: "Draft",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Pending",
                    [ORDER_FIELDS.CREATED_AT]: 1_780_000_000_000,
                },
            },
            {
                record_id: "missing",
                fields: {
                    [ORDER_FIELDS.CUSTOMER]: ["rec_customer_1"],
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
                    [ORDER_FIELDS.ADDRESS]: "",
                    [ORDER_FIELDS.CREATED_AT]: 1_780_000_000_000,
                },
            },
            {
                record_id: "ready",
                fields: {
                    [ORDER_FIELDS.CUSTOMER]: ["rec_customer_1"],
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
                    [ORDER_FIELDS.ADDRESS]: "กรุงเทพฯ",
                    [ORDER_FIELDS.CREATED_AT]: 1_780_000_000_000,
                },
            },
            {
                record_id: "market-ready",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "Shopee",
                    [ORDER_FIELDS.ORDER_STATUS]: "Processing",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.MARKETPLACE_STATUS]: "READY_TO_SHIP",
                    [ORDER_FIELDS.CREATED_AT]: 1_780_000_000_000,
                },
            },
            {
                record_id: "cancelled",
                fields: {
                    [ORDER_FIELDS.CHANNEL]: "LINE",
                    [ORDER_FIELDS.ORDER_STATUS]: "Cancelled",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Pending",
                    [ORDER_FIELDS.CREATED_AT]: 1_780_000_000_000,
                },
            },
        ]);
        listActivities.mockResolvedValue([
            {
                record_id: "slip-old",
                fields: {
                    [ACTIVITY_FIELDS.ACTION]: "PAYMENT_SLIP_RECEIVED",
                    [ACTIVITY_FIELDS.CREATED_AT]: 100,
                    [ACTIVITY_FIELDS.NEW_VALUE]: JSON.stringify({ order_record_id: "new-slip" }),
                },
            },
            {
                record_id: "reject-new",
                fields: {
                    [ACTIVITY_FIELDS.ACTION]: "PAYMENT_REVIEW_REJECTED",
                    [ACTIVITY_FIELDS.CREATED_AT]: 200,
                    [ACTIVITY_FIELDS.NEW_VALUE]: JSON.stringify({ order_record_id: "new-slip" }),
                },
            },
        ]);

        const expected = {
            payment_review: "review",
            waiting_new_slip: "new-slip",
            waiting_payment: "waiting",
            missing_delivery: "missing",
            ready_to_ship: "ready",
            marketplace_ready_to_ship: "market-ready",
        } as const;

        for (const [workQueue, orderId] of Object.entries(expected)) {
            const result = await getOrderList(env, {
                ...baseQuery,
                work_queue: workQueue as keyof typeof expected,
                page_size: 20,
            });
            expect(result.total, workQueue).toBe(1);
            expect(result.items[0]).toMatchObject({
                order_id: orderId,
                work_queue: workQueue,
            });
            expect(result.applied_filters.work_queue).toBe(workQueue);
        }

        const waiting = await getOrderList(env, {
            ...baseQuery,
            work_queue: "waiting_payment",
        });
        expect(waiting.items.some((item) => item.order_id === "cancelled")).toBe(false);
    });
});
