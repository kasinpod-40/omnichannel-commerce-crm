import type {
    MarketplaceOrderInput,
    MarketplaceOrderItem,
} from "./marketplace.types";

function text(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function positiveNumber(
    value: unknown,
    fallback = 0
): number {
    const parsed =
        typeof value === "number"
            ? value
            : typeof value === "string"
              ? Number(value)
              : Number.NaN;

    return Number.isFinite(parsed) && parsed >= 0
        ? parsed
        : fallback;
}

function normalizeTimestamp(
    value: unknown
): number | string | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    const normalized = text(value);
    return normalized || undefined;
}

function normalizeItem(value: unknown): MarketplaceOrderItem | null {
    if (!value || typeof value !== "object") {
        return null;
    }

    const item = value as Record<string, unknown>;
    const name = text(item.name);

    if (!name) {
        return null;
    }

    return {
        sku: text(item.sku) || undefined,
        name,
        variant: text(item.variant) || undefined,
        quantity: Math.max(
            1,
            Math.floor(positiveNumber(item.quantity, 1))
        ),
        unit_price:
            item.unit_price === undefined
                ? undefined
                : positiveNumber(item.unit_price, 0),
    };
}

export function parseMarketplaceOrderInput(
    body: unknown
): MarketplaceOrderInput {
    if (!body || typeof body !== "object") {
        throw new Error("MARKETPLACE_INVALID_BODY");
    }

    const record = body as Record<string, unknown>;
    const buyerRecord =
        record.buyer && typeof record.buyer === "object"
            ? (record.buyer as Record<string, unknown>)
            : {};
    const channel = text(record.channel);

    if (
        channel !== "Shopee" &&
        channel !== "Lazada" &&
        channel !== "TikTok"
    ) {
        throw new Error("MARKETPLACE_INVALID_CHANNEL");
    }

    const eventId = text(record.event_id);
    const storeId = text(record.store_id);
    const externalOrderId = text(
        record.external_order_id
    );
    const buyerId = text(buyerRecord.id);
    const marketplaceStatus = text(
        record.marketplace_status
    );
    const items = Array.isArray(record.items)
        ? record.items
              .map(normalizeItem)
              .filter(
                  (item): item is MarketplaceOrderItem =>
                      item !== null
              )
        : [];

    const missing = [
        ["event_id", eventId],
        ["store_id", storeId],
        ["external_order_id", externalOrderId],
        ["buyer.id", buyerId],
        ["marketplace_status", marketplaceStatus],
    ].filter(([, value]) => !value);

    if (missing.length > 0) {
        throw new Error(
            `MARKETPLACE_MISSING_FIELDS:${missing
                .map(([name]) => name)
                .join(",")}`
        );
    }

    if (items.length === 0) {
        throw new Error("MARKETPLACE_ITEMS_REQUIRED");
    }

    return {
        channel,
        event_id: eventId,
        store_id: storeId,
        store_name: text(record.store_name) || undefined,
        external_order_id: externalOrderId,
        buyer: {
            id: buyerId,
            name: text(buyerRecord.name) || undefined,
            phone: text(buyerRecord.phone) || undefined,
            address: text(buyerRecord.address) || undefined,
        },
        items,
        currency: text(record.currency) || "THB",
        total_amount: positiveNumber(record.total_amount, 0),
        marketplace_status: marketplaceStatus,
        marketplace_payment_status:
            text(record.marketplace_payment_status) ||
            undefined,
        tracking_number:
            text(record.tracking_number) || undefined,
        shipping_provider:
            text(record.shipping_provider) || undefined,
        created_at: normalizeTimestamp(record.created_at),
        updated_at: normalizeTimestamp(record.updated_at),
        paid_at: normalizeTimestamp(record.paid_at),
    };
}
