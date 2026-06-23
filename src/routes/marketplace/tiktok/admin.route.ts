import type { Env } from "../../../config/env";
import { adaptTikTokThailand } from "../../../modules/marketplace/adapters/tiktok.adapter";
import { upsertMarketplaceOrder } from "../../../modules/marketplace/marketplace.service";
import { refreshTikTokAccessToken } from "../../../modules/marketplace/tiktok/tiktok.api";
import {
    getTikTokCredentialByCipher,
    listTikTokCredentials,
} from "../../../modules/marketplace/tiktok/tiktok.token-store";
import type {
    TikTokShopCredential,
    TikTokWebhookEnvelope,
} from "../../../modules/marketplace/tiktok/tiktok.types";
import { jsonResponse } from "../../../utils/response";
import { isAdminAuthorized } from "../../shared/admin-auth";
import { asRecord, firstText, text } from "../../shared/value";
import {
    fetchTikTokOrderWithPackage,
    firstOrderRecord,
} from "./live.shared";

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
