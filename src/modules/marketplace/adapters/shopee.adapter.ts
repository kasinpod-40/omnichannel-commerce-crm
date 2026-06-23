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
    const responseRecord = asRecord(root.response);
    const data = asRecord(root.data);

    return firstRecord(
        responseRecord.order_list,
        data.order_list,
        data.orders,
        root.order_list,
        root.orders,
        responseRecord.order,
        data.order,
        root.order,
        response
    );
}

function extractItems(order: Record<string, unknown>): MarketplaceOrderItem[] {
    return ensureItems(
        asArray(order.item_list ?? order.items).map((value) => {
            const item = asRecord(value);
            const quantity = positiveInteger(
                item.model_quantity ?? item.quantity,
                1
            );

            return {
                sku:
                    firstText(
                        item.model_sku,
                        item.item_sku,
                        item.sku
                    ) || undefined,
                name: firstText(
                    item.item_name,
                    item.product_name,
                    item.name
                ),
                variant:
                    firstText(
                        item.model_name,
                        item.variation,
                        item.variant
                    ) || undefined,
                quantity,
                unit_price: firstNumber(
                    item.model_discounted_price,
                    item.model_original_price,
                    item.unit_price,
                    item.price
                ),
            };
        })
    );
}

function extractTracking(order: Record<string, unknown>): {
    trackingNumber?: string;
    shippingProvider?: string;
} {
    const packageRecord = firstRecord(order.package_list);

    return {
        trackingNumber:
            firstText(
                order.tracking_number,
                order.tracking_no,
                packageRecord.tracking_number,
                packageRecord.tracking_no
            ) || undefined,
        shippingProvider:
            firstText(
                order.shipping_carrier,
                order.shipping_provider,
                packageRecord.shipping_carrier,
                packageRecord.shipping_provider
            ) || undefined,
    };
}

export function adaptShopeeThailand(
    envelope: MarketplaceSimulationEnvelope
): MarketplaceAdapterResult {
    const webhook = asRecord(envelope.webhook);
    const webhookData = asRecord(webhook.data);
    const order = extractOrderDetail(envelope.order_detail_response);
    const address = asRecord(
        order.recipient_address ?? order.shipping_address
    );
    const shopId = required(
        firstText(
            webhook.shop_id,
            webhookData.shop_id,
            order.shop_id
        ),
        "SHOPEE_MISSING_SHOP_ID"
    );
    const orderId = required(
        firstText(
            webhookData.order_sn,
            webhookData.ordersn,
            webhook.order_sn,
            webhook.ordersn,
            order.order_sn,
            order.ordersn
        ),
        "SHOPEE_MISSING_ORDER_SN"
    );
    const marketplaceStatus = required(
        firstText(
            webhookData.status,
            webhookData.order_status,
            webhook.status,
            webhook.order_status,
            order.order_status,
            order.status
        ),
        "SHOPEE_MISSING_ORDER_STATUS"
    );
    const updateTime = normalizeTimestampValue(
        webhookData.update_time ??
            webhookData.update_timestamp ??
            webhook.timestamp ??
            order.update_time
    );
    const buyerPhone = firstText(address.phone, order.buyer_phone);
    const buyerId = deriveBuyerId(
        order.buyer_user_id ?? order.buyer_username,
        buyerPhone,
        order.buyer_email,
        orderId
    );
    const tracking = extractTracking(order);
    const eventId = firstText(
        webhook.event_id,
        webhook.request_id,
        webhookData.event_id
    ) || stableEventId([
        "shopee-th",
        webhook.code ?? "order-status",
        shopId,
        orderId,
        marketplaceStatus,
        updateTime ?? webhook.timestamp,
    ]);

    return {
        channel: "Shopee",
        region: "TH",
        currency: "THB",
        source: {
            webhook_order_id: orderId,
            webhook_status: marketplaceStatus,
            webhook_timestamp: updateTime,
        },
        normalized: {
            channel: "Shopee",
            event_id: eventId,
            store_id: shopId,
            store_name: envelope.store_name,
            external_order_id: orderId,
            buyer: {
                id: buyerId,
                name:
                    firstText(
                        address.name,
                        order.buyer_username,
                        order.buyer_name
                    ) || undefined,
                phone: normalizeThaiPhone(buyerPhone),
                address:
                    joinAddressParts(
                        address.full_address,
                        address.address,
                        address.town,
                        address.district,
                        address.city,
                        address.state,
                        address.region,
                        address.zipcode,
                        address.postal_code
                    ) || undefined,
            },
            items: extractItems(order),
            currency: firstText(order.currency) || "THB",
            total_amount: firstNumber(
                order.total_amount,
                order.order_total,
                order.payable_amount
            ),
            marketplace_status: marketplaceStatus,
            marketplace_payment_status:
                firstText(
                    order.payment_status,
                    webhookData.payment_status,
                    Number(order.pay_time) > 0 ? "PAID" : ""
                ) || undefined,
            tracking_number: tracking.trackingNumber,
            shipping_provider: tracking.shippingProvider,
            created_at: normalizeTimestampValue(
                order.create_time ?? order.created_at
            ),
            updated_at:
                updateTime ??
                normalizeTimestampValue(order.update_time),
            paid_at: normalizeTimestampValue(
                order.pay_time ?? order.paid_at
            ),
        },
    };
}
