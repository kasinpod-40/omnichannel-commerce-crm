import { describe, expect, it } from "vitest";
import { adaptShopeeThailand } from "./shopee.adapter";

describe("Shopee Thailand adapter", () => {
    it("normalizes an order status push plus get_order_detail response", () => {
        const result = adaptShopeeThailand({
            store_name: "ร้านทดสอบ Shopee TH",
            webhook: {
                code: 3,
                shop_id: 220688102,
                timestamp: 1782151200,
                data: {
                    ordersn: "260623TH000001",
                    status: "READY_TO_SHIP",
                    update_time: 1782151200,
                },
            },
            order_detail_response: {
                response: {
                    order_list: [
                        {
                            order_sn: "260623TH000001",
                            currency: "THB",
                            total_amount: 697,
                            order_status: "READY_TO_SHIP",
                            create_time: 1782147600,
                            update_time: 1782151200,
                            pay_time: 1782149400,
                            buyer_user_id: 99887766,
                            buyer_username: "ผู้ซื้อทดสอบ",
                            shipping_carrier: "SPX Express",
                            recipient_address: {
                                name: "สมชาย ใจดี",
                                phone: "+66 81 234 5678",
                                full_address: "99/1 ถนนสุขุมวิท",
                                district: "คลองเตย",
                                city: "กรุงเทพมหานคร",
                                zipcode: "10110",
                            },
                            item_list: [
                                {
                                    item_name: "เสื้อยืดสีดำ",
                                    item_sku: "SHIRT-BLACK",
                                    model_name: "Size S",
                                    model_sku: "SHIRT-BLACK-S",
                                    model_quantity: 2,
                                    model_discounted_price: 199,
                                },
                                {
                                    item_name: "กางเกงสีดำ",
                                    model_name: "Size M",
                                    model_sku: "PANTS-BLACK-M",
                                    model_quantity: 1,
                                    model_discounted_price: 299,
                                },
                            ],
                        },
                    ],
                },
            },
        });

        expect(result.region).toBe("TH");
        expect(result.normalized).toMatchObject({
            channel: "Shopee",
            store_id: "220688102",
            external_order_id: "260623TH000001",
            currency: "THB",
            total_amount: 697,
            marketplace_status: "READY_TO_SHIP",
            marketplace_payment_status: "PAID",
            shipping_provider: "SPX Express",
        });
        expect(result.normalized.buyer.phone).toBe("0812345678");
        expect(result.normalized.items).toHaveLength(2);
    });
});
