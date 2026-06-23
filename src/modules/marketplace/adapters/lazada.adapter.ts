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
        data.order,
        data.orders,
        root.order,
        root.orders,
        data,
        response
    );
}

function extractItemRecords(
    order: Record<string, unknown>,
    orderItemsResponse: unknown
): Record<string, unknown>[] {
    const root = asRecord(orderItemsResponse);
    const data = root.data;
    const candidates = [
        data,
        asRecord(data).items,
        root.items,
        order.items,
        order.order_items,
    ];

    for (const candidate of candidates) {
        const records = asArray(candidate)
            .map(asRecord)
            .filter((item) => Object.keys(item).length > 0);

        if (records.length > 0) {
            return records;
        }
    }

    return [];
}

function extractItems(
    order: Record<string, unknown>,
    orderItemsResponse: unknown
): MarketplaceOrderItem[] {
    return ensureItems(
        extractItemRecords(order, orderItemsResponse).map((item) => ({
            sku:
                firstText(
                    item.shop_sku,
                    item.sku,
                    item.sku_id
                ) || undefined,
            name: firstText(
                item.name,
                item.item_name,
                item.product_name
            ),
            variant:
                firstText(
                    item.variation,
                    item.variant,
                    item.sku_name
                ) || undefined,
            quantity: positiveInteger(
                item.quantity ?? item.qty,
                1
            ),
            unit_price: firstNumber(
                item.paid_price,
                item.item_price,
                item.unit_price,
                item.price
            ),
        }))
    );
}

function sumItems(items: MarketplaceOrderItem[]): number {
    return items.reduce(
        (sum, item) =>
            sum + (item.unit_price ?? 0) * item.quantity,
        0
    );
}

function calculateOrderTotal(
    order: Record<string, unknown>,
    items: MarketplaceOrderItem[]
): number {
    const explicitGrandTotal = firstNumber(
        order.grand_total,
        order.total_amount,
        order.paid_amount,
        order.order_total,
        order.total_price
    );

    if (explicitGrandTotal > 0) {
        return explicitGrandTotal;
    }

    const itemSubtotal = firstNumber(
        order.price,
        order.subtotal,
        order.item_total,
        order.merchandise_subtotal
    ) || sumItems(items);
    const netShippingFee = firstNumber(
        order.shipping_fee,
        order.shipping_amount,
        order.delivery_fee
    );

    return itemSubtotal + netShippingFee;
}

function resolvePaymentStatus(
    order: Record<string, unknown>,
    webhookData: Record<string, unknown>,
    marketplaceStatus: string
): string | undefined {
    const explicitPaymentStatus = firstText(
        order.payment_status,
        webhookData.payment_status
    );

    if (explicitPaymentStatus) {
        return explicitPaymentStatus;
    }

    const normalizedOrderStatus = marketplaceStatus
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    const paymentMethod = firstText(
        order.payment_method,
        order.payment_type
    )
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
    const isCashOnDelivery =
        paymentMethod === "COD" ||
        paymentMethod.includes("CASH_ON_DELIVERY");

    if (
        normalizedOrderStatus === "UNPAID" ||
        normalizedOrderStatus === "WAITING_PAYMENT"
    ) {
        return "UNPAID";
    }

    if (isCashOnDelivery) {
        if (
            ["DELIVERED", "CONFIRMED", "COMPLETED"].includes(
                normalizedOrderStatus
            )
        ) {
            return "PAID";
        }

        return "PENDING";
    }

    return "PAID";
}

export function adaptLazadaThailand(
    envelope: MarketplaceSimulationEnvelope
): MarketplaceAdapterResult {
    const webhook = asRecord(envelope.webhook);
    const webhookData = asRecord(webhook.data);
    const order = extractOrderDetail(envelope.order_detail_response);
    const shippingAddress = asRecord(
        order.address_shipping ?? order.shipping_address
    );
    const sellerId = required(
        firstText(
            webhook.seller_id,
            webhookData.seller_id,
            order.seller_id
        ),
        "LAZADA_MISSING_SELLER_ID"
    );
    const orderId = required(
        firstText(
            webhookData.trade_order_id,
            webhookData.order_id,
            order.order_number,
            order.order_id,
            order.order_number_id
        ),
        "LAZADA_MISSING_ORDER_ID"
    );
    const statuses = asArray(order.statuses).map(firstText).filter(Boolean);
    const marketplaceStatus = required(
        firstText(
            webhookData.order_status,
            webhook.order_status,
            statuses[0],
            order.status
        ),
        "LAZADA_MISSING_ORDER_STATUS"
    );
    const updateTime = normalizeTimestampValue(
        webhookData.status_update_time ??
            webhook.timestamp ??
            order.updated_at
    );
    const items = extractItems(order, envelope.order_items_response);
    const buyerName = firstText(
        shippingAddress.first_name && shippingAddress.last_name
            ? `${firstText(shippingAddress.first_name)} ${firstText(shippingAddress.last_name)}`
            : "",
        order.customer_first_name && order.customer_last_name
            ? `${firstText(order.customer_first_name)} ${firstText(order.customer_last_name)}`
            : "",
        shippingAddress.first_name,
        order.customer_first_name
    );
    const buyerPhone = firstText(
        shippingAddress.phone,
        shippingAddress.phone2,
        order.customer_phone
    );
    const buyerId = deriveBuyerId(
        order.buyer_id ?? order.customer_id,
        buyerPhone,
        order.customer_email,
        orderId
    );
    const firstItem = firstRecord(
        asArray(asRecord(envelope.order_items_response).data),
        order.items,
        order.order_items
    );
    const eventId = firstText(
        webhook.event_id,
        webhook.message_id,
        webhook.request_id
    ) || stableEventId([
        "lazada-th",
        webhook.message_type ?? "trade-order",
        sellerId,
        orderId,
        webhookData.trade_order_line_id,
        marketplaceStatus,
        updateTime,
    ]);
    const totalAmount = calculateOrderTotal(order, items);

    return {
        channel: "Lazada",
        region: "TH",
        currency: "THB",
        source: {
            webhook_order_id: orderId,
            webhook_status: marketplaceStatus,
            webhook_timestamp: updateTime,
        },
        normalized: {
            channel: "Lazada",
            event_id: eventId,
            store_id: sellerId,
            store_name: envelope.store_name,
            external_order_id: orderId,
            buyer: {
                id: buyerId,
                name: buyerName || undefined,
                phone: normalizeThaiPhone(buyerPhone),
                address:
                    joinAddressParts(
                        shippingAddress.address1,
                        shippingAddress.address2,
                        shippingAddress.address3,
                        shippingAddress.address4,
                        shippingAddress.address5,
                        shippingAddress.ward,
                        shippingAddress.district,
                        shippingAddress.city,
                        shippingAddress.province,
                        shippingAddress.region,
                        shippingAddress.post_code,
                        shippingAddress.postal_code
                    ) || undefined,
            },
            items,
            currency:
                firstText(
                    order.currency,
                    firstItem.currency
                ) || "THB",
            total_amount: totalAmount,
            marketplace_status: marketplaceStatus,
            marketplace_payment_status: resolvePaymentStatus(
                order,
                webhookData,
                marketplaceStatus
            ),
            tracking_number:
                firstText(
                    order.tracking_code,
                    firstItem.tracking_code,
                    firstItem.tracking_number
                ) || undefined,
            shipping_provider:
                firstText(
                    order.shipping_provider,
                    firstItem.shipment_provider,
                    firstItem.shipping_provider_type
                ) || undefined,
            created_at: normalizeTimestampValue(
                order.created_at ?? order.create_time
            ),
            updated_at:
                updateTime ??
                normalizeTimestampValue(order.updated_at),
            paid_at: normalizeTimestampValue(
                order.paid_at ?? order.pay_time
            ),
        },
    };
}
