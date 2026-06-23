import type { Env } from "../config/env";
import { adaptTikTokThailand } from "../modules/marketplace/adapters/tiktok.adapter";
import { upsertMarketplaceOrder } from "../modules/marketplace/marketplace.service";
import {
    exchangeTikTokAuthorizationCode,
    getTikTokAuthorizedShops,
    getTikTokOrderDetail,
    getTikTokPackageDetail,
    refreshTikTokAccessToken,
} from "../modules/marketplace/tiktok/tiktok.api";
import {
    verifyTikTokWebhookSignature,
} from "../modules/marketplace/tiktok/tiktok.crypto";
import {
    buildTikTokCredential,
    getTikTokCredentialByCipher,
    listTikTokCredentials,
    resolveTikTokCredential,
    saveTikTokCredential,
} from "../modules/marketplace/tiktok/tiktok.token-store";
import type {
    TikTokShopCredential,
    TikTokWebhookEnvelope,
} from "../modules/marketplace/tiktok/tiktok.types";
import { jsonResponse } from "../utils/response";

function text(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }

    if (typeof value === "number" || typeof value === "bigint") {
        return String(value);
    }

    return "";
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function firstText(...values: unknown[]): string {
    for (const value of values) {
        const normalized = text(value);

        if (normalized) {
            return normalized;
        }
    }

    return "";
}

function getAdminToken(request: Request): string {
    const authorization = request.headers.get("Authorization") ?? "";

    return /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : request.headers.get("X-Admin-Token")?.trim() ?? "";
}

function isAdminAuthorized(request: Request, env: Env): boolean {
    const configured = env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "";
    return Boolean(configured && getAdminToken(request) === configured);
}

function htmlResponse(html: string, status = 200): Response {
    return new Response(html, {
        status,
        headers: {
            "Content-Type": "text/html; charset=UTF-8",
            "Cache-Control": "no-store",
        },
    });
}

function escapeHtml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function oauthResultPage(input: {
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

function extractWebhookIdentity(webhook: TikTokWebhookEnvelope): {
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

function firstOrderRecord(orderDetail: unknown): Record<string, unknown> {
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

async function fetchTikTokOrderWithPackage(
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

export async function handleTikTokOAuthCallback(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);
    const platformError = firstText(
        url.searchParams.get("error"),
        url.searchParams.get("error_description")
    );

    if (platformError) {
        return htmlResponse(
            oauthResultPage({
                ok: false,
                title: "เชื่อม TikTok Shop ไม่สำเร็จ",
                message: platformError,
            }),
            400
        );
    }

    const authCode = firstText(
        url.searchParams.get("auth_code"),
        url.searchParams.get("code")
    );

    if (!authCode) {
        return htmlResponse(
            oauthResultPage({
                ok: false,
                title: "ไม่พบ Authorization Code",
                message: "TikTok Shop ไม่ได้ส่ง auth_code กลับมา",
            }),
            400
        );
    }

    try {
        const token = await exchangeTikTokAuthorizationCode(env, authCode);
        const shops = await getTikTokAuthorizedShops(env, token);

        if (shops.length === 0) {
            throw new Error("TIKTOK_AUTHORIZED_SHOPS_EMPTY");
        }

        const saved: TikTokShopCredential[] = [];

        for (const shop of shops) {
            const previous = await getTikTokCredentialByCipher(
                env,
                shop.shop_cipher
            );
            const credential = buildTikTokCredential({
                token,
                shop,
                previous,
            });

            await saveTikTokCredential(env, credential);
            saved.push(credential);
        }

        return htmlResponse(
            oauthResultPage({
                ok: true,
                title: "เชื่อม TikTok Shop สำเร็จ",
                message: `ระบบบันทึกสิทธิ์ร้านจำนวน ${saved.length} ร้านเรียบร้อยแล้ว`,
                shops: saved,
            })
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error("TIKTOK_OAUTH_CALLBACK_FAILED", { error: message });

        return htmlResponse(
            oauthResultPage({
                ok: false,
                title: "เชื่อม TikTok Shop ไม่สำเร็จ",
                message,
            }),
            500
        );
    }
}

export async function handleTikTokWebhook(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method === "GET") {
        return jsonResponse({
            ok: true,
            service: "tiktok-shop-webhook",
            region: "TH",
        });
    }

    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    const rawBody = await request.text();
    const authorization = request.headers.get("Authorization") ?? "";
    const appSecret = env.TIKTOK_APP_SECRET?.trim() ?? "";

    if (!appSecret) {
        return jsonResponse(
            { ok: false, code: "TIKTOK_APP_SECRET_NOT_CONFIGURED" },
            503
        );
    }

    const signatureValid = await verifyTikTokWebhookSignature({
        appSecret,
        rawBody,
        authorizationHeader: authorization,
    });

    if (!signatureValid) {
        return jsonResponse(
            { ok: false, code: "TIKTOK_WEBHOOK_SIGNATURE_INVALID" },
            401
        );
    }

    let webhook: TikTokWebhookEnvelope;

    try {
        webhook = JSON.parse(rawBody) as TikTokWebhookEnvelope;
    } catch {
        return jsonResponse({ ok: false, code: "INVALID_JSON" }, 400);
    }

    if (webhook.challenge) {
        return jsonResponse({ challenge: webhook.challenge });
    }

    const identity = extractWebhookIdentity(webhook);

    if (!identity.orderId) {
        return jsonResponse({
            ok: true,
            ignored: true,
            reason: "EVENT_HAS_NO_ORDER_ID",
            event: identity.eventName,
        });
    }

    try {
        const credential = await resolveTikTokCredential(env, {
            shopCipher: identity.shopCipher,
            shopId: identity.shopId,
        });

        if (!credential) {
            throw new Error(
                `TIKTOK_SHOP_CREDENTIAL_NOT_FOUND:${identity.shopId || identity.shopCipher || "unknown"}`
            );
        }

        const orderDetail = await fetchTikTokOrderWithPackage(
            env,
            credential,
            identity.orderId
        );
        const adapted = adaptTikTokThailand({
            webhook,
            order_detail_response: orderDetail,
            store_name: credential.shop_name,
        });
        const result = await upsertMarketplaceOrder(
            env,
            adapted.normalized
        );

        return jsonResponse({
            ok: true,
            event: identity.eventName,
            order_id: identity.orderId,
            result,
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error("TIKTOK_WEBHOOK_PROCESS_FAILED", {
            event: identity.eventName,
            order_id: identity.orderId,
            error: message,
        });

        return jsonResponse(
            {
                ok: false,
                code: "TIKTOK_WEBHOOK_PROCESS_FAILED",
                message,
            },
            503
        );
    }
}

export async function handleTikTokAdminStatus(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    if (!isAdminAuthorized(request, env)) {
        return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
    }

    try {
        const credentials = await listTikTokCredentials(env);

        return jsonResponse({
            ok: true,
            connected_shops: credentials.map((credential) => ({
                shop_cipher: credential.shop_cipher,
                shop_id: credential.shop_id,
                shop_name: credential.shop_name,
                region: credential.region,
                seller_type: credential.seller_type,
                granted_scopes: credential.granted_scopes,
                access_token_expires_at:
                    credential.access_token_expires_at,
                refresh_token_expires_at:
                    credential.refresh_token_expires_at,
                connected_at: credential.connected_at,
                updated_at: credential.updated_at,
            })),
        });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                code: "TIKTOK_STATUS_FAILED",
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            500
        );
    }
}

export async function handleTikTokAdminSyncOrder(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    if (!isAdminAuthorized(request, env)) {
        return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
    }

    let body: Record<string, unknown>;

    try {
        body = asRecord(await request.json());
    } catch {
        return jsonResponse({ ok: false, code: "INVALID_JSON" }, 400);
    }

    const shopCipher = text(body.shop_cipher);
    const orderId = text(body.order_id);

    if (!shopCipher || !orderId) {
        return jsonResponse(
            {
                ok: false,
                code: "SHOP_CIPHER_AND_ORDER_ID_REQUIRED",
            },
            400
        );
    }

    try {
        const credential = await getTikTokCredentialByCipher(
            env,
            shopCipher
        );

        if (!credential) {
            return jsonResponse(
                { ok: false, code: "TIKTOK_SHOP_NOT_CONNECTED" },
                404
            );
        }

        const orderDetail = await fetchTikTokOrderWithPackage(
            env,
            credential,
            orderId
        );
        const order = firstOrderRecord(orderDetail);
        const status = firstText(order.status, order.order_status, "UNKNOWN");
        const updateTime = firstText(
            order.update_time,
            order.updated_at,
            Date.now()
        );
        const webhook: TikTokWebhookEnvelope = {
            type: "MANUAL_ORDER_SYNC",
            event_id: `tiktok-manual:${credential.shop_id}:${orderId}:${status}:${updateTime}`,
            shop_id: credential.shop_id,
            shop_cipher: credential.shop_cipher,
            timestamp: Date.now(),
            data: {
                order_id: orderId,
                order_status: status,
                update_time: updateTime,
            },
        };
        const adapted = adaptTikTokThailand({
            webhook,
            order_detail_response: orderDetail,
            store_name: credential.shop_name,
        });
        const result = await upsertMarketplaceOrder(
            env,
            adapted.normalized
        );

        return jsonResponse({
            ok: true,
            normalized: adapted.normalized,
            result,
        });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                code: "TIKTOK_ORDER_SYNC_FAILED",
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            500
        );
    }
}

export async function handleTikTokAdminRefreshToken(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    if (!isAdminAuthorized(request, env)) {
        return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
    }

    let body: Record<string, unknown>;

    try {
        body = asRecord(await request.json());
    } catch {
        body = {};
    }

    const shopCipher = text(body.shop_cipher);

    try {
        const credentials = shopCipher
            ? [
                  await getTikTokCredentialByCipher(
                      env,
                      shopCipher
                  ),
              ].filter(
                  (credential): credential is TikTokShopCredential =>
                      Boolean(credential)
              )
            : await listTikTokCredentials(env);

        if (credentials.length === 0) {
            return jsonResponse(
                { ok: false, code: "TIKTOK_SHOP_NOT_CONNECTED" },
                404
            );
        }

        const refreshed = [];

        for (const credential of credentials) {
            const updated = await refreshTikTokAccessToken(
                env,
                credential
            );
            refreshed.push({
                shop_cipher: updated.shop_cipher,
                shop_id: updated.shop_id,
                shop_name: updated.shop_name,
                access_token_expires_at:
                    updated.access_token_expires_at,
                refresh_token_expires_at:
                    updated.refresh_token_expires_at,
            });
        }

        return jsonResponse({ ok: true, refreshed });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                code: "TIKTOK_TOKEN_REFRESH_FAILED",
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            500
        );
    }
}
