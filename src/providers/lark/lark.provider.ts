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

export async function getTenantAccessToken(env: Env): Promise<string> {
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

    return data.tenant_access_token;
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