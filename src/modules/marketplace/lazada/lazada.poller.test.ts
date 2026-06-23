import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../../config/env";
import type { LazadaSellerCredential } from "./lazada.types";

const mocks = vi.hoisted(() => ({
    getLazadaOrders: vi.fn(),
    getLazadaOrderDetail: vi.fn(),
    getLazadaOrderItems: vi.fn(),
    getLazadaOrderTrace: vi.fn(),
    upsertMarketplaceOrder: vi.fn(),
    listLazadaCredentials: vi.fn(),
    resolveLazadaCredential: vi.fn(),
    adaptLazadaThailand: vi.fn(),
}));

vi.mock("./lazada.api", () => ({
    getLazadaOrders: mocks.getLazadaOrders,
    getLazadaOrderDetail: mocks.getLazadaOrderDetail,
    getLazadaOrderItems: mocks.getLazadaOrderItems,
    getLazadaOrderTrace: mocks.getLazadaOrderTrace,
}));

vi.mock("./lazada.token-store", () => ({
    listLazadaCredentials: mocks.listLazadaCredentials,
    resolveLazadaCredential: mocks.resolveLazadaCredential,
}));

vi.mock("../marketplace.service", () => ({
    upsertMarketplaceOrder: mocks.upsertMarketplaceOrder,
}));

vi.mock("../adapters/lazada.adapter", () => ({
    adaptLazadaThailand: mocks.adaptLazadaThailand,
}));

import { getLazadaPollState } from "./lazada.poll-state";
import { runLazadaPolling } from "./lazada.poller";

function credential(): LazadaSellerCredential {
    return {
        platform: "Lazada",
        seller_id: "seller-th",
        account: "seller@example.com",
        country: "th",
        region: "TH",
        access_token: "access",
        refresh_token: "refresh",
        access_token_expires_at: Date.now() + 60_000,
        refresh_token_expires_at: Date.now() + 120_000,
        connected_at: Date.now(),
        updated_at: Date.now(),
    };
}

function memoryKv(): KVNamespace {
    const values = new Map<string, string>();

    return {
        async get(key: string, type?: string) {
            const value = values.get(key);

            if (value === undefined) {
                return null;
            }

            return type === "json" ? JSON.parse(value) : value;
        },
        async put(key: string, value: string | ArrayBuffer | ArrayBufferView | ReadableStream) {
            values.set(key, String(value));
        },
    } as unknown as KVNamespace;
}

function env(): Env {
    return {
        MARKETPLACE_TOKENS: memoryKv(),
        LAZADA_POLL_INITIAL_LOOKBACK_MINUTES: "60",
        LAZADA_POLL_OVERLAP_MINUTES: "10",
        LAZADA_POLL_PAGE_SIZE: "100",
        LAZADA_POLL_MAX_PAGES: "5",
    } as Env;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.listLazadaCredentials.mockResolvedValue([credential()]);
    mocks.resolveLazadaCredential.mockResolvedValue(credential());
    mocks.getLazadaOrders.mockResolvedValue({
        orders: [
            {
                order_id: "1111485195215573",
                updated_at: "2026-06-23T10:04:00.000Z",
            },
        ],
        count: 1,
        total: 1,
        offset: 0,
        limit: 100,
    });
    mocks.getLazadaOrderDetail.mockResolvedValue({
        data: {
            order_id: "1111485195215573",
            statuses: ["pending"],
            updated_at: "2026-06-23T10:04:00.000Z",
        },
    });
    mocks.getLazadaOrderItems.mockResolvedValue({
        data: [{ name: "เสื้อ", quantity: 1, paid_price: 9 }],
    });
    mocks.getLazadaOrderTrace.mockRejectedValue(
        new Error("trace unavailable")
    );
    mocks.adaptLazadaThailand.mockReturnValue({
        normalized: {
            channel: "Lazada",
            event_id: "event-1",
            store_id: "seller-th",
            external_order_id: "1111485195215573",
            buyer: { id: "buyer-1" },
            items: [{ name: "เสื้อ", quantity: 1 }],
            total_amount: 38,
            marketplace_status: "pending",
        },
    });
    mocks.upsertMarketplaceOrder.mockResolvedValue({
        action: "created",
        customer_record_id: "customer-1",
        order_record_id: "order-1",
        channel: "Lazada",
        external_order_id: "1111485195215573",
        order_status: "Processing",
        payment_status: "Waiting Payment",
    });
});

describe("Lazada scheduled polling", () => {
    it("discovers recent orders, upserts them and advances the seller cursor", async () => {
        const testEnv = env();
        const runAtMs = Date.parse("2026-06-23T10:05:00.000Z");
        const report = await runLazadaPolling({
            env: testEnv,
            trigger: "cron",
            runAtMs,
        });

        expect(report.ok).toBe(true);
        expect(report.sellers[0]?.counts).toMatchObject({
            discovered: 1,
            processed: 1,
            created: 1,
            failed: 0,
        });
        expect(mocks.getLazadaOrders).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ seller_id: "seller-th" }),
            expect.objectContaining({
                updatedBefore: "2026-06-23T10:05:00.000Z",
                offset: 0,
                limit: 100,
            })
        );
        expect(mocks.upsertMarketplaceOrder).toHaveBeenCalledOnce();

        const state = await getLazadaPollState(testEnv, "seller-th");
        expect(state?.cursor_updated_after_ms).toBe(runAtMs);
        expect(state?.pending_retry_order_ids).toEqual([]);
        expect(state?.last_counts?.created).toBe(1);
    });

    it("keeps failed order ids for a later retry without losing the time cursor", async () => {
        const testEnv = env();
        const runAtMs = Date.parse("2026-06-23T10:05:00.000Z");
        mocks.upsertMarketplaceOrder.mockRejectedValueOnce(
            new Error("temporary Lark failure")
        );

        const report = await runLazadaPolling({
            env: testEnv,
            trigger: "cron",
            runAtMs,
        });

        expect(report.ok).toBe(false);
        expect(report.sellers[0]?.counts.failed).toBe(1);
        const state = await getLazadaPollState(testEnv, "seller-th");
        expect(state?.cursor_updated_after_ms).toBe(runAtMs);
        expect(state?.pending_retry_order_ids).toEqual([
            "1111485195215573",
        ]);
    });
});
