import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    CUSTOMER_FIELDS,
    NOTIFICATION_FIELDS,
} from "../../core/lark-fields";

const {
    getDashboardNotifications,
    getDashboardCustomers,
} = vi.hoisted(() => ({
    getDashboardNotifications: vi.fn(),
    getDashboardCustomers: vi.fn(),
}));

vi.mock("../dashboard-read/dashboard-read.records", () => ({
    getDashboardNotifications,
    getDashboardCustomers,
}));

import {
    getNotificationList,
    getNotificationUnreadCount,
} from "./notification-dashboard.service";

const env = {} as any;

beforeEach(() => {
    vi.clearAllMocks();
    getDashboardCustomers.mockResolvedValue([
        {
            record_id: "rec-customer-001",
            fields: {
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "ลูกค้าทดสอบ",
                [CUSTOMER_FIELDS.CHANNEL]: "LINE",
            },
        },
    ]);
});

describe("notification dashboard service", () => {
    it("normalize channel alias ใน payload ก่อนส่งให้ Frontend", async () => {
        getDashboardNotifications.mockResolvedValue([
            {
                record_id: "rec-notification-001",
                fields: {
                    [NOTIFICATION_FIELDS.EVENT_ID]: "PAYMENT_REVIEW:rec-order-001",
                    [NOTIFICATION_FIELDS.NOTIFICATION_TYPE]: "PAYMENT_REVIEW",
                    [NOTIFICATION_FIELDS.CUSTOMER]: ["rec-customer-001"],
                    [NOTIFICATION_FIELDS.MESSAGE]: "มีการชำระเงินรอตรวจสอบ",
                    [NOTIFICATION_FIELDS.STATUS]: "Sent",
                    [NOTIFICATION_FIELDS.CREATED_AT]: 1_780_000_000_000,
                    [NOTIFICATION_FIELDS.PAYLOAD_JSON]: JSON.stringify({
                        version: 1,
                        captured_at: 1_780_000_000_000,
                        customer_name: "ลูกค้าทดสอบ",
                        channel: "LINE OA",
                        order_number: "ORD-001",
                        total_amount: 1290,
                        slip_amount: 1290,
                        payment_status: "Payment Review",
                        order_status: "Payment Review",
                    }),
                },
            },
        ]);

        const result = await getNotificationList(env, {
            search: "",
            type: null,
            read: "all",
            page: 1,
            page_size: 10,
        });

        expect(result.items[0]).toMatchObject({
            notification_type: "PAYMENT_REVIEW",
            customer: {
                channel: "LINE",
            },
        });
    });


    it("นับ unread เฉพาะ PAYMENT_REVIEW เพื่อให้กระดิ่งไม่รวม Notification อื่น", async () => {
        const baseFields = {
            [NOTIFICATION_FIELDS.CUSTOMER]: ["rec-customer-001"],
            [NOTIFICATION_FIELDS.STATUS]: "Sent",
            [NOTIFICATION_FIELDS.CREATED_AT]: 1_780_000_000_000,
            [NOTIFICATION_FIELDS.PAYLOAD_JSON]: JSON.stringify({
                version: 1,
                captured_at: 1_780_000_000_000,
                customer_name: "ลูกค้าทดสอบ",
                channel: "LINE",
            }),
        };
        getDashboardNotifications.mockResolvedValue([
            {
                record_id: "rec-payment",
                fields: {
                    ...baseFields,
                    [NOTIFICATION_FIELDS.EVENT_ID]: "PAYMENT_REVIEW:rec-order-001",
                    [NOTIFICATION_FIELDS.NOTIFICATION_TYPE]: "PAYMENT_REVIEW",
                },
            },
            {
                record_id: "rec-hot-lead",
                fields: {
                    ...baseFields,
                    [NOTIFICATION_FIELDS.EVENT_ID]: "HOT_LEAD:rec-customer-001",
                    [NOTIFICATION_FIELDS.NOTIFICATION_TYPE]: "HOT_LEAD",
                },
            },
        ]);

        await expect(getNotificationUnreadCount(env)).resolves.toBe(1);
    });


    it("ไม่ส่ง Notification ประเภทอื่นเข้าศูนย์ตรวจสอบการชำระเงิน", async () => {
        getDashboardNotifications.mockResolvedValue([
            {
                record_id: "rec-notification-002",
                fields: {
                    [NOTIFICATION_FIELDS.EVENT_ID]: "SALE_WON:marketplace-order-001",
                    [NOTIFICATION_FIELDS.NOTIFICATION_TYPE]: "SALE_WON",
                    [NOTIFICATION_FIELDS.CUSTOMER]: ["rec-customer-001"],
                    [NOTIFICATION_FIELDS.MESSAGE]: "มีคำสั่งซื้อใหม่",
                    [NOTIFICATION_FIELDS.STATUS]: "Sent",
                    [NOTIFICATION_FIELDS.CREATED_AT]: 1_780_000_000_000,
                    [NOTIFICATION_FIELDS.PAYLOAD_JSON]: JSON.stringify({
                        version: 1,
                        captured_at: 1_780_000_000_000,
                        customer_name: "Marketplace Customer",
                        channel: "TikTok Shop Thailand",
                        order_number: "TT-001",
                    }),
                },
            },
        ]);

        const result = await getNotificationList(env, {
            search: "",
            type: null,
            read: "all",
            page: 1,
            page_size: 10,
        });

        expect(result.items).toEqual([]);
        expect(result.summary.total).toBe(0);
    });
});
