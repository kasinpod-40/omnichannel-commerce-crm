export type DashboardPeriodMode = "day" | "month" | "year";
export type DashboardTrendGranularity = "hour" | "day" | "month";

export type DashboardPeriod = {
    mode: DashboardPeriodMode;
    value: string;
    start_at: number;
    end_at: number;
    previous_start_at: number;
    previous_end_at: number;
    granularity: DashboardTrendGranularity;
};

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

function bangkokParts(now: number): { year: number; month: number; day: number } {
    const shifted = new Date(now + BANGKOK_OFFSET_MS);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
    };
}

function startBangkok(year: number, month: number, day: number): number {
    return Date.UTC(year, month - 1, day) - BANGKOK_OFFSET_MS;
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function validDate(year: number, month: number, day: number): boolean {
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

export function defaultDashboardPeriod(
    mode: DashboardPeriodMode,
    now = Date.now()
): DashboardPeriod {
    const parts = bangkokParts(now);
    const value = mode === "day"
        ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
        : mode === "month"
          ? `${parts.year}-${pad(parts.month)}`
          : String(parts.year);
    return parseDashboardPeriod(mode, value, now);
}

export function parseDashboardPeriod(
    mode: DashboardPeriodMode,
    rawValue: string,
    now = Date.now()
): DashboardPeriod {
    const fallback = bangkokParts(now);

    if (mode === "day") {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(rawValue);
        const year = match ? Number(match[1]) : fallback.year;
        const month = match ? Number(match[2]) : fallback.month;
        const day = match ? Number(match[3]) : fallback.day;
        if (!validDate(year, month, day)) {
            throw new Error("INVALID_DASHBOARD_PERIOD");
        }
        const start = startBangkok(year, month, day);
        return {
            mode,
            value: `${year}-${pad(month)}-${pad(day)}`,
            start_at: start,
            end_at: start + DAY_MS,
            previous_start_at: start - DAY_MS,
            previous_end_at: start,
            granularity: "hour",
        };
    }

    if (mode === "month") {
        const match = /^(\d{4})-(\d{2})$/.exec(rawValue);
        const year = match ? Number(match[1]) : fallback.year;
        const month = match ? Number(match[2]) : fallback.month;
        if (month < 1 || month > 12 || year < 2000 || year > 2100) {
            throw new Error("INVALID_DASHBOARD_PERIOD");
        }
        const start = startBangkok(year, month, 1);
        const nextYear = month === 12 ? year + 1 : year;
        const nextMonth = month === 12 ? 1 : month + 1;
        const previousYear = month === 1 ? year - 1 : year;
        const previousMonth = month === 1 ? 12 : month - 1;
        const previousStart = startBangkok(previousYear, previousMonth, 1);
        return {
            mode,
            value: `${year}-${pad(month)}`,
            start_at: start,
            end_at: startBangkok(nextYear, nextMonth, 1),
            previous_start_at: previousStart,
            previous_end_at: start,
            granularity: "day",
        };
    }

    const parsedYear = /^\d{4}$/.test(rawValue) ? Number(rawValue) : fallback.year;
    if (parsedYear < 2000 || parsedYear > 2100) {
        throw new Error("INVALID_DASHBOARD_PERIOD");
    }
    return {
        mode,
        value: String(parsedYear),
        start_at: startBangkok(parsedYear, 1, 1),
        end_at: startBangkok(parsedYear + 1, 1, 1),
        previous_start_at: startBangkok(parsedYear - 1, 1, 1),
        previous_end_at: startBangkok(parsedYear, 1, 1),
        granularity: "month",
    };
}

export function isInPeriod(timestamp: number, start: number, end: number): boolean {
    return timestamp >= start && timestamp < end;
}

export function formatBangkokBucketKey(
    timestamp: number,
    granularity: DashboardTrendGranularity
): string {
    const date = new Date(timestamp + BANGKOK_OFFSET_MS);
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    if (granularity === "hour") return `${pad(date.getUTCHours())}:00`;
    if (granularity === "month") return `${year}-${month}`;
    return `${year}-${month}-${day}`;
}

export function buildPeriodBuckets(period: DashboardPeriod, previous = false): Array<{
    key: string;
    start_at: number;
    end_at: number;
}> {
    const start = previous ? period.previous_start_at : period.start_at;
    const end = previous ? period.previous_end_at : period.end_at;
    const buckets: Array<{ key: string; start_at: number; end_at: number }> = [];

    if (period.granularity === "hour") {
        const hour = 60 * 60 * 1_000;
        for (let cursor = start; cursor < end; cursor += hour) {
            buckets.push({
                key: formatBangkokBucketKey(cursor, "hour"),
                start_at: cursor,
                end_at: Math.min(cursor + hour, end),
            });
        }
        return buckets;
    }

    if (period.granularity === "day") {
        for (let cursor = start; cursor < end; cursor += DAY_MS) {
            buckets.push({
                key: formatBangkokBucketKey(cursor, "day"),
                start_at: cursor,
                end_at: Math.min(cursor + DAY_MS, end),
            });
        }
        return buckets;
    }

    const shifted = new Date(start + BANGKOK_OFFSET_MS);
    let year = shifted.getUTCFullYear();
    let month = shifted.getUTCMonth() + 1;
    while (true) {
        const bucketStart = startBangkok(year, month, 1);
        if (bucketStart >= end) break;
        const nextYear = month === 12 ? year + 1 : year;
        const nextMonth = month === 12 ? 1 : month + 1;
        const bucketEnd = startBangkok(nextYear, nextMonth, 1);
        buckets.push({
            key: formatBangkokBucketKey(bucketStart, "month"),
            start_at: bucketStart,
            end_at: Math.min(bucketEnd, end),
        });
        year = nextYear;
        month = nextMonth;
    }
    return buckets;
}
