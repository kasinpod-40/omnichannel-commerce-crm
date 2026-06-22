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

describe("Thai natural-language quantity extraction", () => {
    it("maps ตัวเดียว to quantity 1", () => {
        const result = analyzeByRuleEngine(
            "เอาแค่ตัวเดียวครับ"
        );

        expect(result.intent).toBe("product_order");
        expect(result.quantity).toBe(1);
        expect(result.product_unit).toBe("ตัว");
        expect(result.quantity_action).toBeUndefined();
    });

    it("extracts product and quantity from a one-unit order", () => {
        const result = analyzeByRuleEngine(
            "เอาเสื้อรุ่นใหม่ X แค่ตัวเดียวครับ"
        );

        expect(result.intent).toBe("product_order");
        expect(result.product_name).toBe("เสื้อรุ่นใหม่ X");
        expect(result.quantity).toBe(1);
        expect(result.product_unit).toBe("ตัว");
    });

    it("maps Thai quantity words to numbers", () => {
        const result = analyzeByRuleEngine(
            "เอาเสื้อรุ่น Y หนึ่งตัวครับ"
        );

        expect(result.intent).toBe("product_order");
        expect(result.product_name).toBe("เสื้อรุ่น Y");
        expect(result.quantity).toBe(1);
        expect(result.product_unit).toBe("ตัว");
    });

    it("maps Thai digits to Arabic quantity", () => {
        const result = analyzeByRuleEngine(
            "เอาเสื้อรุ่น Z ๑ ตัวครับ"
        );

        expect(result.intent).toBe("product_order");
        expect(result.product_name).toBe("เสื้อรุ่น Z");
        expect(result.quantity).toBe(1);
        expect(result.product_unit).toBe("ตัว");
    });

    it("treats เพิ่มอีกชิ้นเดียว as add quantity 1", () => {
        const result = analyzeByRuleEngine(
            "ขอเพิ่มอีกชิ้นเดียวครับ"
        );

        expect(result.intent).toBe("product_order");
        expect(result.quantity).toBe(1);
        expect(result.product_unit).toBe("ชิ้น");
        expect(result.quantity_action).toBe("add");
    });
});


describe("fashion product size extraction", () => {
    it("keeps a size-only order out of product_name", () => {
        const result = analyzeByRuleEngine(
            "เอาไซต์ s 1 ตัวครับ"
        );

        expect(result.intent).toBe("product_order");
        expect(result.product_name).toBeUndefined();
        expect(result.product_size).toBe("S");
        expect(result.quantity).toBe(1);
        expect(result.product_unit).toBe("ตัว");
    });

    it("separates product name and size in the same order", () => {
        const result = analyzeByRuleEngine(
            "เอาเสื้อยืดไซส์ M 2 ตัวครับ"
        );

        expect(result.intent).toBe("product_order");
        expect(result.product_name).toBe("เสื้อยืด");
        expect(result.product_size).toBe("M");
        expect(result.quantity).toBe(2);
    });

    it("supports numeric clothing sizes", () => {
        const result = analyzeByRuleEngine(
            "เอาขนาด 38 1 ตัวครับ"
        );

        expect(result.product_name).toBeUndefined();
        expect(result.product_size).toBe("38");
        expect(result.quantity).toBe(1);
    });
});
