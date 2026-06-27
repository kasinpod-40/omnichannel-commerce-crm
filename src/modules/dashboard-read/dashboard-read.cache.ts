/**
 * Cache กลางของ Read API สำหรับ Dashboard
 *
 * Cloudflare Worker isolate สามารถอยู่ต่อได้หลาย Request จึงเก็บผลอ่าน Lark
 * ช่วงสั้น ๆ เพื่อลดเวลาและจำนวน API calls โดยไม่ทำให้ข้อมูลค้างนานเกินไป
 */

type CacheEntry<T> = {
    expires_at: number;
    value: T;
};

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function withDashboardReadCache<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>
): Promise<T> {
    const now = Date.now();
    const existing = cache.get(key) as CacheEntry<T> | undefined;

    if (existing && existing.expires_at > now) {
        return existing.value;
    }

    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const request = loader()
        .then((value) => {
            cache.set(key, {
                expires_at: Date.now() + ttlMs,
                value,
            });
            return value;
        })
        .finally(() => {
            inflight.delete(key);
        });

    inflight.set(key, request);
    return request;
}

/** ใช้ใน Test หรือหลังมีการเขียนข้อมูลที่ต้องการบังคับอ่านใหม่ทันที */
export function clearDashboardReadCache(prefix?: string): void {
    if (!prefix) {
        cache.clear();
        inflight.clear();
        return;
    }

    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
    }
    for (const key of inflight.keys()) {
        if (key.startsWith(prefix)) inflight.delete(key);
    }
}
