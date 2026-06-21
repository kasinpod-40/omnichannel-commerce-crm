import { describe, expect, it } from "vitest";
import {
    extractPhoneNumber,
    normalizePhoneNumber,
    removePhoneNumbers,
} from "./phone";

describe("normalizePhoneNumber", () => {
    it.each([
        ["0812345678", "0812345678"],
        ["081-234-5678", "0812345678"],
        ["081 234 5678", "0812345678"],
        ["+66 81 234 5678", "0812345678"],
        ["66-81-234-5678", "0812345678"],
        ["0066 81 234 5678", "0812345678"],
        ["+66 (0)81 234 5678", "0812345678"],
        ["๐๘๑-๒๓๔-๕๖๗๘", "0812345678"],
        ["02-123-4567", "021234567"],
    ])("normalizes %s", (input, expected) => {
        expect(normalizePhoneNumber(input)).toBe(expected);
    });

    it.each([
        "",
        "10100",
        "123456789012",
        "081-234-56789",
        "order-08123456789",
    ])("rejects invalid value %s", (input) => {
        expect(normalizePhoneNumber(input)).toBeUndefined();
    });
});

describe("extractPhoneNumber", () => {
    it("extracts a phone from a delivery message", () => {
        expect(
            extractPhoneNumber(
                "ส่งที่ 99/1 ถนนสุขุมวิท กรุงเทพ 10110 เบอร์ 081-234-5678"
            )
        ).toBe("0812345678");
    });

    it("supports a country-code phone", () => {
        expect(
            extractPhoneNumber("โทรกลับ +66 89 999 8888 ครับ")
        ).toBe("0899998888");
    });

    it("supports a country code with the optional trunk zero", () => {
        expect(
            extractPhoneNumber(
                "โทรกลับ +66 (0)81 234 5678 ครับ"
            )
        ).toBe("0812345678");
    });

    it("does not treat a postal code as a phone", () => {
        expect(
            extractPhoneNumber(
                "99/1 ถนนสุขุมวิท แขวงคลองตัน กรุงเทพ 10110"
            )
        ).toBeUndefined();
    });
});

describe("removePhoneNumbers", () => {
    it("removes only the phone number", () => {
        expect(
            removePhoneNumbers(
                "99/1 ถนนสุขุมวิท 10110 โทร 081-234-5678"
            )
        ).toBe("99/1 ถนนสุขุมวิท 10110 โทร");
    });
});
