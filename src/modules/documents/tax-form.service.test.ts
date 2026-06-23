import { describe, expect, it } from "vitest";
import { validateTaxFormSubmission } from "./tax-form.service";

describe("tax form submission", () => {
    it("normalizes valid Thailand tax data", () => {
        expect(
            validateTaxFormSubmission({
                tax_name: "บริษัท ทดสอบ จำกัด",
                tax_address: "99/1 กรุงเทพมหานคร 10110",
                tax_id: "0-1000-00000-00-0",
                tax_branch: "สำนักงานใหญ่",
                consent: "accepted",
            })
        ).toEqual({
            tax_name: "บริษัท ทดสอบ จำกัด",
            tax_address: "99/1 กรุงเทพมหานคร 10110",
            tax_id: "0100000000000",
            tax_branch: "สำนักงานใหญ่",
        });
    });

    it("rejects missing consent and invalid tax id", () => {
        expect(() =>
            validateTaxFormSubmission({
                tax_name: "A",
                tax_address: "B",
                tax_id: "123",
                consent: "accepted",
            })
        ).toThrow("TAX_ID_INVALID");

        expect(() =>
            validateTaxFormSubmission({
                tax_name: "A",
                tax_address: "B",
                tax_id: "0100000000000",
            })
        ).toThrow("TAX_FORM_INCOMPLETE:consent");
    });
});
