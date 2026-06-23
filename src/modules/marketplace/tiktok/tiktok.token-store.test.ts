import { describe, expect, it } from "vitest";
import { buildTikTokCredential } from "./tiktok.token-store";

describe("TikTok Shop credential mapping", () => {
    it("converts unix expiry timestamps and preserves connected time", () => {
        const previous = buildTikTokCredential({
            token: {
                access_token: "old-access",
                refresh_token: "old-refresh",
                access_token_expire_in: 1_800_000_000,
                refresh_token_expire_in: 1_900_000_000,
                open_id: "open-1",
            },
            shop: {
                shop_cipher: "cipher-th",
                shop_id: "shop-th",
                shop_name: "ร้านไทย",
                region: "TH",
            },
        });
        const refreshed = buildTikTokCredential({
            token: {
                access_token: "new-access",
                refresh_token: "new-refresh",
                access_token_expire_in: 1_800_100_000,
                refresh_token_expire_in: 1_900_100_000,
            },
            shop: {
                shop_cipher: "cipher-th",
                shop_id: "shop-th",
                shop_name: "ร้านไทย",
                region: "TH",
            },
            previous,
        });

        expect(refreshed.access_token).toBe("new-access");
        expect(refreshed.access_token_expires_at).toBe(1_800_100_000_000);
        expect(refreshed.refresh_token_expires_at).toBe(1_900_100_000_000);
        expect(refreshed.connected_at).toBe(previous.connected_at);
        expect(refreshed.open_id).toBe("open-1");
    });
});
