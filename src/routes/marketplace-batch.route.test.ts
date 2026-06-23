import { describe, expect, it } from "vitest";
import type { Env } from "../config/env";
import { handleMarketplaceManualBatch } from "./marketplace-batch.route";

const env = {
    NOTIFICATION_DISPATCH_TOKEN: "test-admin-token",
} as Env;

function request(body: unknown): Request {
    return new Request(
        "https://example.com/admin/marketplace/manual/batch",
        {
            method: "POST",
            headers: {
                Authorization: "Bearer test-admin-token",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        }
    );
}

function shopeeOrder() {
    return {
        channel: "Shopee",
        reference: "shopee-new-order",
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
                                model_name: "Size S",
                                model_sku: "SHIRT-BLACK-S",
                                model_quantity: 2,
                                model_discounted_price: 199,
                            },
                        ],
                    },
                ],
            },
        },
    };
}

function tiktokOrder() {
    return {
        channel: "TikTok",
        reference: "tiktok-new-order",
        store_name: "ร้านทดสอบ TikTok Shop TH",
        webhook: {
            type: 1,
            shop_id: "7495540735365777507",
            timestamp: 1782151200,
            data: {
                order_id: "576653688135258178",
                order_status: "AWAITING_SHIPMENT",
                update_time: 1782151200,
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
                        ],
                    },
                ],
            },
        },
    };
}

describe("Shopee + TikTok manual batch route", () => {
    it("normalizes both channels in one dry-run request", async () => {
        const response = await handleMarketplaceManualBatch(
            request({
                dry_run: true,
                orders: [shopeeOrder(), tiktokOrder()],
            }),
            env
        );
        const payload = await response.json() as any;

        expect(response.status).toBe(200);
        expect(payload.ok).toBe(true);
        expect(payload.summary).toMatchObject({
            requested: 2,
            processed: 2,
            succeeded: 2,
            failed: 0,
            dry_run: 2,
            by_channel: {
                Shopee: 1,
                TikTok: 1,
            },
        });
        expect(payload.results[0].normalized).toMatchObject({
            channel: "Shopee",
            external_order_id: "260623TH000001",
            marketplace_status: "READY_TO_SHIP",
            currency: "THB",
        });
        expect(payload.results[1].normalized).toMatchObject({
            channel: "TikTok",
            external_order_id: "576653688135258178",
            marketplace_status: "AWAITING_SHIPMENT",
            currency: "THB",
        });
    });

    it("continues and reports an invalid order without hiding successful items", async () => {
        const invalid = {
            ...tiktokOrder(),
            reference: "invalid-tiktok",
            webhook: {},
            order_detail_response: {},
        };
        const response = await handleMarketplaceManualBatch(
            request({
                dry_run: true,
                continue_on_error: true,
                orders: [shopeeOrder(), invalid],
            }),
            env
        );
        const payload = await response.json() as any;

        expect(response.status).toBe(207);
        expect(payload.ok).toBe(false);
        expect(payload.summary).toMatchObject({
            requested: 2,
            processed: 2,
            succeeded: 1,
            failed: 1,
        });
        expect(payload.results[0].ok).toBe(true);
        expect(payload.results[1]).toMatchObject({
            ok: false,
            reference: "invalid-tiktok",
            error: {
                code: "INVALID_MARKETPLACE_ORDER",
            },
        });
    });

    it("requires an admin token", async () => {
        const unauthorized = new Request(
            "https://example.com/admin/marketplace/manual/batch",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    dry_run: true,
                    orders: [shopeeOrder()],
                }),
            }
        );
        const response = await handleMarketplaceManualBatch(
            unauthorized,
            env
        );

        expect(response.status).toBe(401);
    });
});
