import { describe, expect, it } from "vitest";
import { analyzeByRuleEngine } from "./rule-engine";

describe("CASE 19.3 phone extraction", () => {
    it("detects a phone-only message without opening a new order intent", () => {
        const result = analyzeByRuleEngine(
            "เบอร์โทร 081-234-5678 ครับ"
        );

        expect(result.intent).toBe("general_inquiry");
        expect(result.phone).toBe("0812345678");
        expect(result.customer_stage).toBe("New Lead");
    });

    it("extracts phone and address from the same message", () => {
        const result = analyzeByRuleEngine(
            "ที่อยู่ 99/1 ถนนสุขุมวิท แขวงคลองตัน กรุงเทพ 10110 เบอร์ 081-234-5678"
        );

        expect(result.intent).toBe("delivery_address");
        expect(result.phone).toBe("0812345678");
        expect(result.address).toContain("99/1 ถนนสุขุมวิท");
        expect(result.address).toContain("10110");
        expect(result.address).not.toContain("081");
        expect(result.address).not.toContain("เบอร์");
    });

    it("removes contact name and phone that appear before the address", () => {
        const result = analyzeByRuleEngine(
            "ชื่อ สมชาย เบอร์ 081-234-5678 ที่อยู่ 99/1 ถนนสุขุมวิท กรุงเทพ 10110"
        );

        expect(result.intent).toBe("delivery_address");
        expect(result.phone).toBe("0812345678");
        expect(result.address).toBe(
            "99/1 ถนนสุขุมวิท กรุงเทพ 10110"
        );
    });

    it("keeps postal codes from being classified as phone numbers", () => {
        const result = analyzeByRuleEngine(
            "ที่อยู่ 55 ถนนสุขุมวิท กรุงเทพ 10110"
        );

        expect(result.intent).toBe("delivery_address");
        expect(result.phone).toBeUndefined();
    });
});
