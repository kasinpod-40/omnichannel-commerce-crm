import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    ACTIVITY_FIELDS,
    CONVERSATION_FIELDS,
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";

const {
    listCustomers,
    getCustomerByRecordId,
    listConversations,
    listActivities,
    findOrdersByCustomer,
    listPipelines,
} = vi.hoisted(() => ({
    listCustomers: vi.fn(),
    getCustomerByRecordId: vi.fn(),
    listConversations: vi.fn(),
    listActivities: vi.fn(),
    findOrdersByCustomer: vi.fn(),
    listPipelines: vi.fn(),
}));

vi.mock("./customer.repository", () => ({
    listCustomers,
    getCustomerByRecordId,
}));
vi.mock("../conversations/conversation.repository", () => ({
    listConversations,
}));
vi.mock("../activities/activity.repository", () => ({
    listActivities,
}));
vi.mock("../orders/order.repository", () => ({
    findOrdersByCustomer,
}));
vi.mock("../pipeline/pipeline.repository", () => ({
    listPipelines,
}));

import {
    getCustomerDetail,
    getCustomerList,
} from "./customer-dashboard.service";

const env = {} as any;
const customer = {
    record_id: "rec_customer_001",
    fields: {
        [CUSTOMER_FIELDS.CUSTOMER_NAME]: "คุณมินท์",
        [CUSTOMER_FIELDS.CHANNEL]: "LINE",
        [CUSTOMER_FIELDS.CHANNEL_CUSTOMER_ID]: "line-user-001",
        [CUSTOMER_FIELDS.PHONE]: "0891234567",
        [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
        [CUSTOMER_FIELDS.LEAD_SCORE]: 94,
        [CUSTOMER_FIELDS.HOT_LEAD]: true,
        [CUSTOMER_FIELDS.AI_SUMMARY]: "ต้องการสินค้า 10 ตัว",
        [CUSTOMER_FIELDS.LAST_MESSAGE]: "ส่งที่อยู่ให้แล้วค่ะ",
        [CUSTOMER_FIELDS.MESSAGE_COUNT]: 5,
        [CUSTOMER_FIELDS.PRODUCT_NAME]: "เสื้อรุ่นใหม่",
        [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "rec_pipeline_001",
        [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "rec_order_001",
        [CUSTOMER_FIELDS.SALES_OWNER]: "Sales A",
        [CUSTOMER_FIELDS.CREATED_AT]: 1_780_000_000_000,
        [CUSTOMER_FIELDS.UPDATED_AT]: 1_780_000_100_000,
    },
};

beforeEach(() => {
    vi.clearAllMocks();
    clearDashboardReadCache();
    listPipelines.mockResolvedValue([{
        record_id: "rec_pipeline_001",
        fields: {
            [PIPELINE_FIELDS.CUSTOMER]: ["rec_customer_001"],
            [PIPELINE_FIELDS.STATUS]: "open",
            [PIPELINE_FIELDS.STAGE]: "Closing",
        },
    }]);
    listCustomers.mockResolvedValue([
        customer,
        {
            record_id: "rec_customer_002",
            fields: {
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "ร้านพลอย",
                [CUSTOMER_FIELDS.CHANNEL]: "TikTok",
                [CUSTOMER_FIELDS.CHANNEL_CUSTOMER_ID]: "tt-002",
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Interested",
                [CUSTOMER_FIELDS.LEAD_SCORE]: 45,
                [CUSTOMER_FIELDS.HOT_LEAD]: false,
                [CUSTOMER_FIELDS.MESSAGE_COUNT]: 2,
                [CUSTOMER_FIELDS.SALES_OWNER]: "Unassigned",
                [CUSTOMER_FIELDS.CREATED_AT]: 1_779_000_000_000,
                [CUSTOMER_FIELDS.UPDATED_AT]: 1_779_000_100_000,
            },
        },
    ]);
    getCustomerByRecordId.mockResolvedValue(customer);
    listConversations.mockResolvedValue([
        {
            record_id: "rec_message_001",
            fields: {
                [CONVERSATION_FIELDS.CUSTOMER]: ["rec_customer_001"],
                [CONVERSATION_FIELDS.MESSAGE_TYPE]: "text",
                [CONVERSATION_FIELDS.MESSAGE]: "เอา 10 ตัวค่ะ",
                [CONVERSATION_FIELDS.CREATED_AT]: 1_780_000_050_000,
            },
        },
    ]);
    listActivities.mockResolvedValue([
        {
            record_id: "rec_activity_001",
            fields: {
                [ACTIVITY_FIELDS.CUSTOMER]: ["rec_customer_001"],
                [ACTIVITY_FIELDS.ACTION]: "PAYMENT_VERIFIED",
                [ACTIVITY_FIELDS.NEW_VALUE]: JSON.stringify({
                    payment_status: "Paid",
                }),
                [ACTIVITY_FIELDS.CREATED_AT]: 1_780_000_090_000,
            },
        },
    ]);
    findOrdersByCustomer.mockResolvedValue([
        {
            record_id: "rec_order_001",
            fields: {
                [ORDER_FIELDS.ORDER_NUMBER]: "ORD-LINE-001",
                [ORDER_FIELDS.PRODUCT_NAME]: "เสื้อรุ่นใหม่",
                [ORDER_FIELDS.QUANTITY]: 10,
                [ORDER_FIELDS.ADDRESS]: "99/1 กรุงเทพฯ",
                [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                [ORDER_FIELDS.CREATED_AT]: 1_780_000_060_000,
                [ORDER_FIELDS.UPDATED_AT]: 1_780_000_095_000,
            },
        },
    ]);
});

describe("customer dashboard service", () => {
    it("filter และ map รายการลูกค้าให้ตรง Frontend contract", async () => {
        const result = await getCustomerList(env, {
            search: "มินท์",
            channel: "LINE",
            stage: "Closing",
            hot_lead: true,
            sort: "lead_score_desc",
            page: 1,
            page_size: 10,
        });

        expect(result.total).toBe(1);
        expect(result.items[0]).toMatchObject({
            customer_id: "rec_customer_001",
            customer_name: "คุณมินท์",
            channel: "LINE",
            current_stage: "Closing",
            lead_score: 94,
            hot_lead: true,
        });
        expect(result.summary).toEqual({
            total_customers: 2,
            hot_leads: 1,
            closing_customers: 1,
            unassigned_customers: 1,
        });
    });

    it("ค้นหาด้วยข้อมูลธุรกิจและไม่ใช้ Customer ID ภายในหรือ Channel customer ID", async () => {
        const query = (search: string) => getCustomerList(env, {
            search,
            channel: null,
            stage: null,
            hot_lead: null,
            sort: "updated_desc",
            page: 1,
            page_size: 10,
        });

        await expect(query("0891234567")).resolves.toMatchObject({ total: 1 });
        await expect(query("rec_customer_001")).resolves.toMatchObject({ total: 0 });
        await expect(query("line-user-001")).resolves.toMatchObject({ total: 0 });
    });

    it("สร้าง Customer detail พร้อมชื่อสินค้า ที่อยู่ และ Timeline", async () => {
        const result = await getCustomerDetail(
            env,
            "rec_customer_001",
            "th"
        );

        expect(result).toMatchObject({
            customer_id: "rec_customer_001",
            product_name: "เสื้อรุ่นใหม่",
            delivery_address: "99/1 กรุงเทพฯ",
            active_order_number: "ORD-LINE-001",
        });
        expect(result?.timeline).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    type: "message",
                    detail: "เอา 10 ตัวค่ะ",
                }),
                expect.objectContaining({
                    type: "payment",
                    title: "ยืนยันการชำระเงิน",
                }),
                expect.objectContaining({
                    type: "payment",
                    title: "คำสั่งซื้อ ORD-LINE-001",
                }),
            ])
        );
    });

    it("คืนเฉพาะ Hot Lead ที่มี Open Pipeline จริงเมื่อเปิดจาก Action Center", async () => {
        listCustomers.mockResolvedValue([
            customer,
            {
                record_id: "rec_customer_stale",
                fields: {
                    [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Hot Lead เก่า",
                    [CUSTOMER_FIELDS.CHANNEL]: "LINE",
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Won",
                    [CUSTOMER_FIELDS.HOT_LEAD]: true,
                    [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "rec_pipeline_closed",
                },
            },
        ]);
        listPipelines.mockResolvedValue([
            {
                record_id: "rec_pipeline_001",
                fields: {
                    [PIPELINE_FIELDS.CUSTOMER]: ["rec_customer_001"],
                    [PIPELINE_FIELDS.STATUS]: "open",
                    [PIPELINE_FIELDS.STAGE]: "Closing",
                },
            },
            {
                record_id: "rec_pipeline_closed",
                fields: {
                    [PIPELINE_FIELDS.CUSTOMER]: ["rec_customer_stale"],
                    [PIPELINE_FIELDS.STATUS]: "won",
                    [PIPELINE_FIELDS.STAGE]: "Won",
                },
            },
        ]);
        clearDashboardReadCache();

        const result = await getCustomerList(env, {
            search: "",
            channel: null,
            stage: null,
            hot_lead: null,
            work_queue: "hot_lead",
            sort: "lead_score_desc",
            page: 1,
            page_size: 20,
        });

        expect(result.total).toBe(1);
        expect(result.items[0]).toMatchObject({
            customer_id: "rec_customer_001",
            work_queue: "hot_lead",
        });
        expect(result.items.some((item) => item.customer_id === "rec_customer_stale")).toBe(false);
    });

});
