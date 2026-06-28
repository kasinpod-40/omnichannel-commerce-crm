/** Normalize CRM lead scores at every read/write boundary. */

export function normalizeLeadScore(value: unknown, fallback = 0): number {
    const parsed = Number(value);
    const fallbackValue = Number.isFinite(fallback) ? fallback : 0;
    const score = Number.isFinite(parsed) ? parsed : fallbackValue;

    return Math.min(100, Math.max(0, Math.round(score)));
}
