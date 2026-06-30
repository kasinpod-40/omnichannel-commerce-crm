import { describe, expect, it } from "vitest";
import { resolveOrderPaymentDisplayState } from "./order-payment-state";

describe("resolveOrderPaymentDisplayState", () => {
    it.each([
        [{ paymentStatus: "Pending", paymentVerified: false, workQueue: "waiting_payment" as const }, "unpaid"],
        [{ paymentStatus: "Pending", paymentVerified: false, workQueue: "payment_review" as const }, "payment_review"],
        [{ paymentStatus: "Pending", paymentVerified: false, workQueue: "waiting_new_slip" as const }, "unpaid"],
        [{ paymentStatus: "Paid", paymentVerified: false, workQueue: "none" as const }, "paid"],
        [{ paymentStatus: "Pending", paymentVerified: true, workQueue: "missing_delivery" as const }, "paid"],
        [{ paymentStatus: "Overdue", paymentVerified: false, workQueue: "waiting_payment" as const }, "overdue"],
    ] as const)("จำแนก payment display state %#", (input, expected) => {
        expect(resolveOrderPaymentDisplayState(input)).toBe(expected);
    });
});
