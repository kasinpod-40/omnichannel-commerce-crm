import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_FIELDS, ORDER_FIELDS } from "../../core/lark-fields";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";

const { listCustomers, listOrders } = vi.hoisted(() => ({
    listCustomers: vi.fn(),
    listOrders: vi.fn(),
}));
vi.mock("../customers/customer.repository", () => ({ listCustomers }));
vi.mock("./order.repository", () => ({ listOrders }));

import { getOrderDetail, getOrderList } from "./order-dashboard.service";

const env = {
    LARK_APP_TOKEN: "app",
    CUSTOMERS_TABLE_ID: "customers",
    ORDERS_TABLE_ID: "orders",
} as any;

beforeEach(() => {
    vi.clearAllMocks();
    clearDashboardReadCache();
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
                [ORDER_FIELDS.EXTERNAL_ORDER_ID]: "tt-001",
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
        const result = await getOrderList(env, {
            search: "",
            channel: null,
            order_status: null,
            payment_status: null,
            sort: "updated_desc",
            page: 1,
            page_size: 10,
        });
        expect(result.items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                order_id: "rec_order_1",
                order_status: "Draft",
                payment_status: "Pending",
            }),
            expect.objectContaining({
                order_id: "rec_order_2",
                channel: "TikTok Shop",
                order_status: "Completed",
                sync_status: "synced",
            }),
        ]));
    });

    it("Pagination ปรับเลขหน้าที่เกินกลับหน้าสุดท้าย", async () => {
        const result = await getOrderList(env, {
            search: "",
            channel: null,
            order_status: null,
            payment_status: null,
            sort: "updated_desc",
            page: 99,
            page_size: 1,
        });
        expect(result.page).toBe(2);
        expect(result.total_pages).toBe(2);
        expect((await getOrderDetail(env, result.items[0]!.order_id))?.order_id).toBe(result.items[0]!.order_id);
    });
});
