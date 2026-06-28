import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_FIELDS } from "../../core/lark-fields";

const {
    findNotificationByEventId,
    createNotification,
    getNotificationByRecordId,
    updateNotificationDelivery,
    enqueueNotificationDelivery,
    sendLarkGroupReviewCard,
} = vi.hoisted(() => ({
    findNotificationByEventId: vi.fn(),
    createNotification: vi.fn(),
    getNotificationByRecordId: vi.fn(),
    updateNotificationDelivery: vi.fn(),
    enqueueNotificationDelivery: vi.fn(),
    sendLarkGroupReviewCard: vi.fn(),
}));

vi.mock("./notification.repository", async (importOriginal) => {
    const original = await importOriginal<typeof import("./notification.repository")>();
    return {
        ...original,
        findNotificationByEventId,
        createNotification,
        getNotificationByRecordId,
        updateNotificationDelivery,
    };
});

vi.mock("../../queues/notification.producer", () => ({
    enqueueNotificationDelivery,
}));

vi.mock("../../providers/lark/lark-group-webhook.provider", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../providers/lark/lark-group-webhook.provider")>();
    return {
        ...original,
        sendLarkGroupReviewCard,
    };
});

import { recordAndDispatchNotificationOnce } from "./notification.service";

const paymentReviewRecord = {
    record_id: "noti-payment-1",
    fields: {
        [NOTIFICATION_FIELDS.EVENT_ID]: "PAYMENT_REVIEW:LINE:message-1:order1",
        [NOTIFICATION_FIELDS.NOTIFICATION_TYPE]: "PAYMENT_REVIEW",
        [NOTIFICATION_FIELDS.STATUS]: "Pending",
        [NOTIFICATION_FIELDS.ATTEMPT_COUNT]: 0,
        [NOTIFICATION_FIELDS.MESSAGE]: "review",
        [NOTIFICATION_FIELDS.PAYLOAD_JSON]: JSON.stringify({
            version: 1,
            captured_at: 1_780_000_000_000,
            customer_name: "Test Customer",
            channel: "LINE",
            phone: "0800000000",
            current_stage: "Closing",
            lead_score: 95,
            last_message: "ส่งสลิปแล้ว",
            sales_owner: "Sales C",
            order_number: "ORD-001",
            product_name: "เสื้อ",
            quantity: 1,
            total_amount: 1000,
            slip_amount: 1000,
            payment_status: "Payment Review",
            order_status: "Payment Review",
        }),
    },
};

describe("notification idempotency and payment review delivery", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        enqueueNotificationDelivery.mockResolvedValue(undefined);
        sendLarkGroupReviewCard.mockResolvedValue({ ok: true, response: { code: 0 } });
    });

    it("does not enqueue a duplicate notification that is already Sent", async () => {
        findNotificationByEventId.mockResolvedValue({
            record_id: "noti1",
            fields: {
                [NOTIFICATION_FIELDS.STATUS]: "Sent",
            },
        });

        const result = await recordAndDispatchNotificationOnce(
            {} as any,
            {
                event_id: "SALE_WON:pipe1",
                notification_type: "SALE_WON",
                customer_record_id: "cus1",
                message: "done",
            }
        );

        expect(result.duplicate).toBe(true);
        expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
        expect(createNotification).not.toHaveBeenCalled();
    });

    it("ส่ง PAYMENT_REVIEW เข้า Lark Group ทันทีและไม่ enqueue ซ้ำเมื่อสำเร็จ", async () => {
        findNotificationByEventId.mockResolvedValue(null);
        createNotification.mockResolvedValue(paymentReviewRecord);
        getNotificationByRecordId.mockResolvedValue(paymentReviewRecord);
        updateNotificationDelivery.mockResolvedValue({
            ...paymentReviewRecord,
            fields: {
                ...paymentReviewRecord.fields,
                [NOTIFICATION_FIELDS.STATUS]: "Sent",
                [NOTIFICATION_FIELDS.ATTEMPT_COUNT]: 1,
            },
        });

        const result = await recordAndDispatchNotificationOnce(
            { DASHBOARD_URL: "https://crm.example.com" } as any,
            {
                event_id: "PAYMENT_REVIEW:LINE:message-1:order1",
                notification_type: "PAYMENT_REVIEW",
                customer_record_id: "cus1",
                message: "review",
            }
        );

        expect(result.delivery?.ok).toBe(true);
        expect(sendLarkGroupReviewCard).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                button_url: expect.stringContaining("/orders/order1?review=1"),
            })
        );
        expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
    });

    it("ใช้ Queue เป็น fallback เมื่อส่ง PAYMENT_REVIEW เข้า Lark Group ไม่สำเร็จ", async () => {
        findNotificationByEventId.mockResolvedValue(null);
        createNotification.mockResolvedValue(paymentReviewRecord);
        getNotificationByRecordId.mockResolvedValue(paymentReviewRecord);
        sendLarkGroupReviewCard.mockRejectedValue(new Error("temporary webhook failure"));
        updateNotificationDelivery.mockResolvedValue({
            ...paymentReviewRecord,
            fields: {
                ...paymentReviewRecord.fields,
                [NOTIFICATION_FIELDS.STATUS]: "Failed",
                [NOTIFICATION_FIELDS.ATTEMPT_COUNT]: 1,
            },
        });

        const result = await recordAndDispatchNotificationOnce(
            { DASHBOARD_URL: "https://crm.example.com" } as any,
            {
                event_id: "PAYMENT_REVIEW:LINE:message-1:order1",
                notification_type: "PAYMENT_REVIEW",
                customer_record_id: "cus1",
                message: "review",
            }
        );

        expect(result.delivery?.ok).toBe(false);
        expect(enqueueNotificationDelivery).toHaveBeenCalledOnce();
    });
});
