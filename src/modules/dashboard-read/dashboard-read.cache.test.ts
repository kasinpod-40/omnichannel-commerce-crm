import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearDashboardReadCache,
    withDashboardReadCache,
} from "./dashboard-read.cache";

describe("dashboard read cache", () => {
    beforeEach(() => clearDashboardReadCache());

    it("deduplicates concurrent loads for the same key", async () => {
        let resolveLoader!: (value: string) => void;
        const loader = vi.fn(() => new Promise<string>((resolve) => {
            resolveLoader = resolve;
        }));

        const first = withDashboardReadCache("customers", 1_000, loader);
        const second = withDashboardReadCache("customers", 1_000, loader);
        resolveLoader("loaded");

        await expect(Promise.all([first, second])).resolves.toEqual(["loaded", "loaded"]);
        expect(loader).toHaveBeenCalledTimes(1);
    });

    it("reuses cached data until the matching prefix is cleared", async () => {
        const loader = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("second");

        await expect(withDashboardReadCache("orders:list", 60_000, loader)).resolves.toBe("first");
        await expect(withDashboardReadCache("orders:list", 60_000, loader)).resolves.toBe("first");
        clearDashboardReadCache("orders");
        await expect(withDashboardReadCache("orders:list", 60_000, loader)).resolves.toBe("second");
        expect(loader).toHaveBeenCalledTimes(2);
    });
});
