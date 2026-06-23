import { describe, expect, it } from "vitest";
import { parseMarketplaceOrderInput } from "./marketplace-normalizer";

describe("marketplace order input", () => {
    it("normalizes a valid order", () => {
        const result = parseMarketplaceOrderInput({
            channel: "Shopee",
            event_id: "evt-1",
            store_id: "shop-1",
            external_order_id: "SP-1001",
            buyer: {
                id: "buyer-1",
                name: "Buyer",
            },
            items: [
                {
                    name: "เสื้อ",
                    variant: "S",
                    quantity: "2",
                    unit_price: "199",
                },
            ],
            total_amount: "398",
            marketplace_status: "READY_TO_SHIP",
        });

        expect(result).toMatchObject({
            channel: "Shopee",
            event_id: "evt-1",
            store_id: "shop-1",
            external_order_id: "SP-1001",
            total_amount: 398,
            currency: "THB",
        });
        expect(result.items).toEqual([
            {
                name: "เสื้อ",
                variant: "S",
                quantity: 2,
                unit_price: 199,
            },
        ]);
    });

    it("rejects an unsupported channel", () => {
        expect(() =>
            parseMarketplaceOrderInput({
                channel: "Facebook",
            })
        ).toThrow("MARKETPLACE_INVALID_CHANNEL");
    });

    it("requires at least one valid item", () => {
        expect(() =>
            parseMarketplaceOrderInput({
                channel: "Lazada",
                event_id: "evt-1",
                store_id: "shop-1",
                external_order_id: "LZ-1",
                buyer: { id: "buyer-1" },
                items: [],
                total_amount: 0,
                marketplace_status: "pending",
            })
        ).toThrow("MARKETPLACE_ITEMS_REQUIRED");
    });
});
