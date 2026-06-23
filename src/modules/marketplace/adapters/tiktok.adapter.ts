import type { MarketplaceOrderItem } from "../marketplace.types";
import type {
    MarketplaceAdapterResult,
    MarketplaceSimulationEnvelope,
} from "./adapter.types";
import {
    asArray,
    asRecord,
    deriveBuyerId,
    ensureItems,
    firstNumber,
    firstRecord,
    firstText,
    joinAddressParts,
    normalizeThaiPhone,
    normalizeTimestampValue,
    positiveInteger,
    required,
    stableEventId,
} from "./adapter.utils";

function extractOrderDetail(response: unknown): Record<string, unknown> {
    const root = asRecord(response);
    const data = asRecord(root.data);

    return firstRecord(
        data.orders,
        data.order,
        root.orders,
        root.order,
        data,
        response
    );
}

function extractItems(order: Record<string, unknown>): MarketplaceOrderItem[] {
    return ensureItems(
        asArray(order.line_items ?? order.items).map((value) => {
            const item = asRecord(value);

            return {
                sku:
                    firstText(
                        item.seller_sku,
                        item.sku_id,
                        item.sku
                    ) || undefined,
                name: firstText(
                    item.product_name,
                    item.item_name,
                    item.name
                ),
                variant:
                    firstText(
                        item.sku_name,
                        item.variant,
                        item.variation
                    ) || undefined,
                quantity: positiveInteger(
                    item.quantity ?? item.qty,
                    1
                ),
                unit_price: firstNumber(
                    item.sale_price,
                    item.original_price,
                    item.unit_price,
                    item.price
                ),
            };
        })
    );
}

export function adaptTikTokThailand(
    envelope: MarketplaceSimulationEnvelope
): MarketplaceAdapterResult {
    const webhook = asRecord(envelope.webhook);
    const webhookData = asRecord(webhook.data);
    const order = extractOrderDetail(envelope.order_detail_response);
    const recipient = asRecord(order.recipient_address);
    const payment = asRecord(order.payment);
    const shopId = required(
        firstText(
            webhook.shop_id,
            webhookData.shop_id,
            order.shop_id
        ),
        "TIKTOK_MISSING_SHOP_ID"
    );
    const orderId = required(
        firstText(
            webhookData.order_id,
            webhook.order_id,
            order.id,
            order.order_id
        ),
        "TIKTOK_MISSING_ORDER_ID"
    );
    const marketplaceStatus = required(
        firstText(
            webhookData.order_status,
            webhook.order_status,
            order.status,
            order.order_status
        ),
        "TIKTOK_MISSING_ORDER_STATUS"
    );
    const updateTime = normalizeTimestampValue(
        webhookData.update_time ??
            webhook.timestamp ??
            order.update_time
    );
    const buyerPhone = firstText(
        recipient.phone_number,
        recipient.phone,
        order.buyer_phone
    );
    const buyerId = deriveBuyerId(
        order.buyer_user_id ?? order.buyer_id,
        buyerPhone,
        order.buyer_email,
        orderId
    );
    const firstLine = firstRecord(order.line_items ?? order.items);
    const packageRecord = firstRecord(order.packages ?? order.package_list);
    const eventId = firstText(
        webhook.event_id,
        webhook.event_idempotency_key,
        webhook.request_id
    ) || stableEventId([
        "tiktok-th",
        webhook.type ?? webhook.event ?? "order-status-change",
        shopId,
        orderId,
        marketplaceStatus,
        updateTime,
    ]);

    return {
        channel: "TikTok",
        region: "TH",
        currency: "THB",
        source: {
            webhook_order_id: orderId,
            webhook_status: marketplaceStatus,
            webhook_timestamp: updateTime,
        },
        normalized: {
            channel: "TikTok",
            event_id: eventId,
            store_id: shopId,
            store_name: envelope.store_name,
            external_order_id: orderId,
            buyer: {
                id: buyerId,
                name:
                    firstText(
                        recipient.name,
                        recipient.full_name,
                        order.buyer_name
                    ) || undefined,
                phone: normalizeThaiPhone(buyerPhone),
                address:
                    joinAddressParts(
                        recipient.full_address,
                        recipient.address_detail,
                        recipient.address_line1,
                        recipient.address_line2,
                        asArray(recipient.district_info).map((value) =>
                            firstText(asRecord(value).address_name)
                        ),
                        recipient.postal_code,
                        recipient.zip_code
                    ) || undefined,
            },
            items: extractItems(order),
            currency:
                firstText(
                    payment.currency,
                    order.currency,
                    firstLine.currency
                ) || "THB",
            total_amount: firstNumber(
                payment.total_amount,
                payment.grand_total,
                order.total_amount,
                order.order_total
            ),
            marketplace_status: marketplaceStatus,
            marketplace_payment_status:
                firstText(
                    payment.status,
                    payment.payment_status,
                    order.payment_status,
                    marketplaceStatus === "UNPAID"
                        ? "UNPAID"
                        : "PAID"
                ) || undefined,
            tracking_number:
                firstText(
                    order.tracking_number,
                    firstLine.tracking_number,
                    packageRecord.tracking_number
                ) || undefined,
            shipping_provider:
                firstText(
                    order.shipping_provider_name,
                    firstLine.shipping_provider_name,
                    packageRecord.shipping_provider_name,
                    order.delivery_option_name
                ) || undefined,
            created_at: normalizeTimestampValue(
                order.create_time ?? order.created_at
            ),
            updated_at:
                updateTime ??
                normalizeTimestampValue(order.update_time),
            paid_at: normalizeTimestampValue(
                order.paid_time ?? payment.paid_time
            ),
        },
    };
}
