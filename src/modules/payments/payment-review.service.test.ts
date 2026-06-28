import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";

const mocks = vi.hoisted(() => ({
    findActivityByEventId: vi.fn(),
    listActivities: vi.fn(),
    recordActivityOnce: vi.fn(),
    getCustomerByRecordId: vi.fn(),
    getOrderByRecordId: vi.fn(),
    updateOrder: vi.fn(),
    getPipelineByRecordId: vi.fn(),
    markPaymentReviewNotificationsRead: vi.fn(),
    verifyPayment: vi.fn(),
}));

vi.mock("../activities/activity.repository", () => ({
    findActivityByEventId: mocks.findActivityByEventId,
    listActivities: mocks.listActivities,
}));
vi.mock("../activities/activity.service", () => ({
    recordActivityOnce: mocks.recordActivityOnce,
}));
vi.mock("../customers/customer.repository", () => ({
    getCustomerByRecordId: mocks.getCustomerByRecordId,
}));
vi.mock("../orders/order.repository", () => ({
    getOrderByRecordId: mocks.getOrderByRecordId,
    updateOrder: mocks.updateOrder,
}));
vi.mock("../pipeline/pipeline.repository", () => ({
    getPipelineByRecordId: mocks.getPipelineByRecordId,
}));
vi.mock("../notifications/notification-dashboard.service", () => ({
    markPaymentReviewNotificationsRead: mocks.markPaymentReviewNotificationsRead,
}));
vi.mock("../../usecases/verify-payment.usecase", () => ({
    verifyPayment: mocks.verifyPayment,
}));

import {
    approvePaymentReview,
    getPaymentReviewImage,
    rejectPaymentReview,
} from "./payment-review.service";

const env = {} as Env;
const actor = {
    user_id: "user-admin",
    lark_open_id: "open-admin",
    name: "Admin",
    email: null,
    avatar_url: null,
    role: "admin" as const,
    sales_owner_name: null,
};

const customer = {
    record_id: "rec-customer-001",
    fields: {
        [CUSTOMER_FIELDS.CUSTOMER_NAME]: "ลูกค้าทดสอบ",
        [CUSTOMER_FIELDS.PHONE]: "0812345678",
        [CUSTOMER_FIELDS.SALES_OWNER]: "Sales A",
    },
};
const pipeline = {
    record_id: "rec-pipeline-001",
    fields: {
        [PIPELINE_FIELDS.STAGE]: "Won",
        [PIPELINE_FIELDS.STATUS]: "won",
    },
};

function order(overrides: Record<string, unknown> = {}) {
    return {
        record_id: "rec-order-001",
        fields: {
            [ORDER_FIELDS.CUSTOMER]: ["rec-customer-001"],
            [ORDER_FIELDS.PIPELINE]: ["rec-pipeline-001"],
            [ORDER_FIELDS.ORDER_NUMBER]: "ORD-001",
            [ORDER_FIELDS.CHANNEL]: "LINE",
            [ORDER_FIELDS.CUSTOMER_NAME]: "ลูกค้าทดสอบ",
            [ORDER_FIELDS.PHONE]: "0812345678",
            [ORDER_FIELDS.ADDRESS]: "99/1 กรุงเทพ 10110",
            [ORDER_FIELDS.PRODUCT_NAME]: "สินค้า A",
            [ORDER_FIELDS.QUANTITY]: 1,
            [ORDER_FIELDS.TOTAL_AMOUNT]: 1290,
            [ORDER_FIELDS.SLIP_AMOUNT]: 1290,
            [ORDER_FIELDS.SLIP_BANK]: "KBANK",
            [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
            [ORDER_FIELDS.ORDER_STATUS]: "Completed",
            [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
            [ORDER_FIELDS.UPDATED_AT]: Date.parse("2026-06-28T00:00:00.000Z"),
            ...overrides,
        },
    };
}

describe("Payment Review business idempotency", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findActivityByEventId.mockResolvedValue(null);
        mocks.listActivities.mockResolvedValue([]);
        mocks.getCustomerByRecordId.mockResolvedValue(customer);
        mocks.getPipelineByRecordId.mockResolvedValue(pipeline);
        mocks.markPaymentReviewNotificationsRead.mockResolvedValue(1);
    });

    it("Approve ซ้ำหลัง Payment เป็น Paid แล้วคืนผลเดิมโดยไม่เรียก Core verification ซ้ำ", async () => {
        mocks.getOrderByRecordId.mockResolvedValue(order());

        const result = await approvePaymentReview(env, {
            order_record_id: "rec-order-001",
            idempotency_key: "approve-key-001",
            actor,
        });

        expect(result).toMatchObject({
            ok: true,
            duplicate: true,
            outcome: "SALE_COMPLETED",
            notification_records_closed: 1,
        });
        expect(mocks.verifyPayment).not.toHaveBeenCalled();
        expect(mocks.recordActivityOnce).not.toHaveBeenCalled();
    });

    it("Reject ซ้ำหลังมี Audit ล่าสุดคืนผล REJECTED โดยไม่ล้างข้อมูลซ้ำ", async () => {
        mocks.getOrderByRecordId.mockResolvedValue(order({
            [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
            [ORDER_FIELDS.ORDER_STATUS]: "Waiting Payment",
            [ORDER_FIELDS.PAYMENT_VERIFIED]: false,
            [ORDER_FIELDS.SLIP_AMOUNT]: 0,
            [ORDER_FIELDS.SLIP_BANK]: "",
        }));
        mocks.listActivities.mockResolvedValue([
            {
                record_id: "act-reject-001",
                fields: {
                    action: "PAYMENT_REVIEW_REJECTED",
                    old_value: JSON.stringify({ order_record_id: "rec-order-001" }),
                    new_value: JSON.stringify({
                        order_record_id: "rec-order-001",
                        outcome: "REJECTED",
                    }),
                    created_at: Date.parse("2026-06-28T00:02:00.000Z"),
                },
            },
        ]);

        const result = await rejectPaymentReview(env, {
            order_record_id: "rec-order-001",
            idempotency_key: "reject-key-001",
            reason: "ยอดเงินไม่ตรง",
            actor,
        });

        expect(result).toMatchObject({ ok: true, duplicate: true, outcome: "REJECTED" });
        expect(mocks.updateOrder).not.toHaveBeenCalled();
        expect(mocks.recordActivityOnce).not.toHaveBeenCalled();
    });
});

describe("Payment Review image proxy safety", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("หยุดตาม Redirect เมื่อปลายทางเป็น private network", async () => {
        mocks.getOrderByRecordId.mockResolvedValue(order({
            [ORDER_FIELDS.SLIP_IMAGE_URL]: "https://cdn.example.com/slip.jpg",
            [ORDER_FIELDS.SLIP_ATTACHMENT]: [],
        }));
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(null, {
                status: 302,
                headers: { Location: "https://127.0.0.1/internal.jpg" },
            })
        );

        await expect(getPaymentReviewImage(env, "rec-order-001")).resolves.toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(
            "https://cdn.example.com/slip.jpg",
            expect.objectContaining({ redirect: "manual" })
        );
    });

    it("ปฏิเสธ IPv6 loopback ก่อนยิง Network", async () => {
        mocks.getOrderByRecordId.mockResolvedValue(order({
            [ORDER_FIELDS.SLIP_IMAGE_URL]: "https://[::1]/slip.jpg",
            [ORDER_FIELDS.SLIP_ATTACHMENT]: [],
        }));
        const fetchMock = vi.spyOn(globalThis, "fetch");

        await expect(getPaymentReviewImage(env, "rec-order-001")).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("รับรูป HTTPS ที่ปลอดภัยและตรวจ MIME type", async () => {
        mocks.getOrderByRecordId.mockResolvedValue(order({
            [ORDER_FIELDS.SLIP_IMAGE_URL]: "https://cdn.example.com/slip.jpg",
            [ORDER_FIELDS.SLIP_ATTACHMENT]: [],
        }));
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
            new Response(new Uint8Array([1, 2, 3]), {
                status: 200,
                headers: {
                    "Content-Type": "image/jpeg",
                    "Content-Length": "3",
                },
            })
        );

        const result = await getPaymentReviewImage(env, "rec-order-001");

        expect(result?.mime_type).toBe("image/jpeg");
        expect(result?.bytes.byteLength).toBe(3);
    });
});

