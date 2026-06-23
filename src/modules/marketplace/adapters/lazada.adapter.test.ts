import { describe, expect, it } from "vitest";
import { adaptLazadaThailand } from "./lazada.adapter";

describe("Lazada Thailand adapter", () => {
    it("normalizes a trade order webhook plus order and item API responses", () => {
        const result = adaptLazadaThailand({
            store_name: "ร้านทดสอบ Lazada TH",
            webhook: {
                seller_id: "1234567",
                message_type: 0,
                data: {
                    order_status: "ready_to_ship",
                    trade_order_id: "260623900198363",
                    trade_order_line_id: "260623900298363",
                    status_update_time: 1782151200,
                },
                timestamp: 1782151200000,
                site: "lazada_th",
            },
            order_detail_response: {
                data: {
                    order_number: "260623900198363",
                    created_at: "2026-06-23 00:00:00 +0700",
                    updated_at: "2026-06-23 01:00:00 +0700",
                    customer_first_name: "สมหญิง",
                    customer_last_name: "ใจดี",
                    customer_id: "lz-buyer-001",
                    currency: "THB",
                    price: "697.00",
                    statuses: ["ready_to_ship"],
                    payment_method: "COD",
                    address_shipping: {
                        first_name: "สมหญิง",
                        last_name: "ใจดี",
                        phone: "081-234-5678",
                        address1: "99/1 ถนนสุขุมวิท",
                        district: "คลองเตย",
                        city: "กรุงเทพมหานคร",
                        post_code: "10110",
                    },
                },
            },
            order_items_response: {
                data: [
                    {
                        shop_sku: "SHIRT-BLACK-S",
                        name: "เสื้อยืดสีดำ",
                        variation: "Size S",
                        paid_price: "199.00",
                        tracking_code: "LZTH123456789",
                        shipment_provider: "LEX TH",
                    },
                    {
                        shop_sku: "PANTS-BLACK-M",
                        name: "กางเกงสีดำ",
                        variation: "Size M",
                        paid_price: "498.00",
                    },
                ],
            },
        });

        expect(result.region).toBe("TH");
        expect(result.normalized).toMatchObject({
            channel: "Lazada",
            store_id: "1234567",
            external_order_id: "260623900198363",
            currency: "THB",
            total_amount: 697,
            marketplace_status: "ready_to_ship",
            tracking_number: "LZTH123456789",
            shipping_provider: "LEX TH",
        });
        expect(result.normalized.buyer.phone).toBe("0812345678");
        expect(result.normalized.items).toHaveLength(2);
    });
});

describe("Lazada Thailand checkout totals and COD payment", () => {
    it("includes net shipping fee in total_amount and keeps pending COD unpaid", () => {
        const result = adaptLazadaThailand({
            store_name: "Lazada 101522032146",
            webhook: {
                seller_id: "101522032146",
                message_type: 0,
                data: {
                    order_status: "pending",
                    trade_order_id: "1111485195215573",
                    status_update_time: "2026-06-23 17:28:14 +0700",
                },
            },
            order_detail_response: {
                data: {
                    order_number: "1111485195215573",
                    statuses: ["pending"],
                    currency: "THB",
                    price: "9.00",
                    shipping_fee: 29,
                    shipping_fee_original: 29,
                    payment_method: "COD",
                    address_shipping: {
                        first_name: "ก",
                        phone: "66812345678",
                    },
                },
            },
            order_items_response: {
                data: [
                    {
                        shop_sku: "SKU-1",
                        name: "เสื้อทีมตะกร้อ",
                        quantity: 1,
                        paid_price: 9,
                        shipping_amount: 29,
                    },
                ],
            },
        });

        expect(result.normalized.total_amount).toBe(38);
        expect(result.normalized.marketplace_payment_status).toBe("PENDING");
    });

    it("marks delivered COD as paid", () => {
        const result = adaptLazadaThailand({
            webhook: {
                seller_id: "101522032146",
                data: {
                    order_status: "delivered",
                    trade_order_id: "1111485195215573",
                },
            },
            order_detail_response: {
                data: {
                    order_number: "1111485195215573",
                    statuses: ["delivered"],
                    price: "9.00",
                    shipping_fee: 29,
                    payment_method: "COD",
                },
            },
            order_items_response: {
                data: [{ name: "เสื้อ", quantity: 1, paid_price: 9 }],
            },
        });

        expect(result.normalized.marketplace_payment_status).toBe("PAID");
    });
});
