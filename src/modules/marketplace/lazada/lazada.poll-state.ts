import type { Env } from "../../../config/env";

const POLL_STATE_PREFIX = "lazada:poll-state:";

export type LazadaPollRunCounts = {
    discovered: number;
    processed: number;
    created: number;
    updated: number;
    duplicate: number;
    stale: number;
    failed: number;
};

export type LazadaPollState = {
    seller_id: string;
    cursor_updated_after_ms: number;
    pending_retry_order_ids: string[];
    last_run_started_at?: number;
    last_run_completed_at?: number;
    last_success_at?: number;
    last_error?: string;
    last_counts?: LazadaPollRunCounts;
};

function requireStore(env: Env): KVNamespace {
    if (!env.MARKETPLACE_TOKENS) {
        throw new Error("MARKETPLACE_TOKENS_KV_NOT_CONFIGURED");
    }

    return env.MARKETPLACE_TOKENS;
}

function key(sellerId: string): string {
    return `${POLL_STATE_PREFIX}${sellerId}`;
}

export async function getLazadaPollState(
    env: Env,
    sellerId: string
): Promise<LazadaPollState | null> {
    return requireStore(env).get<LazadaPollState>(key(sellerId), "json");
}

export async function saveLazadaPollState(
    env: Env,
    state: LazadaPollState
): Promise<void> {
    await requireStore(env).put(key(state.seller_id), JSON.stringify(state));
}

export async function resetLazadaPollState(
    env: Env,
    sellerId: string,
    cursorUpdatedAfterMs: number
): Promise<LazadaPollState> {
    const state: LazadaPollState = {
        seller_id: sellerId,
        cursor_updated_after_ms: cursorUpdatedAfterMs,
        pending_retry_order_ids: [],
    };

    await saveLazadaPollState(env, state);
    return state;
}
