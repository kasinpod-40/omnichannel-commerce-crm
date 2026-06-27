import type { Env } from "../../config/env";
import type { MarketplacePlatformResponse } from "./marketplace-dashboard-status.service";

export type MarketplaceDashboardEvent = {
    id: string;
    platform: MarketplacePlatformResponse;
    event_type: "order_webhook" | "order_sync" | "oauth_refresh";
    result: "success" | "failed";
    detail: string;
    occurred_at: string;
};

const EVENT_PREFIX = "marketplace:dashboard-event:";
const PLATFORM_PREFIX = "marketplace:dashboard-event-platform:";
const MAX_TIMESTAMP = 9_999_999_999_999;
const KV_LIST_LIMIT = 1_000;

function platformSlug(platform: MarketplacePlatformResponse): string {
    return platform === "TikTok Shop" ? "tiktok-shop" : platform.toLowerCase();
}

/**
 * KV เรียง Key จากน้อยไปมาก จึงกลับ Timestamp เพื่อให้เหตุการณ์ใหม่อยู่ก่อน
 * และต่อท้ายด้วย Event ID เพื่อให้ลำดับคงที่เมื่อเวลาเท่ากัน
 */
function reverseTimestamp(occurredAt: string): string {
    const parsed = Date.parse(occurredAt);
    const timestamp = Number.isFinite(parsed) ? parsed : Date.now();
    return String(MAX_TIMESTAMP - Math.min(Math.max(timestamp, 0), MAX_TIMESTAMP)).padStart(13, "0");
}

function safeId(value: string): string {
    return value.replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 300);
}

function eventKey(event: MarketplaceDashboardEvent): string {
    return `${EVENT_PREFIX}${reverseTimestamp(event.occurred_at)}:${safeId(event.id)}`;
}

function platformEventKey(event: MarketplaceDashboardEvent): string {
    return `${PLATFORM_PREFIX}${platformSlug(event.platform)}:${reverseTimestamp(event.occurred_at)}:${safeId(event.id)}`;
}

/**
 * เก็บเหตุการณ์จริงทุกครั้งที่ Marketplace upsert/OAuth สำเร็จหรือล้มเหลว
 * Key เป็น deterministic จึงรองรับ webhook retry โดยไม่สร้างรายการซ้ำ
 *
 * ไม่ใช้ Counter แยก เพราะ Cloudflare KV ไม่มี atomic increment และอาจทำให้ Total
 * คลาดเคลื่อนเมื่อหลาย webhook เข้าพร้อมกัน การนับจาก Key index ตอนอ่านจึงถูกต้องกว่า
 */
export async function recordMarketplaceDashboardEvent(
    env: Env,
    event: MarketplaceDashboardEvent
): Promise<void> {
    const store = env.MARKETPLACE_TOKENS;
    if (!store) return;

    const payload = JSON.stringify(event);
    await Promise.all([
        store.put(eventKey(event), payload),
        store.put(platformEventKey(event), payload),
    ]);
}

export type MarketplaceEventPage = {
    items: MarketplaceDashboardEvent[];
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
};

/**
 * อ่านเฉพาะ Value ของหน้าที่ต้องการ ส่วน Total นับจาก Key metadata เท่านั้น
 * จึงไม่โหลด Event payload ทั้งหมดเข้าหน่วยความจำ และไม่พึ่ง Counter ที่ race ได้
 */
export async function listMarketplaceDashboardEvents(
    env: Env,
    query: { page: number; page_size: number; platform?: MarketplacePlatformResponse }
): Promise<MarketplaceEventPage | null> {
    const store = env.MARKETPLACE_TOKENS;
    if (!store) return null;

    const safePageSize = Math.max(1, Math.min(Math.floor(query.page_size), 100));
    const requestedPage = Math.max(1, Math.floor(query.page));
    const requestedStart = (requestedPage - 1) * safePageSize;
    const requestedEnd = requestedStart + safePageSize;
    const prefix = query.platform
        ? `${PLATFORM_PREFIX}${platformSlug(query.platform)}:`
        : EVENT_PREFIX;

    let cursor: string | undefined;
    let total = 0;
    const selectedKeyNames: string[] = [];

    do {
        const result = await store.list({ prefix, cursor, limit: KV_LIST_LIMIT });
        for (const key of result.keys) {
            if (total >= requestedStart && total < requestedEnd) {
                selectedKeyNames.push(key.name);
            }
            total += 1;
        }
        cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    const totalPages = Math.max(1, Math.ceil(total / safePageSize));
    const safePage = Math.min(requestedPage, totalPages);

    // เมื่อผู้ใช้ขอหน้าที่เกินหลังข้อมูลถูกลบ/ลดลง ให้โหลดหน้าสุดท้ายแทนอย่าง deterministic
    let keyNames = selectedKeyNames;
    if (total > 0 && safePage !== requestedPage) {
        const lastStart = (safePage - 1) * safePageSize;
        const lastEnd = lastStart + safePageSize;
        keyNames = [];
        let index = 0;
        cursor = undefined;
        do {
            const pageResult: { keys: Array<{ name: string }>; list_complete: boolean; cursor?: string } =
                await store.list({ prefix, cursor, limit: KV_LIST_LIMIT });
            for (const key of pageResult.keys) {
                if (index >= lastStart && index < lastEnd) keyNames.push(key.name);
                index += 1;
            }
            cursor = pageResult.list_complete ? undefined : pageResult.cursor;
        } while (cursor && index < lastEnd);
    }

    const values = await Promise.all(
        keyNames.map((key) => store.get<MarketplaceDashboardEvent>(key, "json"))
    );

    return {
        items: values.filter((value): value is MarketplaceDashboardEvent => Boolean(value)),
        page: safePage,
        page_size: safePageSize,
        total,
        total_pages: totalPages,
    };
}
