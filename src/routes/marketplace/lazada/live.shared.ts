import type { Env } from "../../../config/env";
import {
    getLazadaOrderDetail,
    getLazadaOrderItems,
    getLazadaOrderTrace,
} from "../../../modules/marketplace/lazada/lazada.api";
import type {
    LazadaSellerCredential,
    LazadaWebhookEnvelope,
} from "../../../modules/marketplace/lazada/lazada.types";
import { escapeHtml } from "../../shared/http";
import { asRecord, firstText, text } from "../../shared/value";

export function oauthResultPage(input: {
    ok: boolean;
    title: string;
    message: string;
    sellers?: LazadaSellerCredential[];
}): string {
    const color = input.ok ? "#0f9d68" : "#d93025";
    const rows = (input.sellers ?? [])
        .map(
            (seller) => `
                <li>
                    <strong>${escapeHtml(seller.account || seller.seller_id)}</strong><br />
                    Seller ID: ${escapeHtml(seller.seller_id)}<br />
                    Country: ${escapeHtml(seller.country.toUpperCase())}
                </li>`
        )
        .join("");

    return `<!doctype html>
<html lang="th">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f7fb; margin: 0; padding: 32px; color: #1f2937; }
        .card { max-width: 680px; margin: 48px auto; background: white; border-radius: 18px; padding: 32px; box-shadow: 0 12px 36px rgba(15, 23, 42, .10); }
        h1 { color: ${color}; margin-top: 0; }
        li { margin: 14px 0; line-height: 1.6; }
        .note { color: #64748b; margin-top: 24px; }
    </style>
</head>
<body>
    <main class="card">
        <h1>${escapeHtml(input.title)}</h1>
        <p>${escapeHtml(input.message)}</p>
        ${rows ? `<ul>${rows}</ul>` : ""}
        <p class="note">สามารถปิดหน้านี้และกลับไปที่ Lazada Open Platform ได้</p>
    </main>
</body>
</html>`;
}

export function extractWebhookIdentity(webhook: LazadaWebhookEnvelope): {
    sellerId: string;
    orderId: string;
    orderStatus: string;
    messageType: string;
} {
    const data = asRecord(webhook.data);

    return {
        sellerId: firstText(webhook.seller_id, data.seller_id),
        orderId: firstText(
            data.trade_order_id,
            data.order_id,
            data.tradeOrderId
        ),
        orderStatus: firstText(
            data.order_status,
            data.status,
            webhook.order_status
        ),
        messageType: firstText(
            webhook.message_type,
            data.message_type,
            "unknown"
        ),
    };
}

function orderRecord(orderDetail: unknown): Record<string, unknown> {
    const root = asRecord(orderDetail);
    const data = asRecord(root.data);
    const candidates = [
        data.order,
        data.orders,
        root.order,
        root.orders,
        data,
        root,
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            const first = asRecord(candidate[0]);

            if (Object.keys(first).length > 0) {
                return first;
            }
        }

        const record = asRecord(candidate);

        if (Object.keys(record).length > 0) {
            return record;
        }
    }

    return {};
}

export function extractOrderStatus(orderDetail: unknown): string {
    const order = orderRecord(orderDetail);
    const statuses = Array.isArray(order.statuses)
        ? order.statuses.map(text).filter(Boolean)
        : [];

    return firstText(statuses[0], order.status, "pending");
}

export function extractOrderUpdatedAt(orderDetail: unknown): string | number {
    const order = orderRecord(orderDetail);
    return firstText(
        order.updated_at,
        order.update_time,
        order.created_at,
        order.create_time,
        Date.now()
    );
}

type LazadaPriceDebugEntry = {
    path: string;
    value: string | number | boolean | null;
};

const LAZADA_PRICE_DEBUG_KEY_PATTERN =
    /(?:price|amount|total|subtotal|sub_total|paid|payment|fee|voucher|discount|tax)/i;

export function collectLazadaPriceDebugFields(
    value: unknown,
    path = "$",
    depth = 0,
    output: LazadaPriceDebugEntry[] = []
): LazadaPriceDebugEntry[] {
    if (depth > 8 || output.length >= 200 || value === undefined) {
        return output;
    }

    if (Array.isArray(value)) {
        for (let index = 0; index < Math.min(value.length, 50); index += 1) {
            collectLazadaPriceDebugFields(
                value[index],
                `${path}[${index}]`,
                depth + 1,
                output
            );

            if (output.length >= 200) {
                break;
            }
        }

        return output;
    }

    const record = asRecord(value);

    for (const [key, nested] of Object.entries(record)) {
        const nestedPath = `${path}.${key}`;

        if (
            LAZADA_PRICE_DEBUG_KEY_PATTERN.test(key) &&
            (nested === null ||
                typeof nested === "string" ||
                typeof nested === "number" ||
                typeof nested === "boolean")
        ) {
            output.push({
                path: nestedPath,
                value: nested as string | number | boolean | null,
            });
        }

        if (nested && typeof nested === "object") {
            collectLazadaPriceDebugFields(
                nested,
                nestedPath,
                depth + 1,
                output
            );
        }

        if (output.length >= 200) {
            break;
        }
    }

    return output;
}

export function isDebugRequested(value: unknown): boolean {
    return value === true || text(value).toLowerCase() === "true";
}

function findFirstValueByKeys(
    value: unknown,
    keys: Set<string>,
    depth = 0
): string {
    if (depth > 8 || value === null || value === undefined) {
        return "";
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findFirstValueByKeys(item, keys, depth + 1);

            if (found) {
                return found;
            }
        }

        return "";
    }

    const record = asRecord(value);

    for (const [key, nested] of Object.entries(record)) {
        if (keys.has(key.toLowerCase())) {
            const found = text(nested);

            if (found) {
                return found;
            }
        }
    }

    for (const nested of Object.values(record)) {
        const found = findFirstValueByKeys(nested, keys, depth + 1);

        if (found) {
            return found;
        }
    }

    return "";
}

function mergeLogistics(input: {
    orderDetail: unknown;
    orderItems: unknown;
    orderTrace?: unknown;
}): { orderDetail: unknown; orderItems: unknown } {
    if (!input.orderTrace) {
        return {
            orderDetail: input.orderDetail,
            orderItems: input.orderItems,
        };
    }

    const trackingNumber = findFirstValueByKeys(
        input.orderTrace,
        new Set([
            "tracking_code",
            "tracking_number",
            "tracking_no",
            "package_code",
            "logistics_no",
        ])
    );
    const shippingProvider = findFirstValueByKeys(
        input.orderTrace,
        new Set([
            "shipping_provider",
            "shipment_provider",
            "shipping_provider_type",
            "logistics_provider",
            "provider_name",
        ])
    );

    if (!trackingNumber && !shippingProvider) {
        return {
            orderDetail: input.orderDetail,
            orderItems: input.orderItems,
        };
    }

    const detail = structuredClone(input.orderDetail);
    const items = structuredClone(input.orderItems);
    const detailRoot = asRecord(detail);
    const detailData = asRecord(detailRoot.data);
    const detailOrder = Object.keys(detailData).length
        ? detailData
        : detailRoot;

    if (trackingNumber && !firstText(detailOrder.tracking_code)) {
        detailOrder.tracking_code = trackingNumber;
    }

    if (
        shippingProvider &&
        !firstText(detailOrder.shipping_provider)
    ) {
        detailOrder.shipping_provider = shippingProvider;
    }

    if (Object.keys(detailData).length) {
        detailRoot.data = detailOrder;
    }

    const itemsRoot = asRecord(items);
    const itemsData = Array.isArray(itemsRoot.data)
        ? itemsRoot.data
        : Array.isArray(items)
          ? items
          : [];

    if (itemsData.length > 0) {
        const firstItem = asRecord(itemsData[0]);

        if (trackingNumber && !firstText(firstItem.tracking_code)) {
            firstItem.tracking_code = trackingNumber;
        }

        if (
            shippingProvider &&
            !firstText(firstItem.shipment_provider)
        ) {
            firstItem.shipment_provider = shippingProvider;
        }

        itemsData[0] = firstItem;

        if (Array.isArray(itemsRoot.data)) {
            itemsRoot.data = itemsData;
        }
    }

    return { orderDetail: detail, orderItems: items };
}

export async function fetchLazadaOrderBundle(
    env: Env,
    credential: LazadaSellerCredential,
    orderId: string
): Promise<{
    orderDetail: unknown;
    orderItems: unknown;
    orderTrace?: unknown;
}> {
    const [orderDetail, orderItems] = await Promise.all([
        getLazadaOrderDetail(env, credential, orderId),
        getLazadaOrderItems(env, credential, orderId),
    ]);
    let orderTrace: unknown;

    try {
        orderTrace = await getLazadaOrderTrace(
            env,
            credential,
            orderId
        );
    } catch (error) {
        console.warn("LAZADA_ORDER_TRACE_FAILED", {
            seller_id: credential.seller_id,
            order_id: orderId,
            error:
                error instanceof Error
                    ? error.message
                    : String(error),
        });
    }

    const merged = mergeLogistics({
        orderDetail,
        orderItems,
        orderTrace,
    });

    return {
        orderDetail: merged.orderDetail,
        orderItems: merged.orderItems,
        orderTrace,
    };
}

