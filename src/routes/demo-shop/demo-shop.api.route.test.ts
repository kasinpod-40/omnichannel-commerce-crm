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
    getPcOverview: vi.fn(),
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

vi.mock("../../modules/production-control/pc.service", () => ({
    getPcOverview: mocks.getPcOverview,
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
            user_id: "user-demo",
            open_id: "ou_demo",
            name: "Demo Operator",
            role,
        },
    };
}

function catalog(stockOnHand = 3) {
    return {
        products: [
            {
                sku: "BNK-LUNA-IV-M",
                product_name: "Luna",
                category: "Dress",
                style_code: "LUNA",
                color: "Ivory",
                size: "M",
                price_thb: 1590,
                stock_on_hand: stockOnHand,
                min_stock: 5,
                stock_status:
                    stockOnHand <= 0 ? "OUT_OF_STOCK" : "LOW_STOCK",
            },
        ],
        updated_at: "2026-08-02T00:00:00.000Z",
    };
}

function overview() {
    return {
        summary: {},
        products: [],
        materials: [],
        production: [],
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
        mocks.getDemoShopCatalog.mockResolvedValue(catalog(3));
        mocks.getPcOverview.mockResolvedValue(overview());
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
        expect(mocks.getPcOverview).toHaveBeenCalledWith(
            expect.objectContaining({
                PC_INVENTORY_ENABLED: "false",
                PC_DEMO_SHOP_ENABLED: "true",
            })
        );
    });

    it("joins the highest-priority active production state to the matching SKU", async () => {
        mocks.getPcOverview.mockResolvedValue({
            ...overview(),
            production: [
                {
                    record_id: "production-recommended",
                    production_id: "PROD-RECOMMENDED",
                    product_sku: "BNK-LUNA-IV-M",
                    production_status: "RECOMMENDED",
                    planned_qty: 12,
                    recommended_qty: 12,
                    created_at: 20,
                },
                {
                    record_id: "production-active",
                    production_id: "PROD-ACTIVE",
                    product_sku: "bnk-luna-iv-m",
                    production_status: "IN_PROGRESS",
                    planned_qty: 16,
                    recommended_qty: 16,
                    created_at: 10,
                },
            ],
        });

        const response = await handleDemoShopProducts(
            new Request("https://worker.example.com/demo-shop/api/products"),
            env()
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            products: [
                {
                    sku: "BNK-LUNA-IV-M",
                    production_status: "IN_PROGRESS",
                    production_qty: 16,
                    production_id: "PROD-ACTIVE",
                },
            ],
        });
    });

    it("allows ordering every remaining unit while stock is low but above zero", async () => {
        mocks.readJsonObject.mockResolvedValue({
            sku: "BNK-LUNA-IV-M",
            quantity: 3,
        });
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
                    quantity: 3,
                }),
            }),
            env()
        );

        expect(response.status).toBe(201);
        expect(mocks.createDemoShopShopeeOrder).toHaveBeenCalledWith(
            expect.objectContaining({ PC_INVENTORY_ENABLED: "true" }),
            {
                sku: "BNK-LUNA-IV-M",
                quantity: 3,
                idempotency_key: "demo-shop-request-001",
            }
        );
    });

    it("rejects a quantity greater than the current stock before creating an Order", async () => {
        mocks.readJsonObject.mockResolvedValue({
            sku: "BNK-LUNA-IV-M",
            quantity: 4,
        });

        const response = await handleDemoShopOrderCreate(
            new Request("https://worker.example.com/demo-shop/api/orders", {
                method: "POST",
                headers: {
                    Origin: "https://worker.example.com",
                    "Content-Type": "application/json",
                    "Idempotency-Key": "demo-shop-request-002",
                },
            }),
            env()
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
            message: "สินค้าคงเหลือ 3 ชิ้น กรุณาลดจำนวนที่สั่ง",
        });
        expect(mocks.createDemoShopShopeeOrder).not.toHaveBeenCalled();
    });

    it("rejects an Order after stock reaches zero", async () => {
        mocks.getDemoShopCatalog.mockResolvedValue(catalog(0));

        const response = await handleDemoShopOrderCreate(
            new Request("https://worker.example.com/demo-shop/api/orders", {
                method: "POST",
                headers: {
                    Origin: "https://worker.example.com",
                    "Content-Type": "application/json",
                    "Idempotency-Key": "demo-shop-request-003",
                },
            }),
            env()
        );

        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toMatchObject({
            message: "สินค้านี้หมดแล้ว กรุณาเลือกสินค้า หรือไซซ์อื่น",
        });
        expect(mocks.createDemoShopShopeeOrder).not.toHaveBeenCalled();
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
        expect(mocks.getDemoShopCatalog).not.toHaveBeenCalled();
        expect(mocks.createDemoShopShopeeOrder).not.toHaveBeenCalled();
    });
});
