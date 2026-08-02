import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import type { PcProduct } from "../production-control/pc.types";

const mocks = vi.hoisted(() => ({
    getPcOverview: vi.fn(),
    reconcileOrderInventory: vi.fn(),
}));

vi.mock("../production-control/pc.service", () => ({
    getPcOverview: mocks.getPcOverview,
    reconcileOrderInventory: mocks.reconcileOrderInventory,
}));

import { getDemoShopCatalog } from "./demo-shop.service";

function env(): Env {
    return {
        PC_DEMO_SHOP_ENABLED: "true",
        PC_INVENTORY_ENABLED: "false",
        PC_PRODUCTS_TABLE_ID: "products",
        PC_MATERIALS_TABLE_ID: "materials",
        PC_PRODUCTION_TABLE_ID: "production",
    } as Env;
}

function product(input: {
    sku: string;
    stock: number;
    min: number;
    staleStatus: PcProduct["stock_status"];
}): PcProduct {
    return {
        record_id: `rec-${input.sku}`,
        sku: input.sku,
        product_id: input.sku,
        style_code: "MABEL",
        product_name: "Mabel",
        category: "Blouse",
        color: "White",
        size: input.sku.split("-").at(-1) ?? "M",
        sales_price_thb: 1490,
        stock_on_hand: input.stock,
        min_stock: input.min,
        target_stock: 18,
        stock_status: input.staleStatus,
        recommended_production_qty: 0,
        production_lead_days: 7,
        materials_json: "[]",
        active: true,
    };
}

describe("Demo Shop stock threshold catalog", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("ignores stale stock_status and derives each SKU status from stock_on_hand versus min_stock", async () => {
        mocks.getPcOverview.mockResolvedValue({
            summary: {},
            products: [
                product({
                    sku: "BNK-MABEL-WH-S",
                    stock: 7,
                    min: 5,
                    staleStatus: "LOW_STOCK",
                }),
                product({
                    sku: "BNK-MABEL-WH-M",
                    stock: 8,
                    min: 8,
                    staleStatus: "NORMAL",
                }),
                product({
                    sku: "BNK-MABEL-WH-L",
                    stock: 0,
                    min: 5,
                    staleStatus: "NORMAL",
                }),
            ],
            materials: [],
            production: [],
        });

        const catalog = await getDemoShopCatalog(env());
        const bySku = new Map(
            catalog.products.map((item) => [item.sku, item])
        );

        expect(bySku.get("BNK-MABEL-WH-S")).toMatchObject({
            stock_on_hand: 7,
            min_stock: 5,
            stock_status: "NORMAL",
        });
        expect(bySku.get("BNK-MABEL-WH-M")).toMatchObject({
            stock_on_hand: 8,
            min_stock: 8,
            stock_status: "LOW_STOCK",
        });
        expect(bySku.get("BNK-MABEL-WH-L")).toMatchObject({
            stock_on_hand: 0,
            min_stock: 5,
            stock_status: "OUT_OF_STOCK",
        });
    });
});
