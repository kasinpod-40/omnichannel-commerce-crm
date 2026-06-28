import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { CUSTOMER_FIELDS } from "../../core/lark-fields";
import * as customerRepository from "./customer.repository";
import { upsertCustomer } from "./customer.service";

vi.mock("./customer.repository", () => ({
    createCustomer: vi.fn(),
    findCustomerByChannelCustomerId: vi.fn(),
    updateCustomer: vi.fn(),
}));

const existingCustomer = {
    record_id: "rec_customer_001",
    fields: {
        [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Test User",
        [CUSTOMER_FIELDS.PHONE]: "0899998888",
        [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
        [CUSTOMER_FIELDS.BUYER_INTENT]: "Ready To Buy",
        [CUSTOMER_FIELDS.LEAD_SCORE]: 90,
        [CUSTOMER_FIELDS.HOT_LEAD]: true,
        [CUSTOMER_FIELDS.AI_SUMMARY]: "กำลังปิดการขาย",
        [CUSTOMER_FIELDS.MESSAGE_COUNT]: 4,
        [CUSTOMER_FIELDS.PRODUCT_NAME]: "เสื้อรุ่น A",
        [CUSTOMER_FIELDS.PRODUCT_QTY]: 2,
        [CUSTOMER_FIELDS.PRODUCT_UNIT]: "ตัว",
    },
};

describe("CASE 19.3 customer phone merge", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(customerRepository.updateCustomer).mockResolvedValue(
            existingCustomer
        );
    });

    it("does not overwrite an existing phone with an empty value", async () => {
        await upsertCustomer({} as Env, {
            channel: "LINE",
            channel_customer_id: "line_user_001",
            phone: "",
            last_message: "ขอบคุณครับ",
            increment_message_count: false,
            existing_customer: existingCustomer,
        });

        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            existingCustomer.record_id,
            expect.objectContaining({
                phone: "0899998888",
            })
        );
    });

    it("normalizes a new country-code phone before saving", async () => {
        await upsertCustomer({} as Env, {
            channel: "LINE",
            channel_customer_id: "line_user_001",
            phone: "+66 81 234 5678",
            last_message: "เบอร์นี้ครับ",
            increment_message_count: false,
            existing_customer: existingCustomer,
        });

        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            existingCustomer.record_id,
            expect.objectContaining({
                phone: "0812345678",
            })
        );
    });
    it("resets old sales context when a won customer starts a new order", async () => {
        const wonCustomer = {
            ...existingCustomer,
            fields: {
                ...existingCustomer.fields,
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Won",
                [CUSTOMER_FIELDS.BUYER_INTENT]: "Ready To Buy",
                [CUSTOMER_FIELDS.LEAD_SCORE]: 100,
                [CUSTOMER_FIELDS.HOT_LEAD]: false,
                [CUSTOMER_FIELDS.PRODUCT_NAME]: "สินค้าเก่า",
                [CUSTOMER_FIELDS.PRODUCT_QTY]: 10,
                [CUSTOMER_FIELDS.PRODUCT_UNIT]: "ตัว",
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "",
                [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "",
            },
        };

        await upsertCustomer({} as Env, {
            channel: "LINE",
            channel_customer_id: "line_user_001",
            last_message: "เอาสินค้าใหม่ 2 ตัวครับ",
            existing_customer: wonCustomer,
            ai: {
                intent: "product_order",
                buyer_intent: "Ready To Buy",
                customer_stage: "Closing",
                lead_score: 90,
                hot_lead: true,
                ai_summary: "ลูกค้าสั่งซื้อสินค้าใหม่",
                product_name: "สินค้าใหม่",
                quantity: 2,
                product_unit: "ตัว",
            },
        });

        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            wonCustomer.record_id,
            expect.objectContaining({
                current_stage: "Closing",
                buyer_intent: "Ready To Buy",
                lead_score: 90,
                hot_lead: true,
                product_name: "สินค้าใหม่",
                product_qty: 2,
                product_unit: "ตัว",
                active_pipeline_id: "",
                active_order_id: "",
                pending_payment: false,
            })
        );
    });

    it("force-resets stale closing data from an already closed legacy sale", async () => {
        const staleClosedCustomer = {
            ...existingCustomer,
            fields: {
                ...existingCustomer.fields,
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
                [CUSTOMER_FIELDS.LEAD_SCORE]: 100,
                [CUSTOMER_FIELDS.HOT_LEAD]: true,
                [CUSTOMER_FIELDS.PRODUCT_NAME]: "สินค้าเก่า",
                [CUSTOMER_FIELDS.PRODUCT_QTY]: 8,
                [CUSTOMER_FIELDS.PRODUCT_UNIT]: "ตัว",
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "",
                [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "",
            },
        };

        await upsertCustomer({} as Env, {
            channel: "LINE",
            channel_customer_id: "line_user_001",
            last_message: "สินค้าใหม่ราคาเท่าไรครับ",
            existing_customer: staleClosedCustomer,
            force_new_sales_cycle: true,
            ai: {
                intent: "ask_price",
                buyer_intent: "Interested",
                customer_stage: "Interested",
                lead_score: 35,
                hot_lead: false,
                ai_summary: "ลูกค้าสอบถามสินค้าใหม่",
                product_name: "สินค้าใหม่",
            },
        });

        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            staleClosedCustomer.record_id,
            expect.objectContaining({
                current_stage: "Interested",
                buyer_intent: "Interested",
                lead_score: 35,
                hot_lead: false,
                product_name: "สินค้าใหม่",
                product_qty: 0,
                product_unit: "",
            })
        );
    });

    it("resets won customer context even when the next message is only a greeting", async () => {
        const wonCustomer = {
            ...existingCustomer,
            fields: {
                ...existingCustomer.fields,
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Won",
                [CUSTOMER_FIELDS.BUYER_INTENT]: "Ready To Buy",
                [CUSTOMER_FIELDS.LEAD_SCORE]: 100,
                [CUSTOMER_FIELDS.HOT_LEAD]: true,
                [CUSTOMER_FIELDS.PRODUCT_NAME]: "สินค้าเก่า",
                [CUSTOMER_FIELDS.PRODUCT_QTY]: 10,
                [CUSTOMER_FIELDS.PRODUCT_UNIT]: "ตัว",
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "",
                [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "",
            },
        };

        await upsertCustomer({} as Env, {
            channel: "LINE",
            channel_customer_id: "line_user_001",
            last_message: "สวัสดีครับ",
            existing_customer: wonCustomer,
            ai: {
                intent: "greeting",
                buyer_intent: "Just Browsing",
                customer_stage: "New Lead",
                lead_score: 0,
                hot_lead: false,
                ai_summary: "ลูกค้าทักทาย",
            },
        });

        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            wonCustomer.record_id,
            expect.objectContaining({
                current_stage: "New Lead",
                buyer_intent: "Just Browsing",
                lead_score: 0,
                hot_lead: false,
                product_name: "",
                product_qty: 0,
                product_unit: "",
                active_pipeline_id: "",
                active_order_id: "",
                pending_payment: false,
                ai_summary: "ลูกค้าทักทาย",
                last_message: "สวัสดีครับ",
            })
        );
    });

    it("resets lost customer context on the next inbound greeting", async () => {
        const lostCustomer = {
            ...existingCustomer,
            fields: {
                ...existingCustomer.fields,
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Lost",
                [CUSTOMER_FIELDS.BUYER_INTENT]: "Purchase Intent",
                [CUSTOMER_FIELDS.LEAD_SCORE]: 70,
                [CUSTOMER_FIELDS.HOT_LEAD]: true,
                [CUSTOMER_FIELDS.PRODUCT_NAME]: "สินค้าเก่า",
                [CUSTOMER_FIELDS.PRODUCT_QTY]: 4,
                [CUSTOMER_FIELDS.PRODUCT_UNIT]: "ตัว",
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "",
                [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "",
            },
        };

        await upsertCustomer({} as Env, {
            channel: "LINE",
            channel_customer_id: "line_user_001",
            last_message: "สวัสดีครับ",
            existing_customer: lostCustomer,
            ai: {
                intent: "greeting",
                buyer_intent: "Just Browsing",
                customer_stage: "New Lead",
                lead_score: 0,
                hot_lead: false,
                ai_summary: "ลูกค้ากลับมาทักใหม่",
            },
        });

        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            lostCustomer.record_id,
            expect.objectContaining({
                current_stage: "New Lead",
                buyer_intent: "Just Browsing",
                lead_score: 0,
                hot_lead: false,
                product_name: "",
                product_qty: 0,
                product_unit: "",
            })
        );
    });

    it("does not clear active pointers when retrying a lost transition", async () => {
        const partiallyProcessedLostCustomer = {
            ...existingCustomer,
            fields: {
                ...existingCustomer.fields,
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Lost",
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]:
                    "rec_pipeline_active",
                [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]:
                    "rec_order_active",
            },
        };

        await upsertCustomer({} as Env, {
            channel: "LINE",
            channel_customer_id: "line_user_001",
            last_message: "ไม่เอาแล้วครับ",
            existing_customer:
                partiallyProcessedLostCustomer,
            ai: {
                intent: "lost",
                buyer_intent: "Just Browsing",
                customer_stage: "Lost",
                lead_score: 0,
                hot_lead: false,
                ai_summary: "ลูกค้ายกเลิกการซื้อ",
            },
        });

        const updateFields = vi.mocked(
            customerRepository.updateCustomer
        ).mock.calls[0]?.[2];

        expect(updateFields).toEqual(
            expect.objectContaining({
                current_stage: "Lost",
                lead_score: 0,
                hot_lead: false,
            })
        );
        expect(updateFields).not.toHaveProperty(
            "active_pipeline_id"
        );
        expect(updateFields).not.toHaveProperty(
            "active_order_id"
        );
    });


    it("preserves the existing product name when the customer only selects a size", async () => {
        const activeCustomer = {
            ...existingCustomer,
            fields: {
                ...existingCustomer.fields,
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Interested",
                [CUSTOMER_FIELDS.PRODUCT_NAME]: "เสื้อสีเขียว",
                [CUSTOMER_FIELDS.PRODUCT_SIZE]: "",
                [CUSTOMER_FIELDS.PRODUCT_QTY]: 0,
            },
        };

        await upsertCustomer({} as Env, {
            channel: "LINE",
            channel_customer_id: "line_user_001",
            last_message: "เอาไซต์ S 1 ตัวครับ",
            existing_customer: activeCustomer,
            ai: {
                intent: "product_order",
                buyer_intent: "Ready To Buy",
                customer_stage: "Closing",
                lead_score: 90,
                hot_lead: true,
                ai_summary: "ลูกค้าเลือกไซส์ S จำนวน 1 ตัว",
                product_size: "S",
                quantity: 1,
                product_unit: "ตัว",
            },
        });

        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            activeCustomer.record_id,
            expect.objectContaining({
                product_name: "เสื้อสีเขียว",
                product_size: "S",
                product_qty: 1,
                product_unit: "ตัว",
            })
        );
    });

    it("repairs an out-of-range legacy lead score on the next update", async () => {
        const legacyCustomer = {
            ...existingCustomer,
            fields: {
                ...existingCustomer.fields,
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Negotiating",
                [CUSTOMER_FIELDS.LEAD_SCORE]: 140,
            },
        };

        await upsertCustomer({} as Env, {
            channel: "LINE",
            channel_customer_id: "line_user_001",
            last_message: "ขอคิดดูก่อนครับ",
            existing_customer: legacyCustomer,
            ai: {
                intent: "ask_discount",
                buyer_intent: "Purchase Intent",
                customer_stage: "Negotiating",
                lead_score: 70,
                hot_lead: false,
                ai_summary: "ลูกค้าขอพิจารณาราคา",
            },
        });

        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            legacyCustomer.record_id,
            expect.objectContaining({
                current_stage: "Negotiating",
                lead_score: 100,
            })
        );
    });

});
