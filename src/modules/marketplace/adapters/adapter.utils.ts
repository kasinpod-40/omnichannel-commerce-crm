import { cleanDeliveryAddress } from "../../../utils/address";
import { normalizePhoneNumber } from "../../../utils/phone";
import type { MarketplaceOrderItem } from "../marketplace.types";

export type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as UnknownRecord)
        : {};
}

export function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function firstRecord(...values: unknown[]): UnknownRecord {
    for (const value of values) {
        if (Array.isArray(value)) {
            const record = asRecord(value[0]);

            if (Object.keys(record).length > 0) {
                return record;
            }
        }

        const record = asRecord(value);

        if (Object.keys(record).length > 0) {
            return record;
        }
    }

    return {};
}

export function text(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }

    if (typeof value === "number" || typeof value === "bigint") {
        return String(value);
    }

    return "";
}

export function numberValue(value: unknown, fallback = 0): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    const normalized = text(value).replace(/,/g, "");
    const parsed = normalized ? Number(normalized) : Number.NaN;

    return Number.isFinite(parsed) ? parsed : fallback;
}

export function positiveInteger(value: unknown, fallback = 1): number {
    const parsed = Math.floor(numberValue(value, fallback));
    return parsed > 0 ? parsed : fallback;
}

export function firstText(...values: unknown[]): string {
    for (const value of values) {
        const normalized = text(value);

        if (normalized) {
            return normalized;
        }
    }

    return "";
}

export function firstNumber(...values: unknown[]): number {
    for (const value of values) {
        const parsed = numberValue(value, Number.NaN);

        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return 0;
}

export function normalizeTimestampValue(
    value: unknown
): number | string | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    const normalized = text(value);
    return normalized || undefined;
}

export function joinAddressParts(...values: unknown[]): string {
    const parts: string[] = [];

    for (const value of values) {
        if (Array.isArray(value)) {
            for (const nested of value) {
                const normalized = text(nested);

                if (normalized && !parts.includes(normalized)) {
                    parts.push(normalized);
                }
            }
            continue;
        }

        const normalized = text(value);

        if (normalized && !parts.includes(normalized)) {
            parts.push(normalized);
        }
    }

    return cleanDeliveryAddress(parts.join(" "));
}

export function normalizeThaiPhone(value: unknown): string | undefined {
    const normalized = text(value);
    return normalizePhoneNumber(normalized) ?? (normalized || undefined);
}

export function ensureItems(items: MarketplaceOrderItem[]): MarketplaceOrderItem[] {
    const valid = items.filter(
        (item) => item.name.trim() && item.quantity > 0
    );

    if (valid.length === 0) {
        throw new Error("MARKETPLACE_ITEMS_REQUIRED");
    }

    return valid;
}

export function deriveBuyerId(
    explicitBuyerId: unknown,
    phone: unknown,
    email: unknown,
    fallbackOrderId: string
): string {
    return firstText(explicitBuyerId, phone, email, fallbackOrderId);
}

export function stableEventId(parts: unknown[]): string {
    return parts
        .map(text)
        .filter(Boolean)
        .join(":")
        .slice(0, 500);
}

export function required(value: string, code: string): string {
    if (!value) {
        throw new Error(code);
    }

    return value;
}
