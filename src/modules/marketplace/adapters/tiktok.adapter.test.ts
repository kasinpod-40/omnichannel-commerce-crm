import { describe, expect, it } from "vitest";
import { adaptTikTokThailand } from "./tiktok.adapter";

describe("TikTok Shop Thailand adapter", () => {
    it("normalizes order status webhook and get order detail response", () => {
        const result = adaptTikTokThailand({
            store_name: "ร้านทดสอบ TikTok Shop TH",
            webhook: {
                type: 1,
                shop_id: "7495540735365777507",
                timestamp: 1782151200,
                data: {
                    order_id: "576653688135258178",
                    order_status: "AWAITING_SHIPMENT",
                    update_time: 1782151200,
                    is_on_hold_order: false,
                },
            },
            order_detail_response: {
                code: 0,
                message: "Success",
                data: {
                    orders: [
                        {
                            id: "576653688135258178",
                            status: "AWAITING_SHIPMENT",
                            create_time: 1782147600,
                            update_time: 1782151200,
                            paid_time: 1782149400,
                            buyer_user_id: "tt-buyer-001",
                            recipient_address: {
                                name: "สมชาย ใจดี",
                                phone_number: "+66812345678",
                                full_address: "99/1 ถนนสุขุมวิท",
                                postal_code: "10110",
                                district_info: [
                                    { address_name: "คลองเตย" },
                                    { address_name: "กรุงเทพมหานคร" },
                                ],
                            },
                            payment: {
                                currency: "THB",
                                total_amount: "697.00",
                                status: "PAID",
                            },
                            line_items: [
                                {
                                    product_name: "เสื้อยืดสีดำ",
                                    sku_name: "Size S",
                                    seller_sku: "SHIRT-BLACK-S",
                                    quantity: 2,
                                    sale_price: "199.00",
                                    tracking_number: "TTTH123456789",
                                    shipping_provider_name: "J&T Express TH",
                                },
                                {
                                    product_name: "กางเกงสีดำ",
                                    sku_name: "Size M",
                                    seller_sku: "PANTS-BLACK-M",
                                    quantity: 1,
                                    sale_price: "299.00",
                                },
                            ],
                        },
                    ],
                },
            },
        });

        expect(result.region).toBe("TH");
        expect(result.normalized).toMatchObject({
            channel: "TikTok",
            store_id: "7495540735365777507",
            external_order_id: "576653688135258178",
            currency: "THB",
            total_amount: 697,
            marketplace_status: "AWAITING_SHIPMENT",
            marketplace_payment_status: "PAID",
            tracking_number: "TTTH123456789",
            shipping_provider: "J&T Express TH",
        });
        expect(result.normalized.buyer.phone).toBe("0812345678");
        expect(result.normalized.items).toHaveLength(2);
    });
});
