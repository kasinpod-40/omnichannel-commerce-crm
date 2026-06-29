import { describe, expect, it } from "vitest";
import { buildPeriodBuckets, parseDashboardPeriod } from "./dashboard-period";

describe("dashboard period", () => {
    it("builds 24 hourly buckets for a Bangkok day", () => {
        const period = parseDashboardPeriod("day", "2026-06-29");
        expect(buildPeriodBuckets(period)).toHaveLength(24);
        expect(buildPeriodBuckets(period)[0]?.key).toBe("00:00");
    });

    it("supports leap-year months and yearly months", () => {
        expect(buildPeriodBuckets(parseDashboardPeriod("month", "2024-02"))).toHaveLength(29);
        expect(buildPeriodBuckets(parseDashboardPeriod("year", "2026"))).toHaveLength(12);
    });
});
