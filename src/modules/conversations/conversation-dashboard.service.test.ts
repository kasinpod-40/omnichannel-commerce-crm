import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_FIELDS, CUSTOMER_FIELDS, ORDER_FIELDS } from "../../core/lark-fields";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";

const {
    listCustomers,
    getCustomerByRecordId,
    listConversations,
    listConversationsByCustomer,
    listOrders,
} = vi.hoisted(() => ({
    listCustomers: vi.fn(),
    getCustomerByRecordId: vi.fn(),
    listConversations: vi.fn(),
    listConversationsByCustomer: vi.fn(),
    listOrders: vi.fn(),
}));

vi.mock("../customers/customer.repository", () => ({
    listCustomers,
    getCustomerByRecordId,
}));
vi.mock("./conversation.repository", () => ({
    listConversations,
    listConversationsByCustomer,
}));
vi.mock("../orders/order.repository", () => ({ listOrders }));

import {
    getConversationDetail,
    getConversationList,
    getConversationMessages,
} from "./conversation-dashboard.service";

const env = {
    LARK_APP_TOKEN: "app",
    CUSTOMERS_TABLE_ID: "customers",
    CONVERSATIONS_TABLE_ID: "conversations",
} as any;

const lineMessages = [
    {
        record_id: "rec_message_1",
        fields: {
            [CONVERSATION_FIELDS.CUSTOMER]: ["rec_customer_1"],
            [CONVERSATION_FIELDS.CHANNEL]: "LINE",
            [CONVERSATION_FIELDS.EXTERNAL_MESSAGE_ID]: "line-message-1",
            [CONVERSATION_FIELDS.MESSAGE_TYPE]: "text",
            [CONVERSATION_FIELDS.MESSAGE]: "สนใจสินค้า",
            [CONVERSATION_FIELDS.BUYER_INTENT]: "Interested",
            [CONVERSATION_FIELDS.PROCESS_STATUS]: "processed",
            [CONVERSATION_FIELDS.CREATED_AT]: 1_780_000_000_000,
        },
    },
    {
        record_id: "rec_message_2",
        fields: {
            [CONVERSATION_FIELDS.CUSTOMER]: ["rec_customer_1"],
            [CONVERSATION_FIELDS.CHANNEL]: "LINE",
            [CONVERSATION_FIELDS.MESSAGE_TYPE]: "image",
            [CONVERSATION_FIELDS.MESSAGE]: "รูปสินค้า",
            [CONVERSATION_FIELDS.BUYER_INTENT]: "Ready To Buy",
            [CONVERSATION_FIELDS.PROCESS_STATUS]: "processed",
            [CONVERSATION_FIELDS.CREATED_AT]: 1_780_000_050_000,
        },
    },
    {
        record_id: "rec_message_3",
        fields: {
            [CONVERSATION_FIELDS.CUSTOMER]: ["rec_customer_1"],
            [CONVERSATION_FIELDS.CHANNEL]: "LINE",
            [CONVERSATION_FIELDS.MESSAGE_TYPE]: "text",
            [CONVERSATION_FIELDS.MESSAGE]: "เอา 2 ตัวครับ",
            [CONVERSATION_FIELDS.BUYER_INTENT]: "Ready To Buy",
            [CONVERSATION_FIELDS.PROCESS_STATUS]: "processed",
            [CONVERSATION_FIELDS.CREATED_AT]: 1_780_000_050_000,
        },
    },
];

beforeEach(() => {
    vi.clearAllMocks();
    clearDashboardReadCache();
    const customerRecord = {
        record_id: "rec_customer_1",
        fields: {
            [CUSTOMER_FIELDS.CUSTOMER_NAME]: "คุณมินท์",
            [CUSTOMER_FIELDS.CHANNEL]: "LINE",
            [CUSTOMER_FIELDS.PHONE]: "0891234567",
            [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
            [CUSTOMER_FIELDS.LEAD_SCORE]: 92,
            [CUSTOMER_FIELDS.HOT_LEAD]: true,
            [CUSTOMER_FIELDS.AI_SUMMARY]: "พร้อมซื้อ",
            [CUSTOMER_FIELDS.SALES_OWNER]: "Sales A",
            [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "rec_order_1",
            [CUSTOMER_FIELDS.UPDATED_AT]: 1_780_000_100_000,
        },
    };
    listCustomers.mockResolvedValue([customerRecord]);
    getCustomerByRecordId.mockResolvedValue(customerRecord);
    const allMessages = [
        ...lineMessages,
        {
            record_id: "rec_marketplace_message",
            fields: {
                [CONVERSATION_FIELDS.CUSTOMER]: ["rec_customer_1"],
                [CONVERSATION_FIELDS.CHANNEL]: "Lazada",
                [CONVERSATION_FIELDS.MESSAGE]: "ต้องไม่แสดง",
                [CONVERSATION_FIELDS.CREATED_AT]: 1_780_000_090_000,
            },
        },
    ];
    listOrders.mockResolvedValue([{
        record_id: "rec_order_1",
        fields: { [ORDER_FIELDS.ORDER_NUMBER]: "ORD-001" },
    }]);
    listConversations.mockResolvedValue(allMessages);
    listConversationsByCustomer.mockResolvedValue(allMessages);
});

describe("conversation dashboard service", () => {
    it("รวมข้อความ LINE ต่อ Customer และคืน pagination metadata", async () => {
        const result = await getConversationList(env, {
            search: "",
            intent: null,
            process_status: null,
            page: 1,
            page_size: 10,
        });

        expect(result).toMatchObject({ page: 1, page_size: 10, total_pages: 1, total: 1 });
        expect(result.summary.total_customers).toBe(1);
        expect(result.summary.total_messages).toBe(3);
        expect(result.items[0]).toMatchObject({
            conversation_id: "rec_customer_1",
            customer_name: "คุณมินท์",
            message_preview: "เอา 2 ตัวครับ",
            intent: "Ready To Buy",
        });
    });

    it("ค้นหาด้วยข้อมูลธุรกิจและไม่ใช้ Customer record ID ภายใน", async () => {
        const byName = await getConversationList(env, {
            search: "มินท์",
            intent: null,
            process_status: null,
            page: 1,
            page_size: 10,
        });
        expect(byName.total).toBe(1);

        const byInternalId = await getConversationList(env, {
            search: "rec_customer_1",
            intent: null,
            process_status: null,
            page: 1,
            page_size: 10,
        });
        expect(byInternalId.total).toBe(0);
    });

    it("คืน Timeline ล่าสุดเรียงจากเก่าไปใหม่และสร้าง image proxy", async () => {
        const result = await getConversationDetail(env, "rec_customer_1");
        expect(result?.messages.map((item) => item.content)).toEqual([
            "สนใจสินค้า",
            "รูปสินค้า",
            "เอา 2 ตัวครับ",
        ]);
        expect(result?.messages[1]?.image_url).toBe("/conversations/images/rec_message_2");
        expect(result?.active_order_id).toBe("rec_order_1");
        expect(result?.active_order_number).toBe("ORD-001");
        expect(listConversationsByCustomer).toHaveBeenCalledWith(env, "rec_customer_1");
        expect(getCustomerByRecordId).toHaveBeenCalledWith(env, "rec_customer_1");
    });

    it("ใช้ cursor ที่รวม timestamp กับ record id เพื่อโหลดชุดเก่ากว่าโดยไม่ซ้ำ", async () => {
        const latest = await getConversationMessages(env, "rec_customer_1", { limit: 2, before: null });
        expect(latest?.items.map((item) => item.content)).toEqual(["รูปสินค้า", "เอา 2 ตัวครับ"]);
        expect(latest?.has_more).toBe(true);
        expect(latest?.next_cursor).toBeTruthy();

        const older = await getConversationMessages(env, "rec_customer_1", {
            limit: 2,
            before: latest?.next_cursor ?? null,
        });
        expect(older?.items.map((item) => item.content)).toEqual(["สนใจสินค้า"]);
        expect(older?.has_more).toBe(false);
    });
});
