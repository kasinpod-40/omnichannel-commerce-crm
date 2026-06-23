import { describe, expect, it } from "vitest";
import { mapMarketplaceStatus } from "./marketplace-status";

describe("marketplace status mapping", () => {
    it("maps Shopee ready-to-ship as paid and ready to ship", () => {
        expect(
            mapMarketplaceStatus(
                "Shopee",
                "READY_TO_SHIP",
                "PAID"
            )
        ).toEqual({
            order_status: "Ready to Ship",
            payment_status: "Paid",
            payment_verified: true,
        });
    });

    it("maps Lazada unpaid as waiting payment", () => {
        expect(
            mapMarketplaceStatus(
                "Lazada",
                "unpaid",
                "unpaid"
            )
        ).toEqual({
            order_status: "Waiting Payment",
            payment_status: "Waiting Payment",
            payment_verified: false,
        });
    });

    it.each(["delivered", "confirmed", "completed"])(
        "maps Lazada %s as completed",
        (status) => {
            expect(
                mapMarketplaceStatus(
                    "Lazada",
                    status,
                    "PAID"
                )
            ).toEqual({
                order_status: "Completed",
                payment_status: "Paid",
                payment_verified: true,
            });
        }
    );

    it("maps TikTok in transit as shipped", () => {
        expect(
            mapMarketplaceStatus(
                "TikTok",
                "IN_TRANSIT",
                "PAID"
            )
        ).toEqual({
            order_status: "Shipped",
            payment_status: "Paid",
            payment_verified: true,
        });
    });

    it("maps returned/refunded orders", () => {
        expect(
            mapMarketplaceStatus(
                "Shopee",
                "TO_RETURN",
                "REFUNDED"
            )
        ).toEqual({
            order_status: "Returned",
            payment_status: "Refunded",
            payment_verified: false,
        });
    });
});
