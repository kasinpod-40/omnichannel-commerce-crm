import { beforeEach, describe, expect, it, vi } from "vitest";

const { buildMarketplaceDashboardSummary } = vi.hoisted(() => ({
    buildMarketplaceDashboardSummary: vi.fn(),
}));

vi.mock("../../modules/dashboard/marketplace-dashboard.service", () => ({
    buildMarketplaceDashboardSummary,
}));

import { handleMarketplaceDashboard } from "./dashboard.route";

const env = {
    NOTIFICATION_DISPATCH_TOKEN: "secret",
} as any;

describe("marketplace dashboard route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        buildMarketplaceDashboardSummary.mockResolvedValue({
            generated_at: 1,
        });
    });

    it("passes channel, store and Thailand date filters to the service", async () => {
        const response = await handleMarketplaceDashboard(
            new Request(
                "https://example.com/admin/dashboard/marketplace?channel=Lazada&store_id=101&date_from=2026-06-23&date_to=2026-06-24",
                {
                    headers: {
                        Authorization: "Bearer secret",
                    },
                }
            ),
            env
        );

        expect(response.status).toBe(200);
        expect(buildMarketplaceDashboardSummary).toHaveBeenCalledWith(
            env,
            {
                channel: "Lazada",
                store_id: "101",
                date_from_ms: Date.parse("2026-06-23T00:00:00+07:00"),
                date_to_ms: Date.parse("2026-06-24T23:59:59.999+07:00"),
            }
        );
    });

    it("rejects unknown channels", async () => {
        const response = await handleMarketplaceDashboard(
            new Request(
                "https://example.com/admin/dashboard/marketplace?channel=Facebook",
                {
                    headers: {
                        Authorization: "Bearer secret",
                    },
                }
            ),
            env
        );

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(
            expect.objectContaining({ code: "INVALID_CHANNEL" })
        );
    });

    it("requires the admin token", async () => {
        const response = await handleMarketplaceDashboard(
            new Request("https://example.com/admin/dashboard/marketplace"),
            env
        );

        expect(response.status).toBe(401);
    });
});
