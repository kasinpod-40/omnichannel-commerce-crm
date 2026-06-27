import { describe, expect, it } from "vitest";
import {
    listMarketplaceDashboardEvents,
    recordMarketplaceDashboardEvent,
    type MarketplaceDashboardEvent,
} from "./marketplace-event-log";

function createMemoryKv(): KVNamespace {
    const values = new Map<string, string>();

    return {
        async get(key: string, typeOrOptions?: unknown) {
            const value = values.get(key) ?? null;
            if (value === null) return null;
            if (typeOrOptions === "json") return JSON.parse(value);
            return value;
        },
        async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) {
            if (typeof value !== "string") throw new Error("Test KV accepts string values only");
            values.set(key, value);
        },
        async delete(key: string) {
            values.delete(key);
        },
        async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
            const prefix = options?.prefix ?? "";
            const limit = Math.max(1, options?.limit ?? 1_000);
            const offset = options?.cursor ? Number(options.cursor) : 0;
            const names = [...values.keys()].filter((key) => key.startsWith(prefix)).sort();
            const page = names.slice(offset, offset + limit);
            const nextOffset = offset + page.length;
            const listComplete = nextOffset >= names.length;
            return {
                keys: page.map((name) => ({ name })),
                list_complete: listComplete,
                cursor: listComplete ? "" : String(nextOffset),
                cacheStatus: null,
            };
        },
        getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
    } as unknown as KVNamespace;
}

function event(
    id: string,
    occurredAt: string,
    platform: MarketplaceDashboardEvent["platform"] = "Lazada"
): MarketplaceDashboardEvent {
    return {
        id,
        platform,
        event_type: "order_sync",
        result: "success",
        detail: id,
        occurred_at: occurredAt,
    };
}

describe("marketplace event log", () => {
    it("แบ่งหน้าตามลำดับล่าสุดและใช้ id เป็นตัวผูกลำดับเมื่อเวลาเท่ากัน", async () => {
        const env = { MARKETPLACE_TOKENS: createMemoryKv() } as any;
        await recordMarketplaceDashboardEvent(env, event("event-b", "2026-06-26T12:00:00.000Z"));
        await recordMarketplaceDashboardEvent(env, event("event-a", "2026-06-26T12:00:00.000Z"));
        await recordMarketplaceDashboardEvent(env, event("event-new", "2026-06-26T13:00:00.000Z", "Shopee"));

        const first = await listMarketplaceDashboardEvents(env, { page: 1, page_size: 2 });
        const second = await listMarketplaceDashboardEvents(env, { page: 2, page_size: 2 });

        expect(first).toMatchObject({ page: 1, page_size: 2, total: 3, total_pages: 2 });
        expect(first?.items.map((item) => item.id)).toEqual(["event-new", "event-a"]);
        expect(second?.items.map((item) => item.id)).toEqual(["event-b"]);
    });

    it("เขียนทับ webhook retry เดิมโดยไม่เพิ่ม total ซ้ำ", async () => {
        const env = { MARKETPLACE_TOKENS: createMemoryKv() } as any;
        const original = event("same-event", "2026-06-26T12:00:00.000Z");
        await recordMarketplaceDashboardEvent(env, original);
        await recordMarketplaceDashboardEvent(env, { ...original, detail: "updated" });

        const result = await listMarketplaceDashboardEvents(env, { page: 1, page_size: 10 });
        expect(result?.total).toBe(1);
        expect(result?.items).toHaveLength(1);
        expect(result?.items[0]?.detail).toBe("updated");
    });

    it("กรองตาม platform และ clamp หน้าที่เกินไปยังหน้าสุดท้าย", async () => {
        const env = { MARKETPLACE_TOKENS: createMemoryKv() } as any;
        await recordMarketplaceDashboardEvent(env, event("lazada-1", "2026-06-26T12:00:00.000Z"));
        await recordMarketplaceDashboardEvent(env, event("lazada-2", "2026-06-26T11:00:00.000Z"));
        await recordMarketplaceDashboardEvent(env, event("shopee-1", "2026-06-26T10:00:00.000Z", "Shopee"));

        const result = await listMarketplaceDashboardEvents(env, {
            page: 99,
            page_size: 1,
            platform: "Lazada",
        });

        expect(result).toMatchObject({ page: 2, total: 2, total_pages: 2 });
        expect(result?.items.map((item) => item.id)).toEqual(["lazada-2"]);
    });
});
