import { describe, expect, it } from "vitest";
import { ACTIVITY_FIELDS, CUSTOMER_FIELDS, ORDER_FIELDS } from "../../core/lark-fields";
import type { LarkActivityRecord } from "../activities/activity.repository";
import type { LarkCustomerRecord } from "../customers/customer.repository";
import type { LarkOrderRecord } from "./order.repository";
import { classifyOrderWorkQueue } from "./order-work-queue";

const customer: LarkCustomerRecord = {
    record_id: "rec-customer",
    fields: {
        [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Customer A",
        [CUSTOMER_FIELDS.PHONE]: "0812345678",
    },
};
const customers = new Map([[customer.record_id, customer]]);

function order(fields: Record<string, unknown> = {}): LarkOrderRecord {
    return {
        record_id: "rec-order",
        fields: {
            [ORDER_FIELDS.CUSTOMER]: [{ record_id: customer.record_id }],
            [ORDER_FIELDS.CHANNEL]: "LINE",
            [ORDER_FIELDS.ORDER_STATUS]: "Draft",
            [ORDER_FIELDS.PAYMENT_STATUS]: "Pending",
            [ORDER_FIELDS.CUSTOMER_NAME]: "Customer A",
            [ORDER_FIELDS.PHONE]: "0812345678",
            [ORDER_FIELDS.ADDRESS]: "Bangkok",
            ...fields,
        },
    };
}

function activity(action: string, at: number): LarkActivityRecord {
    return {
        record_id: `${action}-${at}`,
        fields: {
            [ACTIVITY_FIELDS.ACTION]: action,
            [ACTIVITY_FIELDS.CREATED_AT]: at,
            [ACTIVITY_FIELDS.NEW_VALUE]: JSON.stringify({ order_record_id: "rec-order" }),
        },
    };
}

describe("classifyOrderWorkQueue", () => {
    it("excludes cancelled pending orders from all active queues", () => {
        expect(classifyOrderWorkQueue(order({
            [ORDER_FIELDS.ORDER_STATUS]: "Cancelled",
        }), customers).work_queue).toBe("none");
    });

    it("keeps a rejected old slip in waiting_new_slip", () => {
        const result = classifyOrderWorkQueue(
            order(),
            customers,
            [activity("PAYMENT_REVIEW_REJECTED", 200), activity("PAYMENT_SLIP_RECEIVED", 100)]
        );
        expect(result.work_queue).toBe("waiting_new_slip");
    });

    it("moves a new slip after rejection back to payment_review", () => {
        const result = classifyOrderWorkQueue(
            order({ [ORDER_FIELDS.SLIP_AMOUNT]: 500 }),
            customers,
            [activity("PAYMENT_SLIP_RECEIVED", 300), activity("PAYMENT_REVIEW_REJECTED", 200)]
        );
        expect(result.work_queue).toBe("payment_review");
    });

    it("classifies paid orders by delivery completeness", () => {
        expect(classifyOrderWorkQueue(order({
            [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
            [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
            [ORDER_FIELDS.ADDRESS]: "",
        }), customers).work_queue).toBe("missing_delivery");

        expect(classifyOrderWorkQueue(order({
            [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
            [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
        }), customers).work_queue).toBe("ready_to_ship");
    });

    it("removes LINE orders from ready_to_ship once tracking exists", () => {
        expect(classifyOrderWorkQueue(order({
            [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
            [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
            [ORDER_FIELDS.TRACKING_NUMBER]: "TH123",
        }), customers).work_queue).toBe("none");
    });

    it("uses a dedicated marketplace ready-to-ship queue", () => {
        expect(classifyOrderWorkQueue(order({
            [ORDER_FIELDS.CHANNEL]: "Shopee",
            [ORDER_FIELDS.MARKETPLACE_STATUS]: "READY_TO_SHIP",
        }), customers).work_queue).toBe("marketplace_ready_to_ship");
    });
});
