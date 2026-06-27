import type { Env } from "../../../config/env";
import { recordMarketplaceDashboardEvent } from "../marketplace-event-log";
import type {
    LazadaCountryUserInfo,
    LazadaSellerCredential,
    LazadaTokenPayload,
} from "./lazada.types";

const SELLER_PREFIX = "lazada:seller:";
const SHORT_CODE_PREFIX = "lazada:short-code:";
const ACCOUNT_PREFIX = "lazada:account:";

function requireStore(env: Env): KVNamespace {
    if (!env.MARKETPLACE_TOKENS) {
        throw new Error("MARKETPLACE_TOKENS_KV_NOT_CONFIGURED");
    }

    return env.MARKETPLACE_TOKENS;
}

function normalizeExpiry(
    value: number | undefined,
    fallbackMs: number
): number {
    if (!Number.isFinite(value)) {
        return Date.now() + fallbackMs;
    }

    const numeric = Number(value);

    if (numeric > 10_000_000_000) {
        return numeric;
    }

    if (numeric > 1_000_000_000) {
        return numeric * 1000;
    }

    return Date.now() + numeric * 1000;
}

function normalizeCountry(value: string): string {
    return value.trim().toLowerCase() || "th";
}

export function selectThailandSellerProfiles(
    token: LazadaTokenPayload
): LazadaCountryUserInfo[] {
    const profiles = token.country_user_info.filter(
        (profile) => profile.seller_id.trim()
    );
    const thailand = profiles.filter(
        (profile) => normalizeCountry(profile.country) === "th"
    );

    return thailand.length > 0 ? thailand : profiles;
}

export function buildLazadaCredential(input: {
    token: LazadaTokenPayload;
    seller: LazadaCountryUserInfo;
    previous?: LazadaSellerCredential | null;
}): LazadaSellerCredential {
    const now = Date.now();

    return {
        platform: "Lazada",
        seller_id: input.seller.seller_id,
        user_id: input.seller.user_id ?? input.previous?.user_id,
        short_code:
            input.seller.short_code ?? input.previous?.short_code,
        account: input.token.account ?? input.previous?.account,
        country: normalizeCountry(
            input.seller.country || input.token.country || "th"
        ),
        region: "TH",
        access_token: input.token.access_token,
        refresh_token:
            input.token.refresh_token ||
            input.previous?.refresh_token ||
            "",
        access_token_expires_at: normalizeExpiry(
            input.token.expires_in,
            30 * 24 * 60 * 60 * 1000
        ),
        refresh_token_expires_at: normalizeExpiry(
            input.token.refresh_expires_in,
            180 * 24 * 60 * 60 * 1000
        ),
        connected_at: input.previous?.connected_at ?? now,
        updated_at: now,
    };
}

export async function saveLazadaCredential(
    env: Env,
    credential: LazadaSellerCredential
): Promise<void> {
    const store = requireStore(env);
    const payload = JSON.stringify(credential);
    const operations: Promise<void>[] = [
        store.put(`${SELLER_PREFIX}${credential.seller_id}`, payload),
    ];

    if (credential.short_code) {
        operations.push(
            store.put(
                `${SHORT_CODE_PREFIX}${credential.short_code}`,
                credential.seller_id
            )
        );
    }

    if (credential.account) {
        operations.push(
            store.put(
                `${ACCOUNT_PREFIX}${credential.account}`,
                credential.seller_id
            )
        );
    }

    await Promise.all(operations);

    try {
        await recordMarketplaceDashboardEvent(env, {
            id: `oauth:lazada:${credential.seller_id}:${credential.updated_at}`,
            platform: "Lazada",
            event_type: "oauth_refresh",
            result: "success",
            detail: "TOKEN_UPDATED",
            occurred_at: new Date(credential.updated_at).toISOString(),
        });
    } catch (error) {
        console.warn("MARKETPLACE_OAUTH_EVENT_LOG_FAILED", {
            platform: "Lazada",
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function getLazadaCredentialBySellerId(
    env: Env,
    sellerId: string
): Promise<LazadaSellerCredential | null> {
    return requireStore(env).get<LazadaSellerCredential>(
        `${SELLER_PREFIX}${sellerId}`,
        "json"
    );
}

export async function getLazadaCredentialByShortCode(
    env: Env,
    shortCode: string
): Promise<LazadaSellerCredential | null> {
    const store = requireStore(env);
    const sellerId = await store.get(
        `${SHORT_CODE_PREFIX}${shortCode}`
    );

    return sellerId
        ? getLazadaCredentialBySellerId(env, sellerId)
        : null;
}

export async function listLazadaCredentials(
    env: Env
): Promise<LazadaSellerCredential[]> {
    const store = requireStore(env);
    const result: LazadaSellerCredential[] = [];
    let cursor: string | undefined;

    do {
        const page = await store.list({
            prefix: SELLER_PREFIX,
            cursor,
            limit: 100,
        });
        const credentials = await Promise.all(
            page.keys.map((key) =>
                store.get<LazadaSellerCredential>(key.name, "json")
            )
        );

        result.push(
            ...credentials.filter(
                (value): value is LazadaSellerCredential => Boolean(value)
            )
        );
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    return result.sort((left, right) =>
        (left.account || left.seller_id).localeCompare(
            right.account || right.seller_id
        )
    );
}

export async function resolveLazadaCredential(
    env: Env,
    input: {
        sellerId?: string;
        shortCode?: string;
    }
): Promise<LazadaSellerCredential | null> {
    if (input.sellerId) {
        const bySeller = await getLazadaCredentialBySellerId(
            env,
            input.sellerId
        );

        if (bySeller) {
            return bySeller;
        }
    }

    if (input.shortCode) {
        const byShortCode = await getLazadaCredentialByShortCode(
            env,
            input.shortCode
        );

        if (byShortCode) {
            return byShortCode;
        }
    }

    const all = await listLazadaCredentials(env);
    return all.length === 1 ? all[0] : null;
}
