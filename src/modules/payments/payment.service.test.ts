import { describe, expect, it } from "vitest";
import { getMissingDeliveryFields } from "./payment.service";

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
