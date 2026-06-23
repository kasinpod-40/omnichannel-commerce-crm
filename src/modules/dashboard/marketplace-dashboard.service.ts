import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import {
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { listOrders } from "../orders/order.repository";
import type { MarketplaceChannel } from "../marketplace/marketplace.types";

const MARKETPLACE_CHANNELS = new Set<MarketplaceChannel>([
    "Shopee",
    "Lazada",
    "TikTok",
]);

const ACTIVE_ORDER_STATUSES = new Set([
    "Waiting Payment",
    "Payment Review",
    "Waiting Address",
    "Processing",
    "Ready to Ship",
    "Shipped",
]);

export type MarketplaceDashboardFilters = {
    channel?: MarketplaceChannel;
    store_id?: string;
    date_from_ms?: number;
    date_to_ms?: number;
};

export type MarketplaceDashboardRow = {
    key: string;
    orders: number;
    active: number;
    completed: number;
    cancelled: number;
    returned: number;
    paid: number;
    waiting_payment: number;
    gross_order_value: number;
    paid_revenue: number;
    completed_revenue: number;
    average_order_value: number;
    completion_rate_pct: number;
    cancellation_rate_pct: number;
};

export type MarketplaceDashboardSummary = {
    generated_at: number;
    filters: {
        channel: MarketplaceChannel | "All";
        store_id: string | null;
        date_from: number | null;
        date_to: number | null;
    };
    totals: MarketplaceDashboardRow & {
        stores: number;
        latest_marketplace_update_at: number | null;
    };
    by_channel: MarketplaceDashboardRow[];
    by_store: Array<MarketplaceDashboardRow & {
        channel: MarketplaceChannel;
        store_id: string;
        store_name: string;
    }>;
    by_order_status: Record<string, number>;
    by_payment_status: Record<string, number>;
    by_marketplace_status: Record<string, number>;
};

type MutableRow = Omit<MarketplaceDashboardRow, "average_order_value" | "completion_rate_pct" | "cancellation_rate_pct">;

type MarketplaceOrderSnapshot = {
    channel: MarketplaceChannel;
    store_id: string;
    store_name: string;
    order_status: string;
    payment_status: string;
    marketplace_status: string;
    total_amount: number;
    created_at: number;
    marketplace_updated_at: number;
};

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function increment(target: Record<string, number>, key: string): void {
    const normalized = key.trim() || "Unknown";
    target[normalized] = (target[normalized] ?? 0) + 1;
}

function emptyRow(key: string): MutableRow {
    return {
        key,
        orders: 0,
        active: 0,
        completed: 0,
        cancelled: 0,
        returned: 0,
        paid: 0,
        waiting_payment: 0,
        gross_order_value: 0,
        paid_revenue: 0,
        completed_revenue: 0,
    };
}

function ensureRow(
    map: Map<string, MutableRow>,
    key: string
): MutableRow {
    const existing = map.get(key);

    if (existing) {
        return existing;
    }

    const row = emptyRow(key);
    map.set(key, row);
    return row;
}

function finalizeRow(row: MutableRow): MarketplaceDashboardRow {
    const nonCancelledOrders = Math.max(
        0,
        row.orders - row.cancelled - row.returned
    );
    const terminalOrders = row.completed + row.cancelled + row.returned;

    return {
        ...row,
        gross_order_value: round2(row.gross_order_value),
        paid_revenue: round2(row.paid_revenue),
        completed_revenue: round2(row.completed_revenue),
        average_order_value:
            nonCancelledOrders > 0
                ? round2(row.gross_order_value / nonCancelledOrders)
                : 0,
        completion_rate_pct:
            terminalOrders > 0
                ? round2((row.completed / terminalOrders) * 100)
                : 0,
        cancellation_rate_pct:
            terminalOrders > 0
                ? round2(
                      ((row.cancelled + row.returned) /
                          terminalOrders) *
                          100
                  )
                : 0,
    };
}

function applyOrder(row: MutableRow, order: MarketplaceOrderSnapshot): void {
    row.orders += 1;

    if (ACTIVE_ORDER_STATUSES.has(order.order_status)) {
        row.active += 1;
    }

    if (order.order_status === "Completed") {
        row.completed += 1;
        row.completed_revenue += order.total_amount;
    } else if (order.order_status === "Cancelled") {
        row.cancelled += 1;
    } else if (order.order_status === "Returned") {
        row.returned += 1;
    }

    if (
        order.order_status !== "Cancelled" &&
        order.order_status !== "Returned"
    ) {
        row.gross_order_value += order.total_amount;
    }

    if (
        order.payment_status === "Paid" &&
        order.order_status !== "Cancelled" &&
        order.order_status !== "Returned"
    ) {
        row.paid += 1;
        row.paid_revenue += order.total_amount;
    }

    if (order.payment_status === "Waiting Payment") {
        row.waiting_payment += 1;
    }
}

function toMarketplaceOrderSnapshot(
    fields: Record<string, unknown>
): MarketplaceOrderSnapshot | null {
    const channel = getLarkText(fields[ORDER_FIELDS.CHANNEL], "") as MarketplaceChannel;

    if (!MARKETPLACE_CHANNELS.has(channel)) {
        return null;
    }

    return {
        channel,
        store_id: getLarkText(
            fields[ORDER_FIELDS.MARKETPLACE_STORE_ID],
            "Unknown"
        ).trim() || "Unknown",
        store_name: getLarkText(
            fields[ORDER_FIELDS.MARKETPLACE_STORE_NAME],
            ""
        ).trim(),
        order_status: getLarkText(
            fields[ORDER_FIELDS.ORDER_STATUS],
            "Unknown"
        ).trim() || "Unknown",
        payment_status: getLarkText(
            fields[ORDER_FIELDS.PAYMENT_STATUS],
            "Unknown"
        ).trim() || "Unknown",
        marketplace_status: getLarkText(
            fields[ORDER_FIELDS.MARKETPLACE_STATUS],
            "Unknown"
        ).trim() || "Unknown",
        total_amount: Math.max(
            0,
            getLarkNumber(fields[ORDER_FIELDS.TOTAL_AMOUNT], 0)
        ),
        created_at: getLarkNumber(
            fields[ORDER_FIELDS.CREATED_AT],
            0
        ),
        marketplace_updated_at: getLarkNumber(
            fields[ORDER_FIELDS.MARKETPLACE_UPDATED_AT],
            getLarkNumber(fields[ORDER_FIELDS.UPDATED_AT], 0)
        ),
    };
}

function matchesFilters(
    order: MarketplaceOrderSnapshot,
    filters: MarketplaceDashboardFilters
): boolean {
    if (filters.channel && order.channel !== filters.channel) {
        return false;
    }

    if (filters.store_id && order.store_id !== filters.store_id) {
        return false;
    }

    if (
        filters.date_from_ms !== undefined &&
        order.created_at < filters.date_from_ms
    ) {
        return false;
    }

    if (
        filters.date_to_ms !== undefined &&
        order.created_at > filters.date_to_ms
    ) {
        return false;
    }

    return true;
}

export async function buildMarketplaceDashboardSummary(
    env: Env,
    filters: MarketplaceDashboardFilters = {}
): Promise<MarketplaceDashboardSummary> {
    const records = await listOrders(env);
    const orders = records
        .map((record) => toMarketplaceOrderSnapshot(record.fields))
        .filter((order): order is MarketplaceOrderSnapshot => order !== null)
        .filter((order) => matchesFilters(order, filters));

    const totals = emptyRow("All");
    const byChannel = new Map<string, MutableRow>();
    const byStore = new Map<string, MutableRow>();
    const storeMetadata = new Map<
        string,
        { channel: MarketplaceChannel; store_id: string; store_name: string }
    >();
    const orderStatuses: Record<string, number> = {};
    const paymentStatuses: Record<string, number> = {};
    const marketplaceStatuses: Record<string, number> = {};
    let latestMarketplaceUpdateAt = 0;

    for (const order of orders) {
        applyOrder(totals, order);
        applyOrder(ensureRow(byChannel, order.channel), order);

        const storeKey = `${order.channel}:${order.store_id}`;
        applyOrder(ensureRow(byStore, storeKey), order);
        storeMetadata.set(storeKey, {
            channel: order.channel,
            store_id: order.store_id,
            store_name:
                order.store_name || `${order.channel} ${order.store_id}`,
        });

        increment(orderStatuses, order.order_status);
        increment(paymentStatuses, order.payment_status);
        increment(marketplaceStatuses, order.marketplace_status);
        latestMarketplaceUpdateAt = Math.max(
            latestMarketplaceUpdateAt,
            order.marketplace_updated_at
        );
    }

    const channelRows = [...MARKETPLACE_CHANNELS]
        .map((channel) => finalizeRow(byChannel.get(channel) ?? emptyRow(channel)))
        .sort((left, right) => right.orders - left.orders || left.key.localeCompare(right.key));

    const storeRows = [...byStore.entries()]
        .map(([storeKey, row]) => ({
            ...finalizeRow(row),
            ...(storeMetadata.get(storeKey) as {
                channel: MarketplaceChannel;
                store_id: string;
                store_name: string;
            }),
        }))
        .sort((left, right) =>
            right.paid_revenue - left.paid_revenue ||
            right.orders - left.orders ||
            left.store_name.localeCompare(right.store_name)
        );

    return {
        generated_at: Date.now(),
        filters: {
            channel: filters.channel ?? "All",
            store_id: filters.store_id ?? null,
            date_from: filters.date_from_ms ?? null,
            date_to: filters.date_to_ms ?? null,
        },
        totals: {
            ...finalizeRow(totals),
            stores: storeRows.length,
            latest_marketplace_update_at:
                latestMarketplaceUpdateAt > 0
                    ? latestMarketplaceUpdateAt
                    : null,
        },
        by_channel: channelRows,
        by_store: storeRows,
        by_order_status: orderStatuses,
        by_payment_status: paymentStatuses,
        by_marketplace_status: marketplaceStatuses,
    };
}
