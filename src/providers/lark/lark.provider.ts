import type { Env } from "../../config/env";
import {
    classifyOperationalError,
    createHttpOperationalError,
    OperationalError,
} from "../../utils/errors";

type LarkTenantTokenResponse = {
    code: number;
    msg: string;
    tenant_access_token?: string;
    expire?: number;
};

type LarkApiResponse<T = unknown> = {
    code: number;
    msg: string;
    data?: T;
};

type CachedTenantToken = {
    cache_key: string;
    token: string;
    expires_at: number;
};

let cachedTenantToken: CachedTenantToken | null = null;
let tenantTokenRequest: Promise<string> | null = null;

function createTokenCacheKey(env: Env): string {
    return `${env.LARK_APP_ID}:${env.LARK_APP_TOKEN}`;
}

function isCachedTokenUsable(
    cached: CachedTenantToken | null,
    cacheKey: string
): cached is CachedTenantToken {
    if (!cached || cached.cache_key !== cacheKey) {
        return false;
    }

    return cached.expires_at - Date.now() > 60_000;
}

function safeJsonParse<T>(text: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new OperationalError(
            "LARK_INVALID_JSON_RESPONSE",
            `Lark returned invalid JSON: ${text.slice(0, 1000)}`,
            {
                retryable: true,
                cause: error,
            }
        );
    }
}

async function requestLarkJson<T>(
    url: string,
    init: RequestInit,
    operation: string
): Promise<T> {
    let response: Response;

    try {
        response = await fetch(url, init);
    } catch (error) {
        throw new OperationalError(
            "LARK_NETWORK_ERROR",
            `Lark ${operation} network error: ${
                error instanceof Error ? error.message : String(error)
            }`,
            {
                retryable: true,
                cause: error,
            }
        );
    }

    const bodyText = await response.text();

    if (!response.ok) {
        throw createHttpOperationalError(
            "Lark",
            operation,
            response.status,
            bodyText.slice(0, 1000)
        );
    }

    return safeJsonParse<T>(bodyText || "{}");
}

function createLarkCodeError(
    operation: string,
    data: LarkApiResponse
): OperationalError {
    const message = `Lark ${operation} Error: ${JSON.stringify(data)}`;
    const classification = classifyOperationalError(message);

    return new OperationalError(
        `LARK_API_${data.code}`,
        message,
        {
            retryable: classification.retryable,
        }
    );
}

function isRecordNotFound(data: LarkApiResponse): boolean {
    const normalized = `${data.code} ${data.msg}`.toLowerCase();

    return (
        normalized.includes("recordnotfound") ||
        normalized.includes("record not found") ||
        normalized.includes("record does not exist") ||
        normalized.includes("record not exist") ||
        normalized.includes("1254043")
    );
}

async function requestTenantAccessToken(env: Env): Promise<string> {
    const data = await requestLarkJson<LarkTenantTokenResponse>(
        "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                app_id: env.LARK_APP_ID,
                app_secret: env.LARK_APP_SECRET,
            }),
        },
        "auth"
    );

    if (data.code !== 0 || !data.tenant_access_token) {
        throw createLarkCodeError("Auth", data);
    }

    const expireSeconds = Math.max(data.expire ?? 7_200, 120);

    cachedTenantToken = {
        cache_key: createTokenCacheKey(env),
        token: data.tenant_access_token,
        expires_at: Date.now() + expireSeconds * 1_000,
    };

    return data.tenant_access_token;
}

export async function getTenantAccessToken(env: Env): Promise<string> {
    const cacheKey = createTokenCacheKey(env);

    if (isCachedTokenUsable(cachedTenantToken, cacheKey)) {
        return cachedTenantToken.token;
    }

    if (!tenantTokenRequest) {
        tenantTokenRequest = requestTenantAccessToken(env).finally(() => {
            tenantTokenRequest = null;
        });
    }

    return await tenantTokenRequest;
}

export function clearTenantAccessTokenCache(): void {
    cachedTenantToken = null;
    tenantTokenRequest = null;
}

export async function createLarkRecord(
    env: Env,
    tableId: string,
    fields: Record<string, unknown>
): Promise<unknown> {
    const token = await getTenantAccessToken(env);
    const data = await requestLarkJson<LarkApiResponse>(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${env.LARK_APP_TOKEN}/tables/${tableId}/records`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ fields }),
        },
        "create record"
    );

    if (data.code !== 0) {
        throw createLarkCodeError("Create Record", data);
    }

    return data.data;
}

export async function updateLarkRecord(
    env: Env,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>
): Promise<unknown> {
    const token = await getTenantAccessToken(env);
    const data = await requestLarkJson<LarkApiResponse>(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${env.LARK_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
        {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ fields }),
        },
        "update record"
    );

    if (data.code !== 0) {
        throw createLarkCodeError("Update Record", data);
    }

    return data.data;
}

export async function searchLarkRecords(
    env: Env,
    tableId: string,
    filter: Record<string, unknown>
): Promise<any[]> {
    const token = await getTenantAccessToken(env);
    const records: any[] = [];
    let pageToken = "";

    for (let page = 0; page < 100; page += 1) {
        const url = new URL(
            `https://open.larksuite.com/open-apis/bitable/v1/apps/${env.LARK_APP_TOKEN}/tables/${tableId}/records/search`
        );

        if (pageToken) {
            url.searchParams.set("page_token", pageToken);
        }

        const data = await requestLarkJson<
            LarkApiResponse<{
                items?: any[];
                has_more?: boolean;
                page_token?: string;
            }>
        >(
            url.toString(),
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    filter,
                    page_size: 100,
                }),
            },
            "search record"
        );

        if (data.code !== 0) {
            throw createLarkCodeError("Search Record", data);
        }

        records.push(...(data.data?.items ?? []));

        if (!data.data?.has_more || !data.data.page_token) {
            return records;
        }

        pageToken = data.data.page_token;
    }

    throw new OperationalError(
        "LARK_PAGINATION_LIMIT",
        `Lark search pagination exceeded 100 pages for table ${tableId}`,
        {
            retryable: false,
        }
    );
}

export async function getLarkRecord(
    env: Env,
    tableId: string,
    recordId: string
): Promise<any> {
    const token = await getTenantAccessToken(env);
    let data: LarkApiResponse<{ record?: any }>;

    try {
        data = await requestLarkJson<
            LarkApiResponse<{ record?: any }>
        >(
            `https://open.larksuite.com/open-apis/bitable/v1/apps/${env.LARK_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            },
            "get record"
        );
    } catch (error) {
        if (
            error instanceof OperationalError &&
            error.status === 404
        ) {
            return null;
        }

        throw error;
    }

    if (data.code !== 0) {
        if (isRecordNotFound(data)) {
            return null;
        }

        throw createLarkCodeError("Get Record", data);
    }

    return data.data?.record ?? null;
}
