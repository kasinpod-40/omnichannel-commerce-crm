import type { Env } from "../../../config/env";
import { generateLazadaApiSignature } from "./lazada.crypto";
import {
    buildLazadaCredential,
    getLazadaCredentialBySellerId,
    saveLazadaCredential,
    selectThailandSellerProfiles,
} from "./lazada.token-store";
import type {
    LazadaApiResponse,
    LazadaCountryUserInfo,
    LazadaOrderListPage,
    LazadaSellerCredential,
    LazadaTokenPayload,
} from "./lazada.types";

const DEFAULT_AUTH_BASE = "https://auth.lazada.com";
const DEFAULT_API_BASE = "https://api.lazada.co.th/rest";
const REFRESH_EARLY_MS = 5 * 60 * 1000;

function appKey(env: Env): string {
    const value = env.LAZADA_APP_KEY?.trim();

    if (!value) {
        throw new Error("LAZADA_APP_KEY_NOT_CONFIGURED");
    }

    return value;
}

function appSecret(env: Env): string {
    const value = env.LAZADA_APP_SECRET?.trim();

    if (!value) {
        throw new Error("LAZADA_APP_SECRET_NOT_CONFIGURED");
    }

    return value;
}

function authBase(env: Env): string {
    return (env.LAZADA_AUTH_BASE?.trim() || DEFAULT_AUTH_BASE).replace(
        /\/$/,
        ""
    );
}

function apiBase(env: Env): string {
    return (env.LAZADA_API_BASE?.trim() || DEFAULT_API_BASE).replace(
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
    if (typeof value === "string") {
        return value.trim();
    }

    if (typeof value === "number" || typeof value === "bigint") {
        return String(value);
    }

    return "";
}

function numberValue(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}


function arrayRecords(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value)
        ? value
              .map(asRecord)
              .filter((record) => Object.keys(record).length > 0)
        : [];
}

function normalizeOrderListPage(
    value: unknown,
    offset: number,
    limit: number
): LazadaOrderListPage {
    const root = asRecord(value);
    const orders = [
        value,
        root.orders,
        root.order,
        root.items,
    ]
        .map(arrayRecords)
        .find((items) => items.length > 0) ?? [];
    const count =
        numberValue(root.count) ??
        numberValue(root.count_total) ??
        numberValue(root.countTotal) ??
        orders.length;
    const total =
        numberValue(root.count_total) ??
        numberValue(root.countTotal) ??
        numberValue(root.total) ??
        count;

    return {
        orders,
        count,
        total,
        offset,
        limit,
    };
}

function normalizeCountryUserInfo(
    value: unknown,
    fallbackCountry: string,
    fallbackSellerId: string
): LazadaCountryUserInfo[] {
    const candidates = Array.isArray(value) ? value : [];
    const profiles = candidates
        .map(asRecord)
        .map((profile) => ({
            country: text(profile.country) || fallbackCountry || "th",
            user_id:
                text(profile.user_id ?? profile.country_user_id) ||
                undefined,
            seller_id: text(
                profile.seller_id ?? profile.user_id ?? profile.country_user_id
            ),
            short_code:
                text(profile.short_code ?? profile.seller_short_code) ||
                undefined,
        }))
        .filter((profile) => profile.seller_id);

    if (profiles.length > 0) {
        return profiles;
    }

    return fallbackSellerId
        ? [
              {
                  country: fallbackCountry || "th",
                  seller_id: fallbackSellerId,
              },
          ]
        : [];
}

function normalizeTokenPayload(value: unknown): LazadaTokenPayload {
    const root = asRecord(value);
    const data = Object.keys(asRecord(root.data)).length
        ? asRecord(root.data)
        : root;
    const accessToken = text(data.access_token);
    const refreshToken = text(data.refresh_token);

    if (!accessToken || !refreshToken) {
        throw new Error("LAZADA_TOKEN_RESPONSE_INVALID");
    }

    const country = text(data.country) || "th";
    const fallbackSellerId = text(
        data.seller_id ?? data.user_id ?? data.country_user_id
    );

    return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: numberValue(data.expires_in),
        refresh_expires_in: numberValue(data.refresh_expires_in),
        account: text(data.account) || undefined,
        country,
        account_platform:
            text(data.account_platform) || undefined,
        country_user_info: normalizeCountryUserInfo(
            data.country_user_info,
            country,
            fallbackSellerId
        ),
    };
}

function payloadCode(payload: LazadaApiResponse): string {
    return text(payload.code);
}

function lazadaErrorMessage(payload: LazadaApiResponse): string {
    const detail = payload.detail;

    if (typeof detail === "string") {
        return detail;
    }

    if (detail && typeof detail === "object") {
        try {
            return JSON.stringify(detail);
        } catch {
            return "";
        }
    }

    return "";
}

function assertLazadaSuccess<T>(
    response: Response,
    payload: LazadaApiResponse<T>,
    operation: string
): T {
    const code = payloadCode(payload);
    const failedCode = Boolean(code && code !== "0");

    if (!response.ok || failedCode) {
        throw new Error(
            `${operation}_FAILED:${response.status}:${code || "HTTP"}:${payload.message ?? "Unknown Lazada error"}:${lazadaErrorMessage(payload)}`
        );
    }

    return (payload.data ?? payload) as T;
}

async function parseResponse(
    response: Response
): Promise<LazadaApiResponse> {
    const raw = await response.text();

    if (!raw.trim()) {
        return {};
    }

    try {
        return JSON.parse(raw) as LazadaApiResponse;
    } catch {
        throw new Error(
            `LAZADA_RESPONSE_INVALID_JSON:${response.status}:${raw.slice(0, 500)}`
        );
    }
}

async function signedRequest<T>(input: {
    env: Env;
    base: string;
    path: string;
    parameters: Record<
        string,
        string | number | boolean | undefined
    >;
    operation: string;
    method?: "GET" | "POST";
}): Promise<T> {
    const common = {
        app_key: appKey(input.env),
        timestamp: Date.now(),
        sign_method: "sha256",
        ...input.parameters,
    };
    const sign = await generateLazadaApiSignature({
        appSecret: appSecret(input.env),
        path: input.path,
        parameters: common,
    });
    const url = new URL(`${input.base}${input.path}`);

    for (const [key, value] of Object.entries({ ...common, sign })) {
        if (value !== undefined) {
            url.searchParams.set(key, String(value));
        }
    }

    const response = await fetch(url.toString(), {
        method: input.method ?? "GET",
        headers: {
            Accept: "application/json",
        },
    });
    const payload = await parseResponse(response);

    return assertLazadaSuccess<T>(
        response,
        payload as LazadaApiResponse<T>,
        input.operation
    );
}

export function buildLazadaAuthorizationUrl(env: Env): string {
    const redirectUri = env.LAZADA_REDIRECT_URI?.trim();

    if (!redirectUri) {
        throw new Error("LAZADA_REDIRECT_URI_NOT_CONFIGURED");
    }

    const url = new URL(`${authBase(env)}/oauth/authorize`);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("force_auth", "true");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("client_id", appKey(env));

    return url.toString();
}

export async function exchangeLazadaAuthorizationCode(
    env: Env,
    code: string
): Promise<LazadaTokenPayload> {
    const data = await signedRequest<unknown>({
        env,
        base: `${authBase(env)}/rest`,
        path: "/auth/token/create",
        parameters: { code },
        operation: "LAZADA_AUTH_TOKEN_CREATE",
        method: "POST",
    });

    return normalizeTokenPayload(data);
}

export async function refreshLazadaAccessToken(
    env: Env,
    credential: LazadaSellerCredential
): Promise<LazadaSellerCredential> {
    const data = await signedRequest<unknown>({
        env,
        base: `${authBase(env)}/rest`,
        path: "/auth/token/refresh",
        parameters: {
            refresh_token: credential.refresh_token,
        },
        operation: "LAZADA_AUTH_TOKEN_REFRESH",
        method: "POST",
    });
    const token = normalizeTokenPayload(data);
    const profiles = selectThailandSellerProfiles(token);
    const seller =
        profiles.find(
            (profile) => profile.seller_id === credential.seller_id
        ) ?? {
            country: credential.country,
            seller_id: credential.seller_id,
            user_id: credential.user_id,
            short_code: credential.short_code,
        };
    const updated = buildLazadaCredential({
        token,
        seller,
        previous: credential,
    });

    await saveLazadaCredential(env, updated);
    return updated;
}

export async function ensureFreshLazadaCredential(
    env: Env,
    credential: LazadaSellerCredential
): Promise<LazadaSellerCredential> {
    if (credential.access_token_expires_at > Date.now() + REFRESH_EARLY_MS) {
        return credential;
    }

    return refreshLazadaAccessToken(env, credential);
}

type LazadaApiRequestOptions = {
    parameters?: Record<
        string,
        string | number | boolean | undefined
    >;
};

async function authorizedLazadaRequest<T>(
    env: Env,
    credential: LazadaSellerCredential,
    path: string,
    options: LazadaApiRequestOptions = {},
    allowTokenRetry = true
): Promise<T> {
    const fresh = await ensureFreshLazadaCredential(env, credential);

    try {
        return await signedRequest<T>({
            env,
            base: apiBase(env),
            path,
            parameters: {
                access_token: fresh.access_token,
                ...options.parameters,
            },
            operation: `LAZADA_API_${path}`,
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        const tokenInvalid =
            lower.includes("illegalaccesstoken") ||
            lower.includes("invalidaccesstoken") ||
            (lower.includes("access token") &&
                (lower.includes("invalid") || lower.includes("expired")));

        if (!tokenInvalid || !allowTokenRetry) {
            throw error;
        }

        const reloaded =
            (await getLazadaCredentialBySellerId(
                env,
                credential.seller_id
            )) ?? credential;
        const refreshed = await refreshLazadaAccessToken(env, reloaded);

        return authorizedLazadaRequest<T>(
            env,
            refreshed,
            path,
            options,
            false
        );
    }
}



export async function getLazadaOrders(
    env: Env,
    credential: LazadaSellerCredential,
    input: {
        updatedAfter: string;
        updatedBefore?: string;
        offset?: number;
        limit?: number;
    }
): Promise<LazadaOrderListPage> {
    const offset = Math.max(0, Math.trunc(input.offset ?? 0));
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 100)));
    const data = await authorizedLazadaRequest<unknown>(
        env,
        credential,
        "/orders/get",
        {
            parameters: {
                update_after: input.updatedAfter,
                update_before: input.updatedBefore,
                sort_by: "updated_at",
                sort_direction: "ASC",
                offset,
                limit,
            },
        }
    );

    return normalizeOrderListPage(data, offset, limit);
}

export async function getLazadaOrderDetail(
    env: Env,
    credential: LazadaSellerCredential,
    orderId: string
): Promise<unknown> {
    const data = await authorizedLazadaRequest(
        env,
        credential,
        "/order/get",
        {
            parameters: { order_id: orderId },
        }
    );

    return { data };
}

export async function getLazadaOrderItems(
    env: Env,
    credential: LazadaSellerCredential,
    orderId: string
): Promise<unknown> {
    const data = await authorizedLazadaRequest(
        env,
        credential,
        "/order/items/get",
        {
            parameters: { order_id: orderId },
        }
    );

    return { data };
}

export async function getLazadaOrderTrace(
    env: Env,
    credential: LazadaSellerCredential,
    orderId: string
): Promise<unknown> {
    return authorizedLazadaRequest(
        env,
        credential,
        "/logistic/order/trace",
        {
            parameters: {
                order_id: orderId,
                seller_id: credential.seller_id,
                locale: "th_TH",
            },
        }
    );
}
