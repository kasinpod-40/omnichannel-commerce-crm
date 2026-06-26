import type { Env } from "../../config/env";
import { AuthError } from "../../modules/auth/auth.error";
import type { LarkLoginIdentity } from "../../modules/auth/auth.types";

type LarkAppTokenResponse = {
    code?: number;
    msg?: string;
    app_access_token?: string;
    expire?: number;
};

type LarkUserTokenData = {
    access_token?: string;
    user_access_token?: string;
    expires_in?: number;
    token_type?: string;
};

type LarkUserTokenResponse = LarkUserTokenData & {
    code?: number;
    msg?: string;
    data?: LarkUserTokenData;
};

type LarkUserInfoData = {
    open_id?: string;
    union_id?: string;
    user_id?: string;
    tenant_key?: string;
    name?: string;
    en_name?: string;
    email?: string;
    avatar_url?: string;
    avatar_thumb?: string;
};

type LarkUserInfoResponse = LarkUserInfoData & {
    code?: number;
    msg?: string;
    data?: LarkUserInfoData;
};

type CachedAppToken = {
    app_id: string;
    token: string;
    expires_at: number;
};

let cachedAppToken: CachedAppToken | null = null;
let appTokenRequest: Promise<string> | null = null;

function parseJson<T>(text: string, operation: string): T {
    try {
        return JSON.parse(text) as T;
    } catch (error) {
        throw new AuthError(
            "LARK_AUTH_INVALID_JSON",
            `Lark returned invalid JSON during ${operation}`,
            502,
            error
        );
    }
}

async function requestJson<T>(
    url: string,
    init: RequestInit,
    operation: string
): Promise<T> {
    let response: Response;

    try {
        response = await fetch(url, init);
    } catch (error) {
        throw new AuthError(
            "LARK_AUTH_NETWORK_ERROR",
            `Cannot connect to Lark during ${operation}`,
            502,
            error
        );
    }

    const text = await response.text();

    if (!response.ok) {
        throw new AuthError(
            "LARK_AUTH_HTTP_ERROR",
            `Lark ${operation} returned HTTP ${response.status}: ${text.slice(0, 500)}`,
            502
        );
    }

    return parseJson<T>(text || "{}", operation);
}

function assertLarkSuccess(
    response: { code?: number; msg?: string },
    operation: string
): void {
    if (response.code !== undefined && response.code !== 0) {
        throw new AuthError(
            `LARK_AUTH_${response.code}`,
            `Lark ${operation} failed: ${response.msg ?? "unknown error"}`,
            401
        );
    }
}

async function requestAppAccessToken(env: Env): Promise<string> {
    const response = await requestJson<LarkAppTokenResponse>(
        "https://open.larksuite.com/open-apis/auth/v3/app_access_token/internal",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                app_id: env.LARK_APP_ID,
                app_secret: env.LARK_APP_SECRET,
            }),
        },
        "app access token"
    );

    assertLarkSuccess(response, "app access token");

    if (!response.app_access_token) {
        throw new AuthError(
            "LARK_APP_TOKEN_MISSING",
            "Lark app access token response is missing app_access_token",
            502
        );
    }

    const expireSeconds = Math.max(response.expire ?? 7_200, 120);
    cachedAppToken = {
        app_id: env.LARK_APP_ID,
        token: response.app_access_token,
        expires_at: Date.now() + expireSeconds * 1_000,
    };

    return response.app_access_token;
}

export async function getLarkAppAccessToken(env: Env): Promise<string> {
    if (
        cachedAppToken?.app_id === env.LARK_APP_ID &&
        cachedAppToken.expires_at - Date.now() > 60_000
    ) {
        return cachedAppToken.token;
    }

    if (!appTokenRequest) {
        appTokenRequest = requestAppAccessToken(env).finally(() => {
            appTokenRequest = null;
        });
    }

    return await appTokenRequest;
}

/**
 * Temporary Code จาก Browser OAuth และ tt.requestAccess ใช้ขั้นตอนแลก Token เดียวกัน
 * user_access_token ถูกใช้ชั่วคราวเพื่ออ่านตัวตน และไม่ถูกเก็บใน Session Cookie
 */
export async function exchangeLarkAuthorizationCode(
    env: Env,
    code: string
): Promise<string> {
    const appAccessToken = await getLarkAppAccessToken(env);
    const response = await requestJson<LarkUserTokenResponse>(
        "https://open.larksuite.com/open-apis/authen/v1/access_token",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${appAccessToken}`,
            },
            body: JSON.stringify({
                grant_type: "authorization_code",
                code,
            }),
        },
        "authorization code exchange"
    );

    assertLarkSuccess(response, "authorization code exchange");
    const payload = response.data ?? response;
    const token = payload.user_access_token ?? payload.access_token;

    if (!token) {
        throw new AuthError(
            "LARK_USER_TOKEN_MISSING",
            "Lark authorization response is missing user access token",
            502
        );
    }

    return token;
}

/** อ่านข้อมูลผู้ใช้ที่ Login อยู่ด้วย user_access_token */
export async function getLarkLoginIdentity(
    userAccessToken: string
): Promise<LarkLoginIdentity> {
    const response = await requestJson<LarkUserInfoResponse>(
        "https://open.larksuite.com/open-apis/authen/v1/user_info",
        {
            method: "GET",
            headers: {
                Authorization: `Bearer ${userAccessToken}`,
            },
        },
        "user information"
    );

    assertLarkSuccess(response, "user information");
    const payload = response.data ?? response;
    const openId = payload.open_id?.trim() ?? "";

    if (!openId) {
        throw new AuthError(
            "LARK_OPEN_ID_MISSING",
            "Lark user information is missing open_id",
            502
        );
    }

    return {
        open_id: openId,
        union_id: payload.union_id?.trim() || null,
        user_id: payload.user_id?.trim() || null,
        tenant_key: payload.tenant_key?.trim() || null,
        name:
            payload.name?.trim() ||
            payload.en_name?.trim() ||
            "Lark User",
        email: payload.email?.trim() || null,
        avatar_url:
            payload.avatar_url?.trim() ||
            payload.avatar_thumb?.trim() ||
            null,
    };
}

export function clearLarkAppAccessTokenCache(): void {
    cachedAppToken = null;
    appTokenRequest = null;
}
