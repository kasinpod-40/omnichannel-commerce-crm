import type { PcStockStatus } from "../production-control/pc.types";

export type DemoShopProduct = {
    sku: string;
    product_name: string;
    category: string;
    style_code: string;
    color: string;
    size: string;
    price_thb: number;
    stock_on_hand: number;
    stock_status: PcStockStatus;
};

export type DemoShopCatalog = {
    products: DemoShopProduct[];
    updated_at: string;
};

export type DemoShopOrderResult = {
    ok: true;
    duplicate: boolean;
    order_number: string;
    product: {
        sku: string;
        product_name: string;
        color: string;
        size: string;
        quantity: number;
        unit_price_thb: number;
        total_amount_thb: number;
    };
    inventory: {
        status: string;
        stock_before: number | null;
        stock_after: number;
        stock_delta: number | null;
    };
    production: {
        created_or_updated: boolean;
        production_ids: string[];
        batches: Array<{
            production_id: string;
            status: string;
            recommended_qty: number;
            planned_qty: number;
            material_check_status: string;
            material_risk_summary: string;
        }>;
    };
    completed_at: string;
};
