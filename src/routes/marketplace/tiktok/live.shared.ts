import type { Env } from "../../../config/env";
import {
    getTikTokOrderDetail,
    getTikTokPackageDetail,
} from "../../../modules/marketplace/tiktok/tiktok.api";
import type {
    TikTokShopCredential,
    TikTokWebhookEnvelope,
} from "../../../modules/marketplace/tiktok/tiktok.types";
import { escapeHtml } from "../../shared/http";
import { asRecord, firstText } from "../../shared/value";

export function oauthResultPage(input: {
    ok: boolean;
    title: string;
    message: string;
    shops?: TikTokShopCredential[];
}): string {
    const color = input.ok ? "#0f9d68" : "#d93025";
    const rows = (input.shops ?? [])
        .map(
            (shop) => `
                <li>
                    <strong>${escapeHtml(shop.shop_name || shop.shop_id)}</strong><br />
                    Shop ID: ${escapeHtml(shop.shop_id)}<br />
                    Region: ${escapeHtml(shop.region)}
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
        <p class="note">สามารถปิดหน้านี้และกลับไปที่ TikTok Shop Partner Center ได้</p>
    </main>
</body>
</html>`;
}

export function extractWebhookIdentity(webhook: TikTokWebhookEnvelope): {
    orderId: string;
    shopId: string;
    shopCipher: string;
    eventName: string;
} {
    const data = asRecord(webhook.data);
    const order = asRecord(data.order);
    const packageRecord = asRecord(data.package);
    const returnRecord = asRecord(
        data.return ?? data.refund ?? data.reverse_order
    );

    return {
        orderId: firstText(
            data.order_id,
            data.orderId,
            order.id,
            order.order_id,
            packageRecord.order_id,
            returnRecord.order_id,
            webhook.order_id
        ),
        shopId: firstText(
            webhook.shop_id,
            data.shop_id,
            data.shopId
        ),
        shopCipher: firstText(
            webhook.shop_cipher,
            data.shop_cipher,
            data.shopCipher
        ),
        eventName: firstText(
            webhook.event,
            webhook.type,
            data.event,
            data.type,
            "unknown"
        ),
    };
}

export function firstOrderRecord(orderDetail: unknown): Record<string, unknown> {
    const root = asRecord(orderDetail);
    const data = asRecord(root.data);
    const candidates = [
        root.orders,
        data.orders,
        root.order,
        data.order,
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

    return root;
}

function extractPackageId(orderDetail: unknown): string {
    const order = firstOrderRecord(orderDetail);
    const packageValue = order.packages ?? order.package_list;

    if (Array.isArray(packageValue)) {
        const first = asRecord(packageValue[0]);
        return firstText(first.id, first.package_id);
    }

    const packageRecord = asRecord(packageValue);
    return firstText(
        packageRecord.id,
        packageRecord.package_id,
        order.package_id
    );
}

function mergePackageDetail(
    orderDetail: unknown,
    packageDetail: unknown
): unknown {
    const root = structuredClone(asRecord(orderDetail));
    const data = asRecord(root.data);
    const packageRoot = asRecord(packageDetail);
    const packageData = asRecord(packageRoot.data);
    const packageRecord = Object.keys(packageData).length
        ? packageData
        : packageRoot;
    const arrays: unknown[] = [root.orders, data.orders];

    for (const candidate of arrays) {
        if (Array.isArray(candidate) && candidate.length > 0) {
            const order = asRecord(candidate[0]);
            order.packages = [packageRecord];
            candidate[0] = order;
            return root;
        }
    }

    const order = asRecord(root.order ?? data.order);

    if (Object.keys(order).length > 0) {
        order.packages = [packageRecord];

        if (root.order) {
            root.order = order;
        } else {
            data.order = order;
            root.data = data;
        }
    }

    return root;
}

export async function fetchTikTokOrderWithPackage(
    env: Env,
    credential: TikTokShopCredential,
    orderId: string
): Promise<unknown> {
    const detail = await getTikTokOrderDetail(env, credential, orderId);
    const packageId = extractPackageId(detail);

    if (!packageId) {
        return detail;
    }

    try {
        const packageDetail = await getTikTokPackageDetail(
            env,
            credential,
            packageId
        );
        return mergePackageDetail(detail, packageDetail);
    } catch (error) {
        console.warn("TIKTOK_PACKAGE_DETAIL_FAILED", {
            order_id: orderId,
            package_id: packageId,
            error:
                error instanceof Error
                    ? error.message
                    : String(error),
        });
        return detail;
    }
}

