import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../config/env";
import {
    buildLazadaAuthorizationUrl,
    exchangeLazadaAuthorizationCode,
    getLazadaOrderDetail,
    getLazadaOrderItems,
    getLazadaOrders,
} from "./lazada.api";
import type { LazadaSellerCredential } from "./lazada.types";

function testEnv(): Env {
    return {
        LAZADA_APP_KEY: "app-key-th",
        LAZADA_APP_SECRET: "app-secret-th",
        LAZADA_AUTH_BASE: "https://auth.lazada.com",
        LAZADA_API_BASE: "https://api.lazada.co.th/rest",
        LAZADA_REDIRECT_URI:
            "https://crm.example.com/oauth/lazada/callback",
    } as Env;
}

function credential(): LazadaSellerCredential {
    return {
        platform: "Lazada",
        seller_id: "1234567",
        account: "seller@example.com",
        country: "th",
        region: "TH",
        access_token: "access-token",
        refresh_token: "refresh-token",
        access_token_expires_at: Date.now() + 60 * 60 * 1000,
        refresh_token_expires_at: Date.now() + 24 * 60 * 60 * 1000,
        connected_at: Date.now(),
        updated_at: Date.now(),
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Lazada Open Platform API client", () => {
    it("builds the seller authorization URL", () => {
        const url = new URL(buildLazadaAuthorizationUrl(testEnv()));

        expect(url.origin).toBe("https://auth.lazada.com");
        expect(url.pathname).toBe("/oauth/authorize");
        expect(url.searchParams.get("response_type")).toBe("code");
        expect(url.searchParams.get("force_auth")).toBe("true");
        expect(url.searchParams.get("client_id")).toBe("app-key-th");
        expect(url.searchParams.get("redirect_uri")).toBe(
            "https://crm.example.com/oauth/lazada/callback"
        );
    });

    it("exchanges an authorization code and normalizes the Thailand seller", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input));

            expect(url.origin).toBe("https://auth.lazada.com");
            expect(url.pathname).toBe("/rest/auth/token/create");
            expect(url.searchParams.get("app_key")).toBe("app-key-th");
            expect(url.searchParams.get("code")).toBe("authorization-code");
            expect(url.searchParams.get("sign_method")).toBe("sha256");
            expect(url.searchParams.get("sign")).toMatch(/^[A-F0-9]{64}$/);
            expect(init?.method).toBe("POST");

            return new Response(
                JSON.stringify({
                    access_token: "access",
                    refresh_token: "refresh",
                    expires_in: 2592000,
                    refresh_expires_in: 15552000,
                    account: "seller@example.com",
                    country: "th",
                    country_user_info: [
                        {
                            country: "th",
                            user_id: "user-th",
                            seller_id: "seller-th",
                            short_code: "TH123",
                        },
                    ],
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            );
        });
        vi.stubGlobal("fetch", fetchMock);

        const token = await exchangeLazadaAuthorizationCode(
            testEnv(),
            "authorization-code"
        );

        expect(token).toMatchObject({
            access_token: "access",
            refresh_token: "refresh",
            account: "seller@example.com",
            country_user_info: [
                {
                    country: "th",
                    user_id: "user-th",
                    seller_id: "seller-th",
                    short_code: "TH123",
                },
            ],
        });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("calls Thailand order detail and item endpoints with signed access-token requests", async () => {
        const paths: string[] = [];
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = new URL(String(input));
            paths.push(url.pathname);

            expect(url.origin).toBe("https://api.lazada.co.th");
            expect(url.searchParams.get("app_key")).toBe("app-key-th");
            expect(url.searchParams.get("access_token")).toBe("access-token");
            expect(url.searchParams.get("order_id")).toBe("260623900198363");
            expect(url.searchParams.get("sign")).toMatch(/^[A-F0-9]{64}$/);

            const data = url.pathname.endsWith("/order/items/get")
                ? [{ name: "เสื้อยืด", quantity: 1 }]
                : { order_number: "260623900198363", statuses: ["pending"] };

            return new Response(JSON.stringify({ data }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        const detail = await getLazadaOrderDetail(
            testEnv(),
            credential(),
            "260623900198363"
        );
        const items = await getLazadaOrderItems(
            testEnv(),
            credential(),
            "260623900198363"
        );

        expect(paths).toEqual([
            "/rest/order/get",
            "/rest/order/items/get",
        ]);
        expect(detail).toEqual({
            data: {
                order_number: "260623900198363",
                statuses: ["pending"],
            },
        });
        expect(items).toEqual({
            data: [{ name: "เสื้อยืด", quantity: 1 }],
        });
    });

    it("lists recently updated orders with pagination and an upper time bound", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = new URL(String(input));

            expect(url.pathname).toBe("/rest/orders/get");
            expect(url.searchParams.get("update_after")).toBe(
                "2026-06-23T10:00:00.000Z"
            );
            expect(url.searchParams.get("update_before")).toBe(
                "2026-06-23T10:05:00.000Z"
            );
            expect(url.searchParams.has("updated_after")).toBe(false);
            expect(url.searchParams.has("updated_before")).toBe(false);
            expect(url.searchParams.get("sort_by")).toBe("updated_at");
            expect(url.searchParams.get("sort_direction")).toBe("ASC");
            expect(url.searchParams.get("offset")).toBe("100");
            expect(url.searchParams.get("limit")).toBe("50");

            return new Response(
                JSON.stringify({
                    data: {
                        count: 1,
                        count_total: 151,
                        orders: [
                            {
                                order_id: 1111485195215573,
                                updated_at: "2026-06-23 17:13:54 +0700",
                            },
                        ],
                    },
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            );
        });
        vi.stubGlobal("fetch", fetchMock);

        const page = await getLazadaOrders(testEnv(), credential(), {
            updatedAfter: "2026-06-23T10:00:00.000Z",
            updatedBefore: "2026-06-23T10:05:00.000Z",
            offset: 100,
            limit: 50,
        });

        expect(page).toEqual({
            orders: [
                {
                    order_id: 1111485195215573,
                    updated_at: "2026-06-23 17:13:54 +0700",
                },
            ],
            count: 1,
            total: 151,
            offset: 100,
            limit: 50,
        });
    });

});
