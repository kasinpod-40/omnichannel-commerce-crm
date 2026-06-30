import { describe, expect, it } from "vitest";
import { ORDER_FIELDS } from "../../core/lark-fields";
import type { LarkOrderRecord } from "./order.repository";
import type { OrderWorkQueueClassification } from "./order-work-queue";
import { resolveOrderAmountEditPolicy } from "./order-amount-policy";

const classification = (overrides: Partial<OrderWorkQueueClassification> = {}): OrderWorkQueueClassification => ({
    work_queue: "waiting_payment",
    missing_delivery_fields: [],
    has_payment_evidence: false,
    payment_confirmed: false,
    latest_slip_at: 0,
    latest_rejected_at: 0,
    ...overrides,
});

const order = (overrides: Record<string, unknown> = {}): LarkOrderRecord => ({
    record_id: "rec-order-001",
    fields: {
        [ORDER_FIELDS.CHANNEL]: "LINE",
        [ORDER_FIELDS.ORDER_STATUS]: "Waiting Payment",
        [ORDER_FIELDS.PAYMENT_STATUS]: "Pending",
        [ORDER_FIELDS.PAYMENT_VERIFIED]: false,
        ...overrides,
    },
});

describe("resolveOrderAmountEditPolicy", () => {
    it("อนุญาต LINE order ที่ยังไม่ชำระและไม่มีสลิปรอตรวจ", () => {
        expect(resolveOrderAmountEditPolicy(order(), classification())).toEqual({ allowed: true, reason: null });
    });

    it.each([
        [order({ [ORDER_FIELDS.CHANNEL]: "Shopee" }), classification(), "marketplace_order"],
        [order({ [ORDER_FIELDS.PAYMENT_STATUS]: "Paid" }), classification(), "paid_or_verified"],
        [order({ [ORDER_FIELDS.PAYMENT_VERIFIED]: true }), classification(), "paid_or_verified"],
        [order(), classification({ work_queue: "payment_review", has_payment_evidence: true }), "payment_review_pending"],
        [order({ [ORDER_FIELDS.ORDER_STATUS]: "Completed" }), classification(), "financial_transaction_completed"],
        [order({ [ORDER_FIELDS.ORDER_STATUS]: "Cancelled" }), classification(), "inactive_order"],
        [order({ [ORDER_FIELDS.ORDER_STATUS]: "Returned" }), classification(), "inactive_order"],
    ] as const)("ปฏิเสธ order ตาม policy %#", (record, context, reason) => {
        expect(resolveOrderAmountEditPolicy(record, context)).toEqual({ allowed: false, reason });
    });
});
