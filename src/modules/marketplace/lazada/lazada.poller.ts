import type { Env } from "../../../config/env";
import { adaptLazadaThailand } from "../adapters/lazada.adapter";
import { upsertMarketplaceOrder } from "../marketplace.service";
import {
    getLazadaOrderDetail,
    getLazadaOrderItems,
    getLazadaOrderTrace,
    getLazadaOrders,
} from "./lazada.api";
import {
    getLazadaPollState,
    resetLazadaPollState,
    saveLazadaPollState,
    type LazadaPollRunCounts,
    type LazadaPollState,
} from "./lazada.poll-state";
import {
    listLazadaCredentials,
    resolveLazadaCredential,
} from "./lazada.token-store";
import type {
    LazadaOrderListItem,
    LazadaSellerCredential,
    LazadaWebhookEnvelope,
} from "./lazada.types";

const DEFAULT_INITIAL_LOOKBACK_MINUTES = 24 * 60;
const DEFAULT_OVERLAP_MINUTES = 10;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 5;
const MAX_PENDING_RETRIES = 100;

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

function firstText(...values: unknown[]): string {
    for (const value of values) {
        const normalized = text(value);

        if (normalized) {
            return normalized;
        }
    }

    return "";
}

function numberConfig(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number
): number {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function toTimestamp(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value < 10_000_000_000 ? value * 1000 : value;
    }

    const normalized = text(value);

    if (!normalized) {
        return undefined;
    }

    const numeric = Number(normalized);

    if (Number.isFinite(numeric)) {
        return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function orderIdFromSummary(order: LazadaOrderListItem): string {
    return firstText(
        order.order_id,
        order.order_number,
        order.trade_order_id,
        order.id
    );
}

function orderUpdatedAtFromSummary(
    order: LazadaOrderListItem
): number | undefined {
    return toTimestamp(
        order.updated_at ??
            order.update_time ??
            order.status_update_time ??
            order.created_at ??
            order.create_time
    );
}

function orderRecord(orderDetail: unknown): Record<string, unknown> {
    const root = asRecord(orderDetail);
    const data = asRecord(root.data);
    const candidates = [
        data.order,
        data.orders,
        root.order,
        root.orders,
        data,
        root,
    ];

    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            const first = asRecord(candidate[0]);

            if (Object.keys(first).length > 0) {
                return first;
            }
        }

        const record = asRecord(candidate);

        if (Object.keys(record).length > 0) {
            return record;
        }
    }

    return {};
}

function extractOrderStatus(orderDetail: unknown): string {
    const order = orderRecord(orderDetail);
    const statuses = Array.isArray(order.statuses)
        ? order.statuses.map(text).filter(Boolean)
        : [];

    return firstText(statuses[0], order.status, "pending");
}

function extractOrderUpdatedAt(orderDetail: unknown): string | number {
    const order = orderRecord(orderDetail);
    return firstText(
        order.updated_at,
        order.update_time,
        order.created_at,
        order.create_time,
        Date.now()
    );
}

function findFirstValueByKeys(
    value: unknown,
    keys: Set<string>,
    depth = 0
): string {
    if (depth > 8 || value === null || value === undefined) {
        return "";
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findFirstValueByKeys(item, keys, depth + 1);

            if (found) {
                return found;
            }
        }

        return "";
    }

    const record = asRecord(value);

    for (const [key, nested] of Object.entries(record)) {
        if (keys.has(key.toLowerCase())) {
            const found = text(nested);

            if (found) {
                return found;
            }
        }
    }

    for (const nested of Object.values(record)) {
        const found = findFirstValueByKeys(nested, keys, depth + 1);

        if (found) {
            return found;
        }
    }

    return "";
}

function mergeLogistics(input: {
    orderDetail: unknown;
    orderItems: unknown;
    orderTrace?: unknown;
}): { orderDetail: unknown; orderItems: unknown } {
    if (!input.orderTrace) {
        return {
            orderDetail: input.orderDetail,
            orderItems: input.orderItems,
        };
    }

    const trackingNumber = findFirstValueByKeys(
        input.orderTrace,
        new Set([
            "tracking_code",
            "tracking_number",
            "tracking_no",
            "package_code",
            "logistics_no",
        ])
    );
    const shippingProvider = findFirstValueByKeys(
        input.orderTrace,
        new Set([
            "shipping_provider",
            "shipment_provider",
            "shipping_provider_type",
            "logistics_provider",
            "provider_name",
        ])
    );

    if (!trackingNumber && !shippingProvider) {
        return {
            orderDetail: input.orderDetail,
            orderItems: input.orderItems,
        };
    }

    const detail = structuredClone(input.orderDetail);
    const items = structuredClone(input.orderItems);
    const detailRoot = asRecord(detail);
    const detailData = asRecord(detailRoot.data);
    const detailOrder = Object.keys(detailData).length
        ? detailData
        : detailRoot;

    if (trackingNumber && !firstText(detailOrder.tracking_code)) {
        detailOrder.tracking_code = trackingNumber;
    }

    if (shippingProvider && !firstText(detailOrder.shipping_provider)) {
        detailOrder.shipping_provider = shippingProvider;
    }

    if (Object.keys(detailData).length) {
        detailRoot.data = detailOrder;
    }

    const itemsRoot = asRecord(items);
    const itemsData = Array.isArray(itemsRoot.data)
        ? itemsRoot.data
        : Array.isArray(items)
          ? items
          : [];

    if (itemsData.length > 0) {
        const firstItem = asRecord(itemsData[0]);

        if (trackingNumber && !firstText(firstItem.tracking_code)) {
            firstItem.tracking_code = trackingNumber;
        }

        if (shippingProvider && !firstText(firstItem.shipment_provider)) {
            firstItem.shipment_provider = shippingProvider;
        }

        itemsData[0] = firstItem;

        if (Array.isArray(itemsRoot.data)) {
            itemsRoot.data = itemsData;
        }
    }

    return { orderDetail: detail, orderItems: items };
}

async function syncOneOrder(
    env: Env,
    credential: LazadaSellerCredential,
    orderId: string
) {
    const [orderDetail, orderItems] = await Promise.all([
        getLazadaOrderDetail(env, credential, orderId),
        getLazadaOrderItems(env, credential, orderId),
    ]);
    let orderTrace: unknown;

    try {
        orderTrace = await getLazadaOrderTrace(env, credential, orderId);
    } catch (error) {
        console.warn("LAZADA_POLL_ORDER_TRACE_FAILED", {
            seller_id: credential.seller_id,
            order_id: orderId,
            error: error instanceof Error ? error.message : String(error),
        });
    }

    const merged = mergeLogistics({
        orderDetail,
        orderItems,
        orderTrace,
    });
    const webhook: LazadaWebhookEnvelope = {
        seller_id: credential.seller_id,
        message_type: 0,
        timestamp: Date.now(),
        site: "lazada_th",
        data: {
            trade_order_id: orderId,
            order_status: extractOrderStatus(merged.orderDetail),
            status_update_time: extractOrderUpdatedAt(merged.orderDetail),
        },
    };
    const adapted = adaptLazadaThailand({
        webhook,
        order_detail_response: merged.orderDetail,
        order_items_response: merged.orderItems,
        store_name: credential.account || `Lazada ${credential.seller_id}`,
    });

    return upsertMarketplaceOrder(env, adapted.normalized);
}

function emptyCounts(): LazadaPollRunCounts {
    return {
        discovered: 0,
        processed: 0,
        created: 0,
        updated: 0,
        duplicate: 0,
        stale: 0,
        failed: 0,
    };
}

export type LazadaSellerPollReport = {
    seller_id: string;
    started_at: number;
    completed_at: number;
    window_start: string;
    window_end: string;
    cursor_before: string;
    cursor_after: string;
    pages_fetched: number;
    page_cap_reached: boolean;
    pending_retry_order_ids: string[];
    counts: LazadaPollRunCounts;
    error?: string;
};

export type LazadaPollReport = {
    ok: boolean;
    trigger: "cron" | "admin";
    started_at: number;
    completed_at: number;
    sellers: LazadaSellerPollReport[];
};

async function pollSeller(input: {
    env: Env;
    credential: LazadaSellerCredential;
    runAtMs: number;
    lookbackMinutes?: number;
    resetCursor?: boolean;
}): Promise<LazadaSellerPollReport> {
    const { env, credential, runAtMs } = input;
    const startedAt = Date.now();
    const initialLookbackMinutes = numberConfig(
        env.LAZADA_POLL_INITIAL_LOOKBACK_MINUTES,
        DEFAULT_INITIAL_LOOKBACK_MINUTES,
        5,
        30 * 24 * 60
    );
    const overlapMinutes = numberConfig(
        env.LAZADA_POLL_OVERLAP_MINUTES,
        DEFAULT_OVERLAP_MINUTES,
        1,
        60
    );
    const pageSize = numberConfig(
        env.LAZADA_POLL_PAGE_SIZE,
        DEFAULT_PAGE_SIZE,
        1,
        100
    );
    const maxPages = numberConfig(
        env.LAZADA_POLL_MAX_PAGES,
        DEFAULT_MAX_PAGES,
        1,
        50
    );
    const requestedLookback = input.lookbackMinutes
        ? Math.max(5, Math.trunc(input.lookbackMinutes))
        : undefined;
    let state = await getLazadaPollState(env, credential.seller_id);

    if (input.resetCursor || !state) {
        state = await resetLazadaPollState(
            env,
            credential.seller_id,
            runAtMs -
                (requestedLookback ?? initialLookbackMinutes) * 60 * 1000
        );
    }

    const cursorBefore = state.cursor_updated_after_ms;
    const queryStart = Math.max(
        0,
        cursorBefore - overlapMinutes * 60 * 1000
    );
    const queryEnd = runAtMs;
    const counts = emptyCounts();
    const summaries = new Map<string, LazadaOrderListItem>();
    let pagesFetched = 0;
    let pageCapReached = false;
    let maxSummaryUpdatedAt = cursorBefore;
    let listCompleted = true;
    let listError: string | undefined;

    try {
        for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
            const offset = pageNumber * pageSize;
            const page = await getLazadaOrders(env, credential, {
                updatedAfter: new Date(queryStart).toISOString(),
                updatedBefore: new Date(queryEnd).toISOString(),
                offset,
                limit: pageSize,
            });
            pagesFetched += 1;

            for (const summary of page.orders) {
                const orderId = orderIdFromSummary(summary);

                if (!orderId) {
                    continue;
                }

                summaries.set(orderId, summary);
                const updatedAt = orderUpdatedAtFromSummary(summary);

                if (updatedAt && updatedAt > maxSummaryUpdatedAt) {
                    maxSummaryUpdatedAt = updatedAt;
                }
            }

            const returned = page.orders.length;
            const hasMoreByTotal = page.total > offset + returned;
            const hasMoreByFullPage = returned === pageSize;

            if (!hasMoreByTotal && !hasMoreByFullPage) {
                break;
            }

            if (pageNumber === maxPages - 1) {
                pageCapReached = true;
            }
        }
    } catch (error) {
        listCompleted = false;
        listError = error instanceof Error ? error.message : String(error);
    }

    const retryIds = state.pending_retry_order_ids ?? [];
    const orderIds = Array.from(new Set([...retryIds, ...summaries.keys()]));
    counts.discovered = summaries.size;
    const failedOrderIds: string[] = [];

    for (const orderId of orderIds) {
        try {
            const result = await syncOneOrder(env, credential, orderId);
            counts.processed += 1;
            counts[result.action] += 1;
        } catch (error) {
            counts.failed += 1;
            failedOrderIds.push(orderId);
            console.error("LAZADA_POLL_ORDER_FAILED", {
                seller_id: credential.seller_id,
                order_id: orderId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    let cursorAfter = cursorBefore;

    if (listCompleted) {
        cursorAfter = pageCapReached
            ? Math.max(cursorBefore, maxSummaryUpdatedAt)
            : queryEnd;
    }

    const completedAt = Date.now();
    const nextState: LazadaPollState = {
        seller_id: credential.seller_id,
        cursor_updated_after_ms: cursorAfter,
        pending_retry_order_ids: failedOrderIds.slice(0, MAX_PENDING_RETRIES),
        last_run_started_at: startedAt,
        last_run_completed_at: completedAt,
        last_success_at:
            listCompleted && failedOrderIds.length === 0
                ? completedAt
                : state.last_success_at,
        last_error:
            listError ??
            (failedOrderIds.length > 0
                ? `${failedOrderIds.length} order(s) failed`
                : undefined),
        last_counts: counts,
    };

    await saveLazadaPollState(env, nextState);

    return {
        seller_id: credential.seller_id,
        started_at: startedAt,
        completed_at: completedAt,
        window_start: new Date(queryStart).toISOString(),
        window_end: new Date(queryEnd).toISOString(),
        cursor_before: new Date(cursorBefore).toISOString(),
        cursor_after: new Date(cursorAfter).toISOString(),
        pages_fetched: pagesFetched,
        page_cap_reached: pageCapReached,
        pending_retry_order_ids: nextState.pending_retry_order_ids,
        counts,
        error: nextState.last_error,
    };
}

export async function runLazadaPolling(input: {
    env: Env;
    trigger: "cron" | "admin";
    runAtMs?: number;
    sellerId?: string;
    shortCode?: string;
    lookbackMinutes?: number;
    resetCursor?: boolean;
}): Promise<LazadaPollReport> {
    const startedAt = Date.now();
    const runAtMs = input.runAtMs ?? startedAt;
    const enabled =
        input.env.LAZADA_POLL_ENABLED?.trim().toLowerCase() !== "false";

    if (!enabled) {
        return {
            ok: true,
            trigger: input.trigger,
            started_at: startedAt,
            completed_at: Date.now(),
            sellers: [],
        };
    }

    let credentials: LazadaSellerCredential[];

    if (input.sellerId || input.shortCode) {
        const credential = await resolveLazadaCredential(input.env, {
            sellerId: input.sellerId,
            shortCode: input.shortCode,
        });
        credentials = credential ? [credential] : [];
    } else {
        credentials = await listLazadaCredentials(input.env);
    }

    const sellers: LazadaSellerPollReport[] = [];

    for (const credential of credentials) {
        sellers.push(
            await pollSeller({
                env: input.env,
                credential,
                runAtMs,
                lookbackMinutes: input.lookbackMinutes,
                resetCursor: input.resetCursor,
            })
        );
    }

    const report: LazadaPollReport = {
        ok: sellers.every((seller) => !seller.error),
        trigger: input.trigger,
        started_at: startedAt,
        completed_at: Date.now(),
        sellers,
    };

    console.log("LAZADA_POLL_COMPLETED", report);
    return report;
}
