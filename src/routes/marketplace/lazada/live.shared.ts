import type {
    LazadaSellerCredential,
    LazadaWebhookEnvelope,
} from "../../../modules/marketplace/lazada/lazada.types";
import { escapeHtml } from "../../shared/http";
import { asRecord, firstText, text } from "../../shared/value";

export { fetchLazadaOrderBundle } from "../../../modules/marketplace/lazada/lazada.order-bundle";

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


