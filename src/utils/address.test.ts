import { describe, expect, it } from "vitest";
import { cleanDeliveryAddress } from "./address";

describe("cleanDeliveryAddress", () => {
    it.each([
        ["จัดส่ง 88/8 ถนนสุขุมวิท กรุงเทพ 10110", "88/8 ถนนสุขุมวิท กรุงเทพ 10110"],
        ["จัดส่งที่: 88/8 ถนนสุขุมวิท", "88/8 ถนนสุขุมวิท"],
        ["ส่งที่ 99/1 ถนนพหลโยธิน", "99/1 ถนนพหลโยธิน"],
        ["ส่งของไปที่ 7/7 ซอย 5", "7/7 ซอย 5"],
        ["ที่อยู่จัดส่ง - 12 หมู่ 3", "12 หมู่ 3"],
        ["88/8 ถนนสุขุมวิท กรุงเทพ 10110", "88/8 ถนนสุขุมวิท กรุงเทพ 10110"],
    ])("cleans %s", (input, expected) => {
        expect(cleanDeliveryAddress(input)).toBe(expected);
    });

    it("keeps real address words", () => {
        expect(
            cleanDeliveryAddress(
                "123 ถนนจัดสรร ตำบลในเมือง"
            )
        ).toBe("123 ถนนจัดสรร ตำบลในเมือง");
    });
});
