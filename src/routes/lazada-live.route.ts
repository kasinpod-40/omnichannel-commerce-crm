import type { Env } from "../config/env";
import { adaptLazadaThailand } from "../modules/marketplace/adapters/lazada.adapter";
import {
    buildLazadaAuthorizationUrl,
    exchangeLazadaAuthorizationCode,
    getLazadaOrderDetail,
    getLazadaOrderItems,
    getLazadaOrderTrace,
    refreshLazadaAccessToken,
} from "../modules/marketplace/lazada/lazada.api";
import { verifyLazadaWebhookSignature } from "../modules/marketplace/lazada/lazada.crypto";
import {
    buildLazadaCredential,
    getLazadaCredentialBySellerId,
    listLazadaCredentials,
    resolveLazadaCredential,
    saveLazadaCredential,
    selectThailandSellerProfiles,
} from "../modules/marketplace/lazada/lazada.token-store";
import type {
    LazadaSellerCredential,
    LazadaWebhookEnvelope,
} from "../modules/marketplace/lazada/lazada.types";
import { upsertMarketplaceOrder } from "../modules/marketplace/marketplace.service";
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

function extractWebhookIdentity(webhook: LazadaWebhookEnvelope): {
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

function extractOrderStatus(orderDetail: unknown): string {
    const order = orderRecord(orderDetail);
    const statuses = Array.isArray(order.statuses)
        ? order.statuses.map(text).filter(Boolean)
        : [];

    return firstText(statuses[0], order.status, "pending");
}

function extractOrderUpdatedAt(orderDetail: unknown): string | number {
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

function collectLazadaPriceDebugFields(
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

function isDebugRequested(value: unknown): boolean {
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

async function fetchLazadaOrderBundle(
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

export async function handleLazadaOAuthCallback(
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
                title: "เชื่อม Lazada ไม่สำเร็จ",
                message: platformError,
            }),
            400
        );
    }

    const code = firstText(url.searchParams.get("code"));

    if (!code) {
        return htmlResponse(
            oauthResultPage({
                ok: false,
                title: "ไม่พบ Authorization Code",
                message: "Lazada ไม่ได้ส่ง code กลับมา",
            }),
            400
        );
    }

    try {
        const token = await exchangeLazadaAuthorizationCode(env, code);
        const profiles = selectThailandSellerProfiles(token);

        if (profiles.length === 0) {
            throw new Error("LAZADA_AUTHORIZED_SELLERS_EMPTY");
        }

        const saved: LazadaSellerCredential[] = [];

        for (const seller of profiles) {
            const previous = await getLazadaCredentialBySellerId(
                env,
                seller.seller_id
            );
            const credential = buildLazadaCredential({
                token,
                seller,
                previous,
            });

            await saveLazadaCredential(env, credential);
            saved.push(credential);
        }

        return htmlResponse(
            oauthResultPage({
                ok: true,
                title: "เชื่อม Lazada สำเร็จ",
                message: `ระบบบันทึกสิทธิ์ร้านจำนวน ${saved.length} ร้านเรียบร้อยแล้ว`,
                sellers: saved,
            })
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error("LAZADA_OAUTH_CALLBACK_FAILED", { error: message });

        return htmlResponse(
            oauthResultPage({
                ok: false,
                title: "เชื่อม Lazada ไม่สำเร็จ",
                message,
            }),
            500
        );
    }
}

type LazadaWebhookContext = Pick<ExecutionContext, "waitUntil">;

function isLazadaVerificationProbe(identity: {
    sellerId: string;
    orderId: string;
    messageType: string;
}): boolean {
    return (
        identity.sellerId === "9999" &&
        identity.orderId === "123456" &&
        identity.messageType === "0"
    );
}

async function processLazadaWebhookEvent(input: {
    env: Env;
    webhook: LazadaWebhookEnvelope;
    identity: ReturnType<typeof extractWebhookIdentity>;
}): Promise<void> {
    try {
        const credential = await resolveLazadaCredential(input.env, {
            sellerId: input.identity.sellerId,
        });

        if (!credential) {
            throw new Error(
                `LAZADA_SELLER_CREDENTIAL_NOT_FOUND:${input.identity.sellerId || "unknown"}`
            );
        }

        const bundle = await fetchLazadaOrderBundle(
            input.env,
            credential,
            input.identity.orderId
        );
        const adapted = adaptLazadaThailand({
            webhook: input.webhook,
            order_detail_response: bundle.orderDetail,
            order_items_response: bundle.orderItems,
            store_name: credential.account || `Lazada ${credential.seller_id}`,
        });
        const result = await upsertMarketplaceOrder(
            input.env,
            adapted.normalized
        );

        console.log("LAZADA_WEBHOOK_PROCESS_COMPLETED", {
            seller_id: input.identity.sellerId,
            order_id: input.identity.orderId,
            message_type: input.identity.messageType,
            order_status: input.identity.orderStatus,
            result,
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error("LAZADA_WEBHOOK_PROCESS_FAILED", {
            seller_id: input.identity.sellerId,
            order_id: input.identity.orderId,
            message_type: input.identity.messageType,
            error: message,
        });
    }
}

export async function handleLazadaWebhook(
    request: Request,
    env: Env,
    context?: LazadaWebhookContext
): Promise<Response> {
    if (request.method === "GET") {
        return jsonResponse({
            ok: true,
            service: "lazada-webhook",
            region: "TH",
        });
    }

    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    const rawBody = await request.text();
    const configuredAppKey = env.LAZADA_APP_KEY?.trim() ?? "";
    const configuredAppSecret = env.LAZADA_APP_SECRET?.trim() ?? "";

    if (!configuredAppKey || !configuredAppSecret) {
        return jsonResponse(
            {
                ok: false,
                code: !configuredAppKey
                    ? "LAZADA_APP_KEY_NOT_CONFIGURED"
                    : "LAZADA_APP_SECRET_NOT_CONFIGURED",
            },
            503
        );
    }

    const signatureHeader = firstText(
        request.headers.get("Authorization"),
        request.headers.get("X-Lazada-Signature"),
        request.headers.get("X-Lazop-Signature")
    );
    const signatureValid = await verifyLazadaWebhookSignature({
        appKey: configuredAppKey,
        appSecret: configuredAppSecret,
        rawBody,
        authorizationHeader: signatureHeader,
    });

    if (!signatureValid) {
        return jsonResponse(
            { ok: false, code: "LAZADA_WEBHOOK_SIGNATURE_INVALID" },
            401
        );
    }

    let webhook: LazadaWebhookEnvelope;

    try {
        webhook = JSON.parse(rawBody) as LazadaWebhookEnvelope;
    } catch {
        return jsonResponse({ ok: false, code: "INVALID_JSON" }, 400);
    }

    const identity = extractWebhookIdentity(webhook);

    // Lazada sends a signed synthetic order during Push Mechanism verification.
    // It must be acknowledged without trying to load a real seller credential.
    if (isLazadaVerificationProbe(identity)) {
        console.log("LAZADA_WEBHOOK_VERIFICATION_ACCEPTED", {
            seller_id: identity.sellerId,
            order_id: identity.orderId,
            message_type: identity.messageType,
        });

        return jsonResponse({
            ok: true,
            verified: true,
            service: "lazada-webhook",
        });
    }

    if (!identity.orderId) {
        return jsonResponse({
            ok: true,
            ignored: true,
            reason: "EVENT_HAS_NO_TRADE_ORDER_ID",
            message_type: identity.messageType,
        });
    }

    const processing = processLazadaWebhookEvent({
        env,
        webhook,
        identity,
    });

    if (context) {
        context.waitUntil(processing);

        return jsonResponse({
            ok: true,
            accepted: true,
            message_type: identity.messageType,
            order_id: identity.orderId,
            order_status: identity.orderStatus,
        });
    }

    await processing;

    return jsonResponse({
        ok: true,
        accepted: true,
        processed: true,
        message_type: identity.messageType,
        order_id: identity.orderId,
        order_status: identity.orderStatus,
    });
}

export async function handleLazadaAdminStatus(
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
        const credentials = await listLazadaCredentials(env);
        let authorizationUrl: string | undefined;

        try {
            authorizationUrl = buildLazadaAuthorizationUrl(env);
        } catch {
            authorizationUrl = undefined;
        }

        return jsonResponse({
            ok: true,
            region: "TH",
            authorization_url: authorizationUrl,
            connected_sellers: credentials.map((credential) => ({
                seller_id: credential.seller_id,
                user_id: credential.user_id,
                short_code: credential.short_code,
                account: credential.account,
                country: credential.country,
                region: credential.region,
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
                code: "LAZADA_STATUS_FAILED",
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            500
        );
    }
}

export async function handleLazadaAdminSyncOrder(
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

    const sellerId = firstText(body.seller_id);
    const shortCode = firstText(body.short_code);
    const orderId = firstText(body.order_id, body.trade_order_id);

    if (!orderId) {
        return jsonResponse(
            { ok: false, code: "LAZADA_ORDER_ID_REQUIRED" },
            400
        );
    }

    try {
        const credential = await resolveLazadaCredential(env, {
            sellerId,
            shortCode,
        });

        if (!credential) {
            throw new Error(
                `LAZADA_SELLER_CREDENTIAL_NOT_FOUND:${sellerId || shortCode || "unknown"}`
            );
        }

        const bundle = await fetchLazadaOrderBundle(
            env,
            credential,
            orderId
        );
        const status = extractOrderStatus(bundle.orderDetail);
        const webhook: LazadaWebhookEnvelope = {
            seller_id: credential.seller_id,
            message_type: 0,
            timestamp: Date.now(),
            site: "lazada_th",
            data: {
                trade_order_id: orderId,
                order_status: status,
                status_update_time: extractOrderUpdatedAt(
                    bundle.orderDetail
                ),
            },
        };
        const adapted = adaptLazadaThailand({
            webhook,
            order_detail_response: bundle.orderDetail,
            order_items_response: bundle.orderItems,
            store_name: credential.account || `Lazada ${credential.seller_id}`,
        });
        const forceSync = isDebugRequested(body.force);

        if (forceSync) {
            adapted.normalized.event_id = `${adapted.normalized.event_id}:manual-force:${Date.now()}`;
        }

        if (isDebugRequested(body.debug)) {
            return jsonResponse({
                ok: true,
                dry_run: true,
                seller_id: credential.seller_id,
                order_id: orderId,
                normalized: adapted.normalized,
                debug: {
                    purpose: "price-mapping-only",
                    normalized_total_amount:
                        adapted.normalized.total_amount,
                    order_detail_pricing_fields:
                        collectLazadaPriceDebugFields(bundle.orderDetail),
                    order_items_pricing_fields:
                        collectLazadaPriceDebugFields(bundle.orderItems),
                },
            });
        }

        const result = await upsertMarketplaceOrder(
            env,
            adapted.normalized
        );

        return jsonResponse({
            ok: true,
            seller_id: credential.seller_id,
            order_id: orderId,
            normalized: adapted.normalized,
            forced: forceSync,
            result,
        });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                code: "LAZADA_MANUAL_SYNC_FAILED",
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            500
        );
    }
}

export async function handleLazadaAdminRefreshToken(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    if (!isAdminAuthorized(request, env)) {
        return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
    }

    let body: Record<string, unknown> = {};

    try {
        const raw = await request.text();
        body = raw.trim() ? asRecord(JSON.parse(raw)) : {};
    } catch {
        return jsonResponse({ ok: false, code: "INVALID_JSON" }, 400);
    }

    const sellerId = firstText(body.seller_id);
    const shortCode = firstText(body.short_code);

    try {
        const credential = await resolveLazadaCredential(env, {
            sellerId,
            shortCode,
        });

        if (!credential) {
            throw new Error(
                `LAZADA_SELLER_CREDENTIAL_NOT_FOUND:${sellerId || shortCode || "unknown"}`
            );
        }

        const refreshed = await refreshLazadaAccessToken(
            env,
            credential
        );

        return jsonResponse({
            ok: true,
            seller_id: refreshed.seller_id,
            account: refreshed.account,
            country: refreshed.country,
            access_token_expires_at:
                refreshed.access_token_expires_at,
            refresh_token_expires_at:
                refreshed.refresh_token_expires_at,
            updated_at: refreshed.updated_at,
        });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                code: "LAZADA_TOKEN_REFRESH_FAILED",
                message:
                    error instanceof Error
                        ? error.message
                        : String(error),
            },
            500
        );
    }
}
