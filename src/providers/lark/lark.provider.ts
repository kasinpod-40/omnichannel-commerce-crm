import type { Env } from "../../config/env";

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

    // เว้นระยะ 60 วินาทีก่อนหมดอายุ เพื่อลดความเสี่ยงที่ Token
    // หมดอายุระหว่างกำลังเรียก Lark API
    return cached.expires_at - Date.now() > 60_000;
}

async function requestTenantAccessToken(env: Env): Promise<string> {
    const response = await fetch(
        "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                app_id: env.LARK_APP_ID,
                app_secret: env.LARK_APP_SECRET,
            }),
        }
    );

    const data = (await response.json()) as LarkTenantTokenResponse;

    if (data.code !== 0 || !data.tenant_access_token) {
        throw new Error(`Lark Auth Error: ${JSON.stringify(data)}`);
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

    const response = await fetch(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${env.LARK_APP_TOKEN}/tables/${tableId}/records`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ fields }),
        }
    );

    const data = (await response.json()) as LarkApiResponse;

    if (data.code !== 0) {
        throw new Error(`Lark Create Record Error: ${JSON.stringify(data)}`);
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

    const response = await fetch(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${env.LARK_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
        {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ fields }),
        }
    );

    const data = (await response.json()) as LarkApiResponse;

    if (data.code !== 0) {
        throw new Error(`Lark Update Record Error: ${JSON.stringify(data)}`);
    }

    return data.data;
}

export async function searchLarkRecords(
    env: Env,
    tableId: string,
    filter: Record<string, unknown>
): Promise<any[]> {
    const token = await getTenantAccessToken(env);

    const response = await fetch(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${env.LARK_APP_TOKEN}/tables/${tableId}/records/search`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                filter,
                page_size: 20,
            }),
        }
    );

    const data = (await response.json()) as LarkApiResponse<{ items?: any[] }>;

    if (data.code !== 0) {
        throw new Error(`Lark Search Record Error: ${JSON.stringify(data)}`);
    }

    return data.data?.items ?? [];
}

export async function getLarkRecord(
    env: Env,
    tableId: string,
    recordId: string
): Promise<any> {
    const token = await getTenantAccessToken(env);

    const response = await fetch(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${env.LARK_APP_TOKEN}/tables/${tableId}/records/${recordId}`,
        {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }
    );

    const data = (await response.json()) as LarkApiResponse<{ record?: any }>;

    if (data.code !== 0) {
        throw new Error(`Lark Get Record Error: ${JSON.stringify(data)}`);
    }

    return data.data?.record;
}
