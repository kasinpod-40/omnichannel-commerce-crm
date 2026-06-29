export type DashboardPeriodMode = "day" | "month" | "year" | "range";
export type DashboardTrendGranularity = "hour" | "day" | "week" | "month";

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
const WEEK_MS = 7 * DAY_MS;
const MAX_CUSTOM_RANGE_DAYS = 366;

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

function parseDateValue(value: string): {
    year: number;
    month: number;
    day: number;
    normalized: string;
    start: number;
} | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 2000 || year > 2100 || !validDate(year, month, day)) return null;
    return {
        year,
        month,
        day,
        normalized: `${year}-${pad(month)}-${pad(day)}`,
        start: startBangkok(year, month, day),
    };
}

function formatDateValue(timestamp: number): string {
    const parts = bangkokParts(timestamp);
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function rangeGranularity(dayCount: number): DashboardTrendGranularity {
    if (dayCount <= 1) return "hour";
    if (dayCount <= 31) return "day";
    if (dayCount <= 180) return "week";
    return "month";
}

function parseRangeValue(rawValue: string, now: number): DashboardPeriod {
    const [rawStart = "", rawEnd = "", extra] = rawValue.split("..");
    if (extra !== undefined) throw new Error("INVALID_DASHBOARD_PERIOD");
    const startDate = parseDateValue(rawStart);
    const endDate = parseDateValue(rawEnd);
    if (!startDate || !endDate || startDate.start > endDate.start) {
        throw new Error("INVALID_DASHBOARD_PERIOD");
    }

    const today = bangkokParts(now);
    const todayStart = startBangkok(today.year, today.month, today.day);
    if (endDate.start > todayStart) throw new Error("INVALID_DASHBOARD_PERIOD");

    const endExclusive = endDate.start + DAY_MS;
    const duration = endExclusive - startDate.start;
    const dayCount = duration / DAY_MS;
    if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > MAX_CUSTOM_RANGE_DAYS) {
        throw new Error("INVALID_DASHBOARD_PERIOD");
    }

    return {
        mode: "range",
        value: `${startDate.normalized}..${endDate.normalized}`,
        start_at: startDate.start,
        end_at: endExclusive,
        previous_start_at: startDate.start - duration,
        previous_end_at: startDate.start,
        granularity: rangeGranularity(dayCount),
    };
}

export function defaultDashboardPeriod(
    mode: DashboardPeriodMode,
    now = Date.now()
): DashboardPeriod {
    const parts = bangkokParts(now);
    if (mode === "range") {
        const end = startBangkok(parts.year, parts.month, parts.day);
        const start = end - 6 * DAY_MS;
        return parseDashboardPeriod("range", `${formatDateValue(start)}..${formatDateValue(end)}`, now);
    }
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

    if (mode === "range") return parseRangeValue(rawValue, now);

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

export function parseDashboardPeriodInput(
    input: { mode?: unknown; value?: unknown },
    now = Date.now()
): DashboardPeriod {
    const rawMode = input.mode;
    const mode: DashboardPeriodMode =
        rawMode === undefined || rawMode === null || rawMode === ""
            ? "day"
            : rawMode === "day" || rawMode === "month" || rawMode === "year" || rawMode === "range"
              ? rawMode
              : (() => {
                    // ห้าม fallback โหมดที่ไม่รู้จักเป็นรายวัน เพราะจะทำให้ Dashboard แสดงตัวเลขคนละช่วงอย่างเงียบ ๆ
                    throw new Error("INVALID_DASHBOARD_PERIOD");
                })();
    const rawValue = typeof input.value === "string" ? input.value.trim() : "";
    return rawValue ? parseDashboardPeriod(mode, rawValue, now) : defaultDashboardPeriod(mode, now);
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

    if (period.granularity === "day" || period.granularity === "week") {
        const step = period.granularity === "week" ? WEEK_MS : DAY_MS;
        for (let cursor = start; cursor < end; cursor += step) {
            buckets.push({
                key: formatBangkokBucketKey(cursor, period.granularity),
                start_at: cursor,
                end_at: Math.min(cursor + step, end),
            });
        }
        return buckets;
    }

    let cursor = start;
    while (cursor < end) {
        const shifted = new Date(cursor + BANGKOK_OFFSET_MS);
        const year = shifted.getUTCFullYear();
        const month = shifted.getUTCMonth() + 1;
        const nextYear = month === 12 ? year + 1 : year;
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextMonthStart = startBangkok(nextYear, nextMonth, 1);
        buckets.push({
            key: formatBangkokBucketKey(cursor, "month"),
            start_at: cursor,
            end_at: Math.min(nextMonthStart, end),
        });
        cursor = Math.min(nextMonthStart, end);
    }
    return buckets;
}
