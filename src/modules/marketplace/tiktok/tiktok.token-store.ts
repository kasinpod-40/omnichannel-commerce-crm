import type { Env } from "../../../config/env";
import { recordMarketplaceDashboardEvent } from "../marketplace-event-log";
import type {
    TikTokAuthorizedShop,
    TikTokShopCredential,
    TikTokTokenPayload,
} from "./tiktok.types";

const SHOP_PREFIX = "tiktok:shop:";
const SHOP_ID_PREFIX = "tiktok:shop-id:";
const OPEN_ID_PREFIX = "tiktok:open-id:";

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

export function buildTikTokCredential(input: {
    token: TikTokTokenPayload;
    shop: TikTokAuthorizedShop;
    previous?: TikTokShopCredential | null;
}): TikTokShopCredential {
    const now = Date.now();

    return {
        platform: "TikTok",
        shop_cipher: input.shop.shop_cipher,
        shop_id: input.shop.shop_id,
        shop_name: input.shop.shop_name,
        region: input.shop.region || "TH",
        seller_type: input.shop.seller_type,
        open_id: input.token.open_id ?? input.previous?.open_id,
        access_token: input.token.access_token,
        refresh_token:
            input.token.refresh_token ||
            input.previous?.refresh_token ||
            "",
        access_token_expires_at: normalizeExpiry(
            input.token.access_token_expire_in,
            7 * 24 * 60 * 60 * 1000
        ),
        refresh_token_expires_at: normalizeExpiry(
            input.token.refresh_token_expire_in,
            30 * 24 * 60 * 60 * 1000
        ),
        granted_scopes:
            input.token.granted_scopes ??
            input.previous?.granted_scopes ??
            [],
        connected_at: input.previous?.connected_at ?? now,
        updated_at: now,
    };
}

export async function saveTikTokCredential(
    env: Env,
    credential: TikTokShopCredential
): Promise<void> {
    const store = requireStore(env);
    const payload = JSON.stringify(credential);

    await Promise.all([
        store.put(`${SHOP_PREFIX}${credential.shop_cipher}`, payload),
        store.put(
            `${SHOP_ID_PREFIX}${credential.shop_id}`,
            credential.shop_cipher
        ),
        credential.open_id
            ? store.put(
                  `${OPEN_ID_PREFIX}${credential.open_id}`,
                  credential.shop_cipher
              )
            : Promise.resolve(),
    ]);

    try {
        await recordMarketplaceDashboardEvent(env, {
            id: `oauth:tiktok:${credential.shop_id}:${credential.updated_at}`,
            platform: "TikTok Shop",
            event_type: "oauth_refresh",
            result: "success",
            detail: "TOKEN_UPDATED",
            occurred_at: new Date(credential.updated_at).toISOString(),
        });
    } catch (error) {
        console.warn("MARKETPLACE_OAUTH_EVENT_LOG_FAILED", {
            platform: "TikTok Shop",
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function getTikTokCredentialByCipher(
    env: Env,
    shopCipher: string
): Promise<TikTokShopCredential | null> {
    return requireStore(env).get<TikTokShopCredential>(
        `${SHOP_PREFIX}${shopCipher}`,
        "json"
    );
}

export async function getTikTokCredentialByShopId(
    env: Env,
    shopId: string
): Promise<TikTokShopCredential | null> {
    const store = requireStore(env);
    const shopCipher = await store.get(`${SHOP_ID_PREFIX}${shopId}`);

    return shopCipher
        ? store.get<TikTokShopCredential>(
              `${SHOP_PREFIX}${shopCipher}`,
              "json"
          )
        : null;
}

export async function getTikTokCredentialByOpenId(
    env: Env,
    openId: string
): Promise<TikTokShopCredential | null> {
    const store = requireStore(env);
    const shopCipher = await store.get(`${OPEN_ID_PREFIX}${openId}`);

    return shopCipher
        ? store.get<TikTokShopCredential>(
              `${SHOP_PREFIX}${shopCipher}`,
              "json"
          )
        : null;
}

export async function listTikTokCredentials(
    env: Env
): Promise<TikTokShopCredential[]> {
    const store = requireStore(env);
    const result: TikTokShopCredential[] = [];
    let cursor: string | undefined;

    do {
        const page = await store.list({
            prefix: SHOP_PREFIX,
            cursor,
            limit: 100,
        });
        const credentials = await Promise.all(
            page.keys.map((key) =>
                store.get<TikTokShopCredential>(key.name, "json")
            )
        );

        result.push(
            ...credentials.filter(
                (value): value is TikTokShopCredential => Boolean(value)
            )
        );
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    return result.sort((left, right) =>
        left.shop_name.localeCompare(right.shop_name)
    );
}

export async function resolveTikTokCredential(
    env: Env,
    input: {
        shopCipher?: string;
        shopId?: string;
    }
): Promise<TikTokShopCredential | null> {
    if (input.shopCipher) {
        const byCipher = await getTikTokCredentialByCipher(
            env,
            input.shopCipher
        );

        if (byCipher) {
            return byCipher;
        }
    }

    if (input.shopId) {
        const byId = await getTikTokCredentialByShopId(
            env,
            input.shopId
        );

        if (byId) {
            return byId;
        }
    }

    const all = await listTikTokCredentials(env);
    return all.length === 1 ? all[0] : null;
}
