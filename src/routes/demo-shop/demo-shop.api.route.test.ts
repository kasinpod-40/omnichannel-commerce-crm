import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";

const mocks = vi.hoisted(() => ({
    assertAllowedOrigin: vi.fn(),
    readJsonObject: vi.fn(),
    addAuthCorsHeaders: vi.fn((response: Response) => response),
    assertDashboardSession: vi.fn(),
    dashboardApiErrorResponse: vi.fn(
        (_request: Request, _env: Env, error: unknown) =>
            Response.json(
                {
                    ok: false,
                    message:
                        error instanceof Error ? error.message : "error",
                },
                {
                    status:
                        typeof error === "object" &&
                        error !== null &&
                        "status" in error &&
                        typeof error.status === "number"
                            ? error.status
                            : 500,
                }
            )
    ),
    dashboardJson: vi.fn(
        (value: unknown, status = 200) => Response.json(value, { status })
    ),
    dashboardMethodNotAllowed: vi.fn(() =>
        Response.json({ ok: false }, { status: 405 })
    ),
    createDemoShopShopeeOrder: vi.fn(),
    getDemoShopCatalog: vi.fn(),
    isDemoShopEnabled: vi.fn(() => true),
}));

vi.mock("../auth/auth-http", () => ({
    assertAllowedOrigin: mocks.assertAllowedOrigin,
    readJsonObject: mocks.readJsonObject,
    addAuthCorsHeaders: mocks.addAuthCorsHeaders,
}));

vi.mock("../shared/dashboard-api", () => ({
    assertDashboardSession: mocks.assertDashboardSession,
    dashboardApiErrorResponse: mocks.dashboardApiErrorResponse,
    dashboardJson: mocks.dashboardJson,
    dashboardMethodNotAllowed: mocks.dashboardMethodNotAllowed,
}));

vi.mock("../../modules/demo-shop/demo-shop.service", () => ({
    getDemoShopCatalog: mocks.getDemoShopCatalog,
    isDemoShopEnabled: mocks.isDemoShopEnabled,
}));

vi.mock("../../modules/demo-shop/demo-shop-shopee.service", () => ({
    createDemoShopShopeeOrder: mocks.createDemoShopShopeeOrder,
}));

import {
    handleDemoShopOrderCreate,
    handleDemoShopProducts,
} from "./demo-shop.route";

function env(): Env {
    return {
        PC_INVENTORY_ENABLED: "true",
        PC_DEMO_SHOP_ENABLED: "true",
    } as Env;
}

function session(role: "admin" | "manager" | "viewer") {
    return {
        user: {
            open_id: "ou_demo",
            name: "Demo Operator",
            role,
        },
    };
}

describe("Demo Shop API route", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.assertDashboardSession.mockResolvedValue(session("manager"));
        mocks.readJsonObject.mockResolvedValue({
            sku: "BNK-LUNA-IV-M",
            quantity: 2,
        });
    });

    it("requires a Dashboard session and masks the global inventory flag before returning products", async () => {
        mocks.getDemoShopCatalog.mockResolvedValue({
            products: [],
            updated_at: "2026-08-02T00:00:00.000Z",
        });

        const response = await handleDemoShopProducts(
            new Request("https://worker.example.com/demo-shop/api/products"),
            env()
        );

        expect(response.status).toBe(200);
        expect(mocks.assertDashboardSession).toHaveBeenCalledTimes(1);
        expect(mocks.getDemoShopCatalog).toHaveBeenCalledWith(
            expect.objectContaining({
                PC_INVENTORY_ENABLED: "false",
                PC_DEMO_SHOP_ENABLED: "true",
            })
        );
    });

    it("checks Origin, role and Idempotency-Key before creating a Shopee Demo Order", async () => {
        mocks.createDemoShopShopeeOrder.mockResolvedValue({
            ok: true,
            duplicate: false,
            channel: "Shopee",
            order_number: "SHP-DEMO-1",
        });

        const response = await handleDemoShopOrderCreate(
            new Request("https://worker.example.com/demo-shop/api/orders", {
                method: "POST",
                headers: {
                    Origin: "https://worker.example.com",
                    "Content-Type": "application/json",
                    "Idempotency-Key": "demo-shop-request-001",
                },
                body: JSON.stringify({
                    sku: "BNK-LUNA-IV-M",
                    quantity: 2,
                }),
            }),
            env()
        );

        expect(response.status).toBe(201);
        expect(mocks.assertAllowedOrigin).toHaveBeenCalledTimes(1);
        expect(mocks.assertDashboardSession).toHaveBeenCalledTimes(1);
        expect(mocks.createDemoShopShopeeOrder).toHaveBeenCalledWith(
            expect.objectContaining({ PC_INVENTORY_ENABLED: "true" }),
            {
                sku: "BNK-LUNA-IV-M",
                quantity: 2,
                idempotency_key: "demo-shop-request-001",
            }
        );
    });

    it("rejects a viewer before running the Shopee Demo Order service", async () => {
        mocks.assertDashboardSession.mockResolvedValue(session("viewer"));

        const response = await handleDemoShopOrderCreate(
            new Request("https://worker.example.com/demo-shop/api/orders", {
                method: "POST",
                headers: {
                    Origin: "https://worker.example.com",
                    "Content-Type": "application/json",
                    "Idempotency-Key": "demo-shop-request-001",
                },
                body: JSON.stringify({
                    sku: "BNK-LUNA-IV-M",
                    quantity: 2,
                }),
            }),
            env()
        );

        expect(response.status).toBe(403);
        expect(mocks.createDemoShopShopeeOrder).not.toHaveBeenCalled();
    });
});
