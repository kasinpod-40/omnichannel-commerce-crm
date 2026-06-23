import type { Env } from "../../../config/env";
import {
    generateTikTokApiSignature,
} from "./tiktok.crypto";
import {
    buildTikTokCredential,
    getTikTokCredentialByCipher,
    saveTikTokCredential,
} from "./tiktok.token-store";
import type {
    TikTokApiResponse,
    TikTokAuthorizedShop,
    TikTokShopCredential,
    TikTokTokenPayload,
} from "./tiktok.types";

const DEFAULT_AUTH_BASE = "https://auth.tiktok-shops.com";
const DEFAULT_API_BASE = "https://open-api.tiktokglobalshop.com";
const REFRESH_EARLY_MS = 5 * 60 * 1000;

function appKey(env: Env): string {
    const value = env.TIKTOK_APP_KEY?.trim();

    if (!value) {
        throw new Error("TIKTOK_APP_KEY_NOT_CONFIGURED");
    }

    return value;
}

function appSecret(env: Env): string {
    const value = env.TIKTOK_APP_SECRET?.trim();

    if (!value) {
        throw new Error("TIKTOK_APP_SECRET_NOT_CONFIGURED");
    }

    return value;
}

function authBase(env: Env): string {
    return (env.TIKTOK_AUTH_BASE?.trim() || DEFAULT_AUTH_BASE).replace(
        /\/$/,
        ""
    );
}

function apiBase(env: Env): string {
    return (env.TIKTOK_API_BASE?.trim() || DEFAULT_API_BASE).replace(
        /\/$/,
        ""
    );
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function text(value: unknown): string {
    return typeof value === "string"
        ? value.trim()
        : typeof value === "number"
          ? String(value)
          : "";
}

function numberValue(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}

function stringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(text).filter(Boolean);
    }

    const normalized = text(value);
    return normalized
        ? normalized
              .split(/[\s,]+/)
              .map((entry) => entry.trim())
              .filter(Boolean)
        : [];
}

function assertTikTokSuccess<T>(
    response: Response,
    payload: TikTokApiResponse<T>,
    operation: string
): T {
    const code = Number(payload.code ?? 0);

    if (!response.ok || code !== 0) {
        throw new Error(
            `${operation}_FAILED:${response.status}:${code}:${payload.message ?? "Unknown TikTok error"}`
        );
    }

    return payload.data as T;
}

function normalizeTokenPayload(value: unknown): TikTokTokenPayload {
    const data = asRecord(value);
    const accessToken = text(data.access_token);
    const refreshToken = text(data.refresh_token);

    if (!accessToken || !refreshToken) {
        throw new Error("TIKTOK_TOKEN_RESPONSE_INVALID");
    }

    return {
        access_token: accessToken,
        refresh_token: refreshToken,
        access_token_expire_in: numberValue(
            data.access_token_expire_in ?? data.expires_in
        ),
        refresh_token_expire_in: numberValue(
            data.refresh_token_expire_in
        ),
        open_id: text(data.open_id) || undefined,
        seller_name: text(data.seller_name) || undefined,
        seller_base_region:
            text(data.seller_base_region ?? data.region) || undefined,
        granted_scopes: stringArray(
            data.granted_scopes ?? data.scope
        ),
    };
}

async function requestAuthToken(
    env: Env,
    path: string,
    query: Record<string, string>
): Promise<TikTokTokenPayload> {
    const url = new URL(`${authBase(env)}${path}`);

    for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
    });
    const payload = (await response.json()) as TikTokApiResponse;
    const data = assertTikTokSuccess(
        response,
        payload,
        "TIKTOK_AUTH_TOKEN"
    );

    return normalizeTokenPayload(data);
}

export async function exchangeTikTokAuthorizationCode(
    env: Env,
    authCode: string
): Promise<TikTokTokenPayload> {
    return requestAuthToken(env, "/api/v2/token/get", {
        app_key: appKey(env),
        app_secret: appSecret(env),
        auth_code: authCode,
        grant_type: "authorized_code",
    });
}

export async function refreshTikTokAccessToken(
    env: Env,
    credential: TikTokShopCredential
): Promise<TikTokShopCredential> {
    const token = await requestAuthToken(
        env,
        "/api/v2/token/refresh",
        {
            app_key: appKey(env),
            app_secret: appSecret(env),
            refresh_token: credential.refresh_token,
            grant_type: "refresh_token",
        }
    );
    const updated = buildTikTokCredential({
        token,
        shop: {
            shop_cipher: credential.shop_cipher,
            shop_id: credential.shop_id,
            shop_name: credential.shop_name,
            region: credential.region,
            seller_type: credential.seller_type,
        },
        previous: credential,
    });

    await saveTikTokCredential(env, updated);
    return updated;
}

export async function ensureFreshTikTokCredential(
    env: Env,
    credential: TikTokShopCredential
): Promise<TikTokShopCredential> {
    if (credential.access_token_expires_at > Date.now() + REFRESH_EARLY_MS) {
        return credential;
    }

    return refreshTikTokAccessToken(env, credential);
}

type TikTokRequestOptions = {
    method?: "GET" | "POST";
    shopCipher?: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
};

async function signedTikTokRequest<T>(
    env: Env,
    credential: TikTokShopCredential,
    path: string,
    options: TikTokRequestOptions = {},
    allowTokenRetry = true
): Promise<T> {
    const fresh = await ensureFreshTikTokCredential(env, credential);
    const method = options.method ?? "GET";
    const bodyText =
        options.body === undefined ? "" : JSON.stringify(options.body);
    const query: Record<
        string,
        string | number | boolean | undefined
    > = {
        app_key: appKey(env),
        timestamp: Math.floor(Date.now() / 1000),
        ...(options.shopCipher
            ? { shop_cipher: options.shopCipher }
            : {}),
        ...options.query,
    };
    const sign = await generateTikTokApiSignature({
        appSecret: appSecret(env),
        path,
        query,
        body: method === "POST" ? bodyText : "",
    });
    const url = new URL(`${apiBase(env)}${path}`);

    for (const [key, value] of Object.entries({ ...query, sign })) {
        if (value !== undefined) {
            url.searchParams.set(key, String(value));
        }
    }

    const response = await fetch(url.toString(), {
        method,
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "x-tts-access-token": fresh.access_token,
        },
        body: method === "POST" ? bodyText : undefined,
    });
    const payload = (await response.json()) as TikTokApiResponse<T>;

    try {
        return assertTikTokSuccess(
            response,
            payload,
            `TIKTOK_API_${path}`
        );
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        const tokenInvalid =
            message.includes("105001") ||
            message.toLowerCase().includes("access token is invalid") ||
            message.toLowerCase().includes("access token expired");

        if (!tokenInvalid || !allowTokenRetry) {
            throw error;
        }

        const reloaded =
            (await getTikTokCredentialByCipher(
                env,
                credential.shop_cipher
            )) ?? credential;
        const refreshed = await refreshTikTokAccessToken(env, reloaded);

        return signedTikTokRequest<T>(
            env,
            refreshed,
            path,
            options,
            false
        );
    }
}

function normalizeAuthorizedShops(data: unknown): TikTokAuthorizedShop[] {
    const root = asRecord(data);
    const candidates = [
        root.shops,
        root.shop_list,
        root.authorized_shops,
        data,
    ];

    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) {
            continue;
        }

        const shops = candidate
            .map(asRecord)
            .map((shop) => ({
                shop_cipher: text(
                    shop.shop_cipher ?? shop.cipher ?? shop.shop_code
                ),
                shop_id: text(shop.shop_id ?? shop.id),
                shop_name: text(shop.shop_name ?? shop.name),
                region: text(
                    shop.region ?? shop.shop_region ?? shop.country
                ),
                seller_type:
                    text(shop.seller_type ?? shop.type) || undefined,
            }))
            .filter(
                (shop) => shop.shop_cipher && shop.shop_id
            );

        if (shops.length > 0) {
            return shops;
        }
    }

    return [];
}

export async function getTikTokAuthorizedShops(
    env: Env,
    token: TikTokTokenPayload
): Promise<TikTokAuthorizedShop[]> {
    const temporary: TikTokShopCredential = {
        platform: "TikTok",
        shop_cipher: "authorization-bootstrap",
        shop_id: "authorization-bootstrap",
        shop_name: token.seller_name ?? "TikTok Shop",
        region: token.seller_base_region ?? "TH",
        open_id: token.open_id,
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        access_token_expires_at: Number.MAX_SAFE_INTEGER,
        refresh_token_expires_at: Number.MAX_SAFE_INTEGER,
        granted_scopes: token.granted_scopes ?? [],
        connected_at: Date.now(),
        updated_at: Date.now(),
    };
    const data = await signedTikTokRequest<unknown>(
        env,
        temporary,
        "/authorization/202309/shops"
    );

    return normalizeAuthorizedShops(data);
}

export async function getTikTokOrderDetail(
    env: Env,
    credential: TikTokShopCredential,
    orderId: string
): Promise<unknown> {
    return signedTikTokRequest(
        env,
        credential,
        "/order/202309/orders",
        {
            method: "POST",
            shopCipher: credential.shop_cipher,
            body: { order_ids: [orderId] },
        }
    );
}

export async function getTikTokPackageDetail(
    env: Env,
    credential: TikTokShopCredential,
    packageId: string
): Promise<unknown> {
    return signedTikTokRequest(
        env,
        credential,
        `/fulfillment/202309/packages/${encodeURIComponent(packageId)}`,
        {
            shopCipher: credential.shop_cipher,
        }
    );
}
