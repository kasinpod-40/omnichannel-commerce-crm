import { describe, expect, it } from "vitest";
import { buildPeriodBuckets, defaultDashboardPeriod, parseDashboardPeriod } from "./dashboard-period";

const NOW = Date.parse("2026-06-29T05:00:00.000Z");

describe("dashboard period", () => {
    it("builds 24 hourly buckets for a Bangkok day", () => {
        const period = parseDashboardPeriod("day", "2026-06-29", NOW);
        expect(buildPeriodBuckets(period)).toHaveLength(24);
        expect(buildPeriodBuckets(period)[0]?.key).toBe("00:00");
    });

    it("supports leap-year months and yearly months", () => {
        expect(buildPeriodBuckets(parseDashboardPeriod("month", "2024-02", NOW))).toHaveLength(29);
        expect(buildPeriodBuckets(parseDashboardPeriod("year", "2026", NOW))).toHaveLength(12);
    });

    it("uses hourly, daily, weekly and monthly buckets for custom ranges", () => {
        expect(parseDashboardPeriod("range", "2026-06-29..2026-06-29", NOW).granularity).toBe("hour");
        expect(parseDashboardPeriod("range", "2026-06-01..2026-06-29", NOW).granularity).toBe("day");
        expect(parseDashboardPeriod("range", "2026-01-01..2026-04-15", NOW).granularity).toBe("week");
        expect(parseDashboardPeriod("range", "2025-07-01..2026-06-29", NOW).granularity).toBe("month");
    });

    it("compares a custom range with the immediately preceding range of equal length", () => {
        const period = parseDashboardPeriod("range", "2026-06-10..2026-06-20", NOW);
        expect(period.value).toBe("2026-06-10..2026-06-20");
        expect(period.previous_end_at).toBe(period.start_at);
        expect(period.previous_end_at - period.previous_start_at).toBe(period.end_at - period.start_at);
        expect(buildPeriodBuckets(period)).toHaveLength(11);
        expect(buildPeriodBuckets(period, true)).toHaveLength(11);
    });

    it("clips month buckets to custom range boundaries", () => {
        const period = parseDashboardPeriod("range", "2025-12-15..2026-06-29", NOW);
        const buckets = buildPeriodBuckets(period);
        expect(buckets[0]?.start_at).toBe(period.start_at);
        expect(buckets.at(-1)?.end_at).toBe(period.end_at);
    });

    it("defaults a custom range to the latest seven Bangkok days", () => {
        expect(defaultDashboardPeriod("range", NOW).value).toBe("2026-06-23..2026-06-29");
    });

    it("rejects an unknown period mode instead of silently falling back to a day", async () => {
        const { parseDashboardPeriodInput } = await import("./dashboard-period");
        expect(() => parseDashboardPeriodInput({ mode: "unsupported", value: "2026-06-29" }, NOW))
            .toThrow("INVALID_DASHBOARD_PERIOD");
    });

    it("rejects future, reversed and over-one-year custom ranges", () => {
        expect(() => parseDashboardPeriod("range", "2026-06-30..2026-06-30", NOW)).toThrow("INVALID_DASHBOARD_PERIOD");
        expect(() => parseDashboardPeriod("range", "2026-06-20..2026-06-10", NOW)).toThrow("INVALID_DASHBOARD_PERIOD");
        expect(() => parseDashboardPeriod("range", "2025-06-01..2026-06-29", NOW)).toThrow("INVALID_DASHBOARD_PERIOD");
    });
});
