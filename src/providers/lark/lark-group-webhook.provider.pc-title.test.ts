import { describe, expect, it } from "vitest";
import { resolveLarkGroupWebhookTarget } from "./lark-group-webhook.provider";

describe("readable Production & Stock notification routing", () => {
    it("routes the new low-stock title to the Production & Stock group", () => {
        expect(
            resolveLarkGroupWebhookTarget(
                "[CRM] 📦 สินค้าใกล้หมด\n\nสินค้า: Demo Product"
            )
        ).toBe("production-control");
    });

    it("routes the out-of-stock title to the Production & Stock group", () => {
        expect(
            resolveLarkGroupWebhookTarget(
                "[CRM] 📦 สินค้าหมด\n\nสินค้า: Demo Product"
            )
        ).toBe("production-control");
    });

    it("does not route ordinary CRM text from a detail-line keyword", () => {
        expect(
            resolveLarkGroupWebhookTarget(
                "[CRM] 🔔 การแจ้งเตือน\nรายละเอียด: 📦 สินค้าใกล้หมด"
            )
        ).toBe("crm");
    });
});
