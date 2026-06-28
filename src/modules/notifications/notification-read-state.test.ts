import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    NOTIFICATION_FIELDS,
    ORDER_FIELDS,
} from "../../core/lark-fields";

const mocks = vi.hoisted(() => ({
    getNotificationByRecordId: vi.fn(),
    updateNotificationPayload: vi.fn(),
    updateNotificationDelivery: vi.fn(),
    getCustomerByRecordId: vi.fn(),
    getOrderByRecordId: vi.fn(),
    getPipelineByRecordId: vi.fn(),
    sendLarkGroupReviewCard: vi.fn(),
    sendLarkGroupText: vi.fn(),
}));

vi.mock("./notification.repository", async (importOriginal) => {
    const original = await importOriginal<typeof import("./notification.repository")>();
    return {
        ...original,
        getNotificationByRecordId: mocks.getNotificationByRecordId,
        updateNotificationPayload: mocks.updateNotificationPayload,
        updateNotificationDelivery: mocks.updateNotificationDelivery,
    };
});

vi.mock("../customers/customer.repository", () => ({
    getCustomerByRecordId: mocks.getCustomerByRecordId,
}));

vi.mock("../orders/order.repository", () => ({
    getOrderByRecordId: mocks.getOrderByRecordId,
}));

vi.mock("../pipeline/pipeline.repository", () => ({
    getPipelineByRecordId: mocks.getPipelineByRecordId,
}));

vi.mock("../../providers/lark/lark-group-webhook.provider", () => ({
    sendLarkGroupReviewCard: mocks.sendLarkGroupReviewCard,
    sendLarkGroupText: mocks.sendLarkGroupText,
}));

import {
    markNotificationDashboardRead,
    markPaymentReviewNotificationResolved,
    parseNotificationSnapshot,
    sendNotificationByRecordId,
} from "./notification.service";

const env = {
    DASHBOARD_URL: "https://crm.example.com",
    LARK_APP_ID: "cli_test_app",
} as Env;

const baseRecord = {
    record_id: "noti-001",
    fields: {
        [NOTIFICATION_FIELDS.EVENT_ID]: "PAYMENT_REVIEW:rec-order-001",
        [NOTIFICATION_FIELDS.NOTIFICATION_TYPE]: "PAYMENT_REVIEW",
        [NOTIFICATION_FIELDS.CUSTOMER]: ["rec-customer-001"],
        [NOTIFICATION_FIELDS.MESSAGE]: "มีการชำระเงินรอตรวจสอบ",
        [NOTIFICATION_FIELDS.PAYLOAD_JSON]: "",
        [NOTIFICATION_FIELDS.STATUS]: "Pending",
        [NOTIFICATION_FIELDS.ATTEMPT_COUNT]: 0,
    },
};

describe("Notification dashboard read state", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCustomerByRecordId.mockResolvedValue({
            record_id: "rec-customer-001",
            fields: {
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "ลูกค้าทดสอบ",
                [CUSTOMER_FIELDS.CHANNEL]: "LINE",
                [CUSTOMER_FIELDS.PHONE]: "0812345678",
                [CUSTOMER_FIELDS.SALES_OWNER]: "Sales A",
            },
        });
        mocks.getOrderByRecordId.mockResolvedValue({
            record_id: "rec-order-001",
            fields: {
                [ORDER_FIELDS.ORDER_NUMBER]: "ORD-001",
                [ORDER_FIELDS.CHANNEL]: "LINE",
                [ORDER_FIELDS.PRODUCT_NAME]: "สินค้า A",
                [ORDER_FIELDS.QUANTITY]: 1,
                [ORDER_FIELDS.TOTAL_AMOUNT]: 1290,
                [ORDER_FIELDS.SLIP_AMOUNT]: 1290,
                [ORDER_FIELDS.PAYMENT_STATUS]: "Payment Review",
                [ORDER_FIELDS.ORDER_STATUS]: "Payment Review",
            },
        });
        mocks.getPipelineByRecordId.mockResolvedValue(null);
        mocks.sendLarkGroupReviewCard.mockResolvedValue({ ok: true, response: { code: 0 } });
        mocks.sendLarkGroupText.mockResolvedValue({ ok: true, response: { code: 0 } });
        mocks.updateNotificationDelivery.mockResolvedValue(baseRecord);
        mocks.updateNotificationPayload.mockImplementation(
            async (_env: Env, _recordId: string, payload: Record<string, unknown>) => ({
                ...baseRecord,
                fields: {
                    ...baseRecord.fields,
                    [NOTIFICATION_FIELDS.PAYLOAD_JSON]: JSON.stringify(payload),
                },
            })
        );
    });

    it("บันทึก Dashboard read marker ใน payload โดยไม่เปลี่ยน Pending delivery status", async () => {
        const updated = await markNotificationDashboardRead(env, baseRecord, 123456789);
        const snapshot = parseNotificationSnapshot(updated);

        expect(snapshot).toMatchObject({
            captured_at: expect.any(Number),
            order_number: "ORD-001",
            dashboard_read_at: 123456789,
        });
        expect(mocks.updateNotificationPayload).toHaveBeenCalled();
        expect(updated.fields[NOTIFICATION_FIELDS.STATUS]).toBe("Pending");
    });

    it("ปิด Payment Review ด้วย marker และสถานะ Sent ที่มีอยู่แล้วใน Lark", async () => {
        await markPaymentReviewNotificationResolved(env, baseRecord, 987654321);

        expect(mocks.updateNotificationPayload).toHaveBeenCalledWith(
            env,
            "noti-001",
            expect.objectContaining({
                dashboard_read_at: 987654321,
                review_resolved_at: 987654321,
            })
        );
        expect(mocks.updateNotificationDelivery).toHaveBeenCalledWith(
            env,
            "noti-001",
            expect.objectContaining({
                status: "Sent",
                attempt_count: 0,
                sent_at: 987654321,
            })
        );
    });

    it("ยังส่ง Lark Group Card ได้หลังผู้ใช้เปิดอ่าน Notification ก่อน Queue ทำงาน", async () => {
        const marked = await markNotificationDashboardRead(env, baseRecord, 123456789);
        mocks.getNotificationByRecordId.mockResolvedValue(marked);

        const result = await sendNotificationByRecordId(env, "noti-001");

        expect(result.ok).toBe(true);
        expect(mocks.sendLarkGroupReviewCard).toHaveBeenCalledWith(
            env,
            expect.objectContaining({
                button_text: "เปิดตรวจสอบ",
                button_url: expect.stringContaining("https://applink.larksuite.com/client/web_app/open"),
            })
        );
        expect(mocks.updateNotificationDelivery).toHaveBeenCalledWith(
            env,
            "noti-001",
            expect.objectContaining({ status: "Sent", attempt_count: 1 })
        );
    });
});
