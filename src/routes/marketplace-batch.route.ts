import type { Env } from "../config/env";
import {
    adaptShopeeThailand,
} from "../modules/marketplace/adapters/shopee.adapter";
import {
    adaptTikTokThailand,
} from "../modules/marketplace/adapters/tiktok.adapter";
import type {
    MarketplaceAdapter,
    MarketplaceSimulationEnvelope,
} from "../modules/marketplace/adapters/adapter.types";
import type {
    MarketplaceOrderUpsertResult,
} from "../modules/marketplace/marketplace.types";
import { upsertMarketplaceOrder } from "../modules/marketplace/marketplace.service";
import { jsonResponse } from "../utils/response";

type ManualBatchChannel = "Shopee" | "TikTok";

type MarketplaceManualBatchItem = MarketplaceSimulationEnvelope & {
    channel: unknown;
    reference?: string;
};

type MarketplaceManualBatchBody = {
    orders: MarketplaceManualBatchItem[];
    dry_run?: boolean;
    continue_on_error?: boolean;
};

type MarketplaceManualBatchResult = {
    index: number;
    reference?: string;
    channel: string;
    ok: boolean;
    mode: "dry_run" | "upsert";
    normalized?: unknown;
    result?: MarketplaceOrderUpsertResult;
    error?: {
        code: string;
        message: string;
    };
};

const MAX_BATCH_ORDERS = 20;

function getAdminToken(request: Request): string {
    const authorization = request.headers.get("Authorization") ?? "";

    return /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : request.headers.get("X-Admin-Token")?.trim() ?? "";
}

function isSupportedChannel(value: unknown): value is ManualBatchChannel {
    return value === "Shopee" || value === "TikTok";
}

function adapterForChannel(channel: ManualBatchChannel): MarketplaceAdapter {
    return channel === "Shopee"
        ? adaptShopeeThailand
        : adaptTikTokThailand;
}

function errorCodeForMessage(message: string): string {
    if (
        message.includes("MISSING_") ||
        message.startsWith("MARKETPLACE_") ||
        message.endsWith("_REQUIRED")
    ) {
        return "INVALID_MARKETPLACE_ORDER";
    }

    return "MARKETPLACE_ORDER_SYNC_FAILED";
}

export async function handleMarketplaceManualBatch(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    const configuredToken = env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "";

    if (!configuredToken || getAdminToken(request) !== configuredToken) {
        return jsonResponse(
            {
                ok: false,
                code: "UNAUTHORIZED",
                message: "Admin token ไม่ถูกต้อง",
            },
            401
        );
    }

    let body: MarketplaceManualBatchBody;

    try {
        body = (await request.json()) as MarketplaceManualBatchBody;
    } catch {
        return jsonResponse({ ok: false, code: "INVALID_JSON" }, 400);
    }

    if (!Array.isArray(body.orders) || body.orders.length === 0) {
        return jsonResponse(
            {
                ok: false,
                code: "ORDERS_REQUIRED",
                message: "orders ต้องเป็น Array และมีอย่างน้อย 1 รายการ",
            },
            400
        );
    }

    if (body.orders.length > MAX_BATCH_ORDERS) {
        return jsonResponse(
            {
                ok: false,
                code: "BATCH_LIMIT_EXCEEDED",
                message: `ทดสอบได้สูงสุด ${MAX_BATCH_ORDERS} Orders ต่อ Request`,
            },
            400
        );
    }

    const continueOnError = body.continue_on_error !== false;
    const results: MarketplaceManualBatchResult[] = [];

    for (let index = 0; index < body.orders.length; index += 1) {
        const item = body.orders[index];
        const reference = typeof item?.reference === "string"
            ? item.reference.trim() || undefined
            : undefined;
        const channel = item?.channel;

        if (!isSupportedChannel(channel)) {
            const result: MarketplaceManualBatchResult = {
                index,
                reference,
                channel: typeof channel === "string" ? channel : "Unknown",
                ok: false,
                mode: body.dry_run === true ? "dry_run" : "upsert",
                error: {
                    code: "UNSUPPORTED_CHANNEL",
                    message: "Batch นี้รองรับเฉพาะ Shopee และ TikTok",
                },
            };
            results.push(result);

            if (!continueOnError) {
                break;
            }

            continue;
        }

        const effectiveDryRun = item.dry_run ?? body.dry_run ?? false;

        try {
            const adapted = adapterForChannel(channel)(item);

            if (effectiveDryRun) {
                results.push({
                    index,
                    reference,
                    channel,
                    ok: true,
                    mode: "dry_run",
                    normalized: adapted.normalized,
                });
                continue;
            }

            const result = await upsertMarketplaceOrder(
                env,
                adapted.normalized
            );

            results.push({
                index,
                reference,
                channel,
                ok: true,
                mode: "upsert",
                normalized: adapted.normalized,
                result,
            });
        } catch (error) {
            const message = error instanceof Error
                ? error.message
                : String(error);

            results.push({
                index,
                reference,
                channel,
                ok: false,
                mode: effectiveDryRun ? "dry_run" : "upsert",
                error: {
                    code: errorCodeForMessage(message),
                    message,
                },
            });

            if (!continueOnError) {
                break;
            }
        }
    }

    const successful = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    const actionCounts = {
        created: 0,
        updated: 0,
        duplicate: 0,
        stale: 0,
    };

    for (const item of successful) {
        if (item.result) {
            actionCounts[item.result.action] += 1;
        }
    }

    const response = {
        ok: failed.length === 0,
        mode: "shopee-tiktok-manual-batch",
        region: "TH",
        currency: "THB",
        summary: {
            requested: body.orders.length,
            processed: results.length,
            succeeded: successful.length,
            failed: failed.length,
            dry_run: successful.filter((result) => result.mode === "dry_run").length,
            ...actionCounts,
            by_channel: {
                Shopee: results.filter((result) => result.channel === "Shopee").length,
                TikTok: results.filter((result) => result.channel === "TikTok").length,
            },
        },
        results,
    };

    return jsonResponse(response, failed.length > 0 ? 207 : 200);
}
