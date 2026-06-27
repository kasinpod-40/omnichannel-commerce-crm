import {
    CUSTOMER_FIELDS,
} from "../../core/lark-fields";
import {
    getFirstLinkedRecordId,
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import type {
    DashboardChannel,
    DashboardCustomerSnapshot,
    DashboardLarkRecord,
} from "./dashboard-read.types";

const CUSTOMER_STAGES = new Set<DashboardCustomerSnapshot["current_stage"]>([
    "New Lead",
    "Interested",
    "Negotiating",
    "Closing",
    "Won",
    "Lost",
]);

export function nullableText(value: unknown): string | null {
    const text = getLarkText(value, "").trim();
    return text || null;
}

export function readTimestamp(value: unknown, fallback = 0): number {
    const numeric = getLarkNumber(value, Number.NaN);
    if (Number.isFinite(numeric)) {
        return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }

    const parsed = Date.parse(getLarkText(value, ""));
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function toIso(value: number, fallback = Date.now()): string {
    const timestamp = Number.isFinite(value) && value > 0 ? value : fallback;
    return new Date(timestamp).toISOString();
}

export function normalizeChannel(value: unknown): DashboardChannel {
    const normalized = getLarkText(value, "LINE").trim().toLowerCase();

    if (normalized.includes("shopee")) return "Shopee";
    if (normalized.includes("lazada")) return "Lazada";
    if (normalized.includes("tiktok")) return "TikTok Shop";
    return "LINE";
}

export function normalizeCustomerStage(
    value: unknown
): DashboardCustomerSnapshot["current_stage"] {
    const stage = getLarkText(value, "New Lead").trim() as DashboardCustomerSnapshot["current_stage"];
    return CUSTOMER_STAGES.has(stage) ? stage : "New Lead";
}

export function extractLarkUrl(value: unknown): string | null {
    if (typeof value === "string") {
        const text = value.trim();
        return /^https?:\/\//i.test(text) ? text : null;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const url = extractLarkUrl(item);
            if (url) return url;
        }
        return null;
    }

    if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        for (const key of ["link", "url", "href", "value"]) {
            const url = extractLarkUrl(record[key]);
            if (url) return url;
        }
    }

    return null;
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }

    const text = getLarkText(value, "").trim();
    if (!text) return {};

    try {
        const parsed = JSON.parse(text) as unknown;
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

export function getLinkedRecordId(value: unknown): string | null {
    return getFirstLinkedRecordId(value);
}

export function buildCustomerSnapshot(
    record: DashboardLarkRecord
): DashboardCustomerSnapshot {
    const fields = record.fields;
    const createdAt = readTimestamp(fields[CUSTOMER_FIELDS.CREATED_AT]);
    const updatedAt = readTimestamp(fields[CUSTOMER_FIELDS.UPDATED_AT], createdAt);

    return {
        customer_id: record.record_id,
        customer_name: getLarkText(fields[CUSTOMER_FIELDS.CUSTOMER_NAME], "").trim(),
        channel: normalizeChannel(fields[CUSTOMER_FIELDS.CHANNEL]),
        phone: nullableText(fields[CUSTOMER_FIELDS.PHONE]),
        current_stage: normalizeCustomerStage(fields[CUSTOMER_FIELDS.CURRENT_STAGE]),
        lead_score: Math.min(100, Math.max(0, getLarkNumber(fields[CUSTOMER_FIELDS.LEAD_SCORE], 0))),
        hot_lead: getLarkBoolean(fields[CUSTOMER_FIELDS.HOT_LEAD], false),
        ai_summary: nullableText(fields[CUSTOMER_FIELDS.AI_SUMMARY]),
        last_message: nullableText(fields[CUSTOMER_FIELDS.LAST_MESSAGE]),
        message_count: Math.max(0, Math.floor(getLarkNumber(fields[CUSTOMER_FIELDS.MESSAGE_COUNT], 0))),
        sales_owner: nullableText(fields[CUSTOMER_FIELDS.SALES_OWNER]),
        active_pipeline_id: nullableText(fields[CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]),
        active_order_id: nullableText(fields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID]),
        created_at_ms: createdAt,
        updated_at_ms: updatedAt,
    };
}

export function buildCustomerLookup(
    records: DashboardLarkRecord[]
): Map<string, DashboardCustomerSnapshot> {
    return new Map(records.map((record) => {
        const customer = buildCustomerSnapshot(record);
        return [customer.customer_id, customer] as const;
    }));
}

export function unknownCustomer(
    customerId: string | null,
    channel: DashboardChannel = "LINE"
): DashboardCustomerSnapshot {
    return {
        customer_id: customerId ?? "unknown",
        customer_name: "",
        channel,
        phone: null,
        current_stage: "New Lead",
        lead_score: 0,
        hot_lead: false,
        ai_summary: null,
        last_message: null,
        message_count: 0,
        sales_owner: null,
        active_pipeline_id: null,
        active_order_id: null,
        created_at_ms: 0,
        updated_at_ms: 0,
    };
}
