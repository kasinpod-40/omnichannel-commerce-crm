import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { CUSTOMER_FIELDS, ORDER_FIELDS } from "../../core/lark-fields";

const mocks = vi.hoisted(() => ({
    findActivityByEventId: vi.fn(),
    listActivities: vi.fn(),
    recordActivityOnce: vi.fn(),
    getCustomerByRecordId: vi.fn(),
    clearDashboardReadCache: vi.fn(),
    getOrderByRecordId: vi.fn(),
    updateOrder: vi.fn(),
    getOrderDetail: vi.fn(),
}));
vi.mock("../activities/activity.repository", () => ({
    findActivityByEventId: mocks.findActivityByEventId,
    listActivities: mocks.listActivities,
}));
vi.mock("../activities/activity.service", () => ({ recordActivityOnce: mocks.recordActivityOnce }));
vi.mock("../customers/customer.repository", () => ({ getCustomerByRecordId: mocks.getCustomerByRecordId }));
vi.mock("../dashboard-read/dashboard-read.cache", () => ({ clearDashboardReadCache: mocks.clearDashboardReadCache }));
vi.mock("./order.repository", () => ({
    getOrderByRecordId: mocks.getOrderByRecordId,
    updateOrder: mocks.updateOrder,
}));
vi.mock("./order-dashboard.service", () => ({ getOrderDetail: mocks.getOrderDetail }));

import { updateOrderAmount } from "./order-amount.service";

const env = {} as Env;
const updatedAt = Date.parse("2026-06-30T03:00:00.000Z");
const baseOrder = {
    record_id: "rec-order-001",
    fields: {
        [ORDER_FIELDS.CUSTOMER]: ["rec-customer-001"],
        [ORDER_FIELDS.CHANNEL]: "LINE",
        [ORDER_FIELDS.ORDER_STATUS]: "Waiting Payment",
        [ORDER_FIELDS.PAYMENT_STATUS]: "Pending",
        [ORDER_FIELDS.PAYMENT_VERIFIED]: false,
        [ORDER_FIELDS.CUSTOMER_NAME]: "Customer A",
        [ORDER_FIELDS.PHONE]: "0812345678",
        [ORDER_FIELDS.ADDRESS]: "Bangkok",
        [ORDER_FIELDS.TOTAL_AMOUNT]: 1000,
        [ORDER_FIELDS.UPDATED_AT]: updatedAt,
    },
};
const input = (amount: string, overrides: Record<string, unknown> = {}) => ({
    orderId: "rec-order-001",
    amount,
    expectedUpdatedAt: new Date(updatedAt).toISOString(),
    idempotencyKey: "order-amount-key-001",
    reason: "agreed amount",
    actor: { userId: "user-admin", name: "Admin", role: "admin" },
    ...overrides,
});

describe("updateOrderAmount", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findActivityByEventId.mockResolvedValue(null);
        mocks.listActivities.mockResolvedValue([]);
        mocks.getOrderByRecordId.mockResolvedValue(structuredClone(baseOrder));
        mocks.getCustomerByRecordId.mockResolvedValue({
            record_id: "rec-customer-001",
            fields: {
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Customer A",
                [CUSTOMER_FIELDS.PHONE]: "0812345678",
            },
        });
        mocks.updateOrder.mockResolvedValue(undefined);
        mocks.recordActivityOnce.mockResolvedValue(undefined);
        mocks.getOrderDetail.mockResolvedValue({ order_id: "rec-order-001", total_amount: 1250.5 });
    });

    it.each(["0", "-1", "NaN", "1.234", "1000000000", "", "  "])("ปฏิเสธยอดไม่ถูกต้อง %s", async (amount) => {
        await expect(updateOrderAmount(env, input(amount))).rejects.toMatchObject({ code: "ORDER_AMOUNT_INVALID" });
        expect(mocks.updateOrder).not.toHaveBeenCalled();
    });

    it("ป้องกัน concurrent update ด้วย expected_updated_at", async () => {
        await expect(updateOrderAmount(env, input("1250.50", {
            expectedUpdatedAt: "2026-06-30T02:59:00.000Z",
        }))).rejects.toMatchObject({ code: "ORDER_AMOUNT_CONFLICT", status: 409 });
        expect(mocks.updateOrder).not.toHaveBeenCalled();
        expect(mocks.recordActivityOnce).toHaveBeenCalledWith(env, expect.objectContaining({
            action: "ORDER_AMOUNT_UPDATE_FAILED",
        }));
    });

    it("ปฏิเสธ Marketplace และบันทึก failure audit", async () => {
        mocks.getOrderByRecordId.mockResolvedValue({
            ...baseOrder,
            fields: { ...baseOrder.fields, [ORDER_FIELDS.CHANNEL]: "Shopee" },
        });
        await expect(updateOrderAmount(env, input("1250.50"))).rejects.toMatchObject({
            code: "ORDER_AMOUNT_EDIT_NOT_ALLOWED",
        });
        expect(mocks.recordActivityOnce).toHaveBeenCalledWith(env, expect.objectContaining({
            action: "ORDER_AMOUNT_UPDATE_FAILED",
            new_value: expect.objectContaining({ channel: "Shopee", result: "failed" }),
        }));
    });

    it("อัปเดตทศนิยม 2 ตำแหน่ง สร้าง success audit และล้าง Dashboard cache", async () => {
        const result = await updateOrderAmount(env, input("1250.50"));
        expect(mocks.updateOrder).toHaveBeenCalledWith(env, "rec-order-001", expect.objectContaining({
            total_amount: 1250.5,
            updated_at: expect.any(Number),
        }));
        expect(mocks.recordActivityOnce).toHaveBeenCalledWith(env, expect.objectContaining({
            event_id: "order-amount:order-amount-key-001:success",
            action: "ORDER_AMOUNT_UPDATED",
            old_value: expect.objectContaining({ total_amount: 1000 }),
            new_value: expect.objectContaining({ total_amount: 1250.5, result: "success" }),
        }));
        expect(mocks.clearDashboardReadCache).toHaveBeenCalled();
        expect(result).toMatchObject({ idempotent: false, changed: true });
    });

    it("คืนผลเดิมโดยไม่ update ซ้ำเมื่อ idempotency event มีอยู่แล้ว", async () => {
        mocks.findActivityByEventId.mockResolvedValue({ record_id: "activity-1", fields: {} });
        const result = await updateOrderAmount(env, input("1250.50"));
        expect(result.idempotent).toBe(true);
        expect(mocks.updateOrder).not.toHaveBeenCalled();
        expect(mocks.recordActivityOnce).not.toHaveBeenCalled();
    });

    it("ไม่ update ซ้ำเมื่อยอดใหม่เท่ากับยอดเดิม", async () => {
        const result = await updateOrderAmount(env, input("1000.00"));
        expect(result.changed).toBe(false);
        expect(mocks.updateOrder).not.toHaveBeenCalled();
    });
});
