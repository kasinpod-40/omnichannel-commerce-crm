import { describe, expect, it } from "vitest";
import {
    buildLazadaCredential,
    selectThailandSellerProfiles,
} from "./lazada.token-store";

describe("Lazada seller credential mapping", () => {
    it("selects Thailand seller profiles when a token has multiple countries", () => {
        const profiles = selectThailandSellerProfiles({
            access_token: "access",
            refresh_token: "refresh",
            country_user_info: [
                { country: "sg", seller_id: "sg-1" },
                { country: "th", seller_id: "th-1" },
            ],
        });

        expect(profiles).toEqual([
            { country: "th", seller_id: "th-1" },
        ]);
    });

    it("maps relative expiries and preserves the original connection time", () => {
        const previous = buildLazadaCredential({
            token: {
                access_token: "old-access",
                refresh_token: "old-refresh",
                expires_in: 2_592_000,
                refresh_expires_in: 15_552_000,
                account: "seller@example.com",
                country_user_info: [],
            },
            seller: {
                country: "th",
                seller_id: "seller-th",
                short_code: "TH123",
            },
        });
        const refreshed = buildLazadaCredential({
            token: {
                access_token: "new-access",
                refresh_token: "new-refresh",
                expires_in: 2_592_000,
                refresh_expires_in: 15_552_000,
                country_user_info: [],
            },
            seller: {
                country: "th",
                seller_id: "seller-th",
            },
            previous,
        });

        expect(refreshed.access_token).toBe("new-access");
        expect(refreshed.refresh_token).toBe("new-refresh");
        expect(refreshed.connected_at).toBe(previous.connected_at);
        expect(refreshed.account).toBe("seller@example.com");
        expect(refreshed.short_code).toBe("TH123");
        expect(refreshed.access_token_expires_at).toBeGreaterThan(
            Date.now()
        );
    });
});
