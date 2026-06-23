import type { Env } from "../../../config/env";
import { adaptLazadaThailand } from "../../../modules/marketplace/adapters/lazada.adapter";
import {
    buildLazadaAuthorizationUrl,
    refreshLazadaAccessToken,
} from "../../../modules/marketplace/lazada/lazada.api";
import {
    listLazadaCredentials,
    resolveLazadaCredential,
} from "../../../modules/marketplace/lazada/lazada.token-store";
import type { LazadaWebhookEnvelope } from "../../../modules/marketplace/lazada/lazada.types";
import { upsertMarketplaceOrder } from "../../../modules/marketplace/marketplace.service";
import { jsonResponse } from "../../../utils/response";
import { isAdminAuthorized } from "../../shared/admin-auth";
import { asRecord, firstText } from "../../shared/value";
import {
    collectLazadaPriceDebugFields,
    extractOrderStatus,
    extractOrderUpdatedAt,
    fetchLazadaOrderBundle,
    isDebugRequested,
} from "./live.shared";

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
