import { describe, expect, it } from "vitest";
import {
    getMissingDeliveryFields,
    resolveVerifiedTotalAmount,
} from "./payment.service";

describe("CASE 19.3 delivery readiness", () => {
    it("requires both address and phone before sale completion", () => {
        expect(
            getMissingDeliveryFields(
                "99/1 ถนนสุขุมวิท กรุงเทพ 10110",
                "0812345678"
            )
        ).toEqual([]);
    });

    it("reports a missing phone", () => {
        expect(
            getMissingDeliveryFields(
                "99/1 ถนนสุขุมวิท กรุงเทพ 10110",
                ""
            )
        ).toEqual(["phone"]);
    });

    it("reports a missing address", () => {
        expect(
            getMissingDeliveryFields("", "+66 81 234 5678")
        ).toEqual(["address"]);
    });

    it("rejects an invalid phone even when text is present", () => {
        expect(
            getMissingDeliveryFields(
                "99/1 ถนนสุขุมวิท กรุงเทพ 10110",
                "10110"
            )
        ).toEqual(["phone"]);
    });
});


describe("verified slip amount to total_amount", () => {
    it("uses the verified slip amount when it is positive", () => {
        expect(resolveVerifiedTotalAmount(0, 1290)).toBe(1290);
        expect(resolveVerifiedTotalAmount(999, 1290)).toBe(1290);
    });

    it("does not overwrite an existing total with zero", () => {
        expect(resolveVerifiedTotalAmount(999, 0)).toBe(999);
        expect(resolveVerifiedTotalAmount(999, Number.NaN)).toBe(999);
    });
});
