import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { upsertMarketplaceOrder } from "../marketplace/marketplace.service";
import { getOrderByRecordId } from "../orders/order.repository";
import { notifyLowStockAfterOrderOnce } from "../production-control/pc.low-stock-alert";
import {
    getPcOverview,
    reconcileOrderInventory,
} from "../production-control/pc.service";
import type {
    PcOrderInventoryState,
    PcProduct,
} from "../production-control/pc.types";
import { getLarkText } from "../../utils/lark-field-value";
import { OperationalError } from "../../utils/errors";
import { assertDemoShopSafeMode } from "./demo-shop.service";
import type { DemoShopOrderResult } from "./demo-shop.types";

const DEMO_CHANNEL = "Shopee" as const;
const DEMO_STORE_ID = "demo-shop-shopee-th";
const DEMO_STORE_NAME = "Demo Shop · Shopee";
const DEMO_BUYER_ID = "demo-shop-buyer";
const DEMO_BUYER_NAME = "Demo Shop Customer";
const DEMO_PHONE = "0800000000";
const DEMO_ADDRESS = "88 Demo Atelier Road, Bangkok 10110";
const MAX_DEMO_QUANTITY = 20;

function demoError(
    code: string,
    message: string,
    status = 422
): OperationalError {
    return new OperationalError(code, message, {
        retryable: false,
        status,
    });
}

function normalizeIdempotencyKey(value: string): string {
    const normalized = value.trim();

    if (
        normalized.length < 8 ||
        normalized.length > 120 ||
        !/^[A-Za-z0-9._:-]+$/.test(normalized)
    ) {
        throw demoError(
            "DEMO_SHOP_IDEMPOTENCY_KEY_INVALID",
            "Idempotency-Key must contain 8-120 safe characters",
            400
        );
    }

    return normalized;
}

function normalizeQuantity(value: unknown): number {
    const quantity = Number(value);

    if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_DEMO_QUANTITY
    ) {
        throw demoError(
            "DEMO_SHOP_QUANTITY_INVALID",
            `Quantity must be an integer between 1 and ${MAX_DEMO_QUANTITY}`,
            400
        );
    }

    return quantity;
}

function demoExternalOrderId(idempotencyKey: string): string {
    const safeKey = idempotencyKey
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, 36)
        .toUpperCase();

    return `DEMO-SHP-${safeKey}`;
}

function demoSafeEnv(env: Env): Env {
    return {
        ...env,
        PC_INVENTORY_ENABLED: "false",
    };
}

function demoPcEnv(env: Env): Env {
    return {
        ...env,
        PC_INVENTORY_ENABLED: "true",
    };
}

function findSelectedProduct(products: PcProduct[], sku: string): PcProduct {
    const normalizedSku = sku.trim().toLowerCase();
    const product = products.find(
        (item) =>
            item.active &&
            item.sku.trim().toLowerCase() === normalizedSku
    );

    if (!product) {
        throw demoError(
            "DEMO_SHOP_PRODUCT_NOT_FOUND",
            "Product is not available in Demo Shop",
            404
        );
    }

    return product;
}

function parseInventoryState(value: unknown): PcOrderInventoryState | null {
    const text = getLarkText(value, "").trim();
    if (!text) return null;

    try {
        const parsed = JSON.parse(text) as PcOrderInventoryState;
        return parsed.version === 1 && Array.isArray(parsed.transitions)
            ? parsed
            : null;
    } catch {
        return null;
    }
}

function resultFromState(input: {
    orderNumber: string;
    product: PcProduct;
    quantity: number;
    state: PcOrderInventoryState | null;
    currentStock: number;
    productionIds: string[];
    batches: Awaited<ReturnType<typeof getPcOverview>>["production"];
    duplicate: boolean;
}): DemoShopOrderResult {
    const transition = input.state?.transitions.find(
        (item) =>
            item.sku.trim().toLowerCase() ===
            input.product.sku.trim().toLowerCase()
    );
    const productionIdSet = new Set(input.productionIds);
    const batches = input.batches
        .filter((batch) => productionIdSet.has(batch.production_id))
        .map((batch) => ({
            production_id: batch.production_id,
            status: batch.production_status,
            recommended_qty: batch.recommended_qty,
            planned_qty: batch.planned_qty,
            material_check_status: batch.material_check_status,
            material_risk_summary: batch.material_risk_summary,
        }));
    const unitPrice = Math.max(0, input.product.sales_price_thb);

    return {
        ok: true,
        duplicate: input.duplicate,
        order_number: input.orderNumber,
        product: {
            sku: input.product.sku,
            product_name: input.product.product_name,
            color: input.product.color,
            size: input.product.size,
            quantity: input.quantity,
            unit_price_thb: unitPrice,
            total_amount_thb: unitPrice * input.quantity,
        },
        inventory: {
            status: input.state?.phase?.toUpperCase() ?? "UNKNOWN",
            stock_before: transition?.old_stock_on_hand ?? null,
            stock_after:
                transition?.new_stock_on_hand ?? input.currentStock,
            stock_delta:
                transition === undefined
                    ? null
                    : transition.new_stock_on_hand -
                      transition.old_stock_on_hand,
        },
        production: {
            created_or_updated: input.productionIds.length > 0,
            production_ids: input.productionIds,
            batches,
        },
        completed_at: new Date().toISOString(),
    };
}

/**
 * สร้าง Order สาธิตผ่าน Marketplace service เดิม เพื่อให้ Activity และ
 * Notification ใช้เส้นทางเดียวกับ Shopee Order จริง โดยแยก Queue automation
 * ของ Demo Shop ออกจาก Global PC flag และ Reconcile แบบ synchronous เฉพาะ Demo Order.
 */
export async function createDemoShopShopeeOrder(
    env: Env,
    input: {
        sku: string;
        quantity: unknown;
        idempotency_key: string;
    }
): Promise<DemoShopOrderResult> {
    const safeEnv = demoSafeEnv(env);
    assertDemoShopSafeMode(safeEnv);
    const idempotencyKey = normalizeIdempotencyKey(
        input.idempotency_key
    );
    const quantity = normalizeQuantity(input.quantity);
    const sku = input.sku.trim();

    if (!sku) {
        throw demoError(
            "DEMO_SHOP_SKU_REQUIRED",
            "Product SKU is required",
            400
        );
    }

    const beforeOverview = await getPcOverview(env);
    const productBefore = findSelectedProduct(
        beforeOverview.products,
        sku
    );
    const externalOrderId = demoExternalOrderId(idempotencyKey);
    const eventId = `demo-shop:${idempotencyKey}`;
    const now = Date.now();

    /*
     * บังคับ PC_INVENTORY_ENABLED=false เฉพาะ Marketplace upsert ของ Demo Shop
     * เพื่อไม่ส่ง Queue ซ้ำ จากนั้น Reconcile แบบ synchronous ด้านล่าง.
     */
    const marketplace = await upsertMarketplaceOrder(safeEnv, {
        channel: DEMO_CHANNEL,
        event_id: eventId,
        store_id: DEMO_STORE_ID,
        store_name: DEMO_STORE_NAME,
        external_order_id: externalOrderId,
        buyer: {
            id: DEMO_BUYER_ID,
            name: DEMO_BUYER_NAME,
            phone: DEMO_PHONE,
            address: DEMO_ADDRESS,
        },
        items: [
            {
                sku: productBefore.sku,
                name: productBefore.product_name,
                variant: [productBefore.color, productBefore.size]
                    .filter(Boolean)
                    .join(" "),
                quantity,
                unit_price: Math.max(0, productBefore.sales_price_thb),
            },
        ],
        currency: "THB",
        total_amount:
            Math.max(0, productBefore.sales_price_thb) * quantity,
        marketplace_status: "READY_TO_SHIP",
        marketplace_payment_status: "PAID",
        created_at: now,
        updated_at: now,
        paid_at: now,
    });

    const order = await getOrderByRecordId(
        env,
        marketplace.order_record_id
    );

    if (!order) {
        throw demoError(
            "DEMO_SHOP_ORDER_NOT_FOUND_AFTER_UPSERT",
            "ไม่พบ Shopee Demo Order หลังสร้างรายการ",
            502
        );
    }

    const pcEnv = demoPcEnv(env);
    const inventory = await reconcileOrderInventory(
        pcEnv,
        order.record_id
    );

    if (inventory.status === "APPLIED") {
        await notifyLowStockAfterOrderOnce(pcEnv, order.record_id);
    }

    const afterOverview = await getPcOverview(env);
    const productAfter = findSelectedProduct(
        afterOverview.products,
        sku
    );
    const refreshedOrder =
        (await getOrderByRecordId(env, order.record_id)) ?? order;
    const state = parseInventoryState(
        refreshedOrder.fields[ORDER_FIELDS.PC_INVENTORY_STATE_JSON]
    );
    const existingProductionIds = afterOverview.production
        .filter((batch) => batch.source_order_id === order.record_id)
        .map((batch) => batch.production_id)
        .filter(Boolean);
    const productionIds = [
        ...new Set([
            ...inventory.production_ids,
            ...existingProductionIds,
        ]),
    ];

    return resultFromState({
        orderNumber: getLarkText(
            refreshedOrder.fields[ORDER_FIELDS.ORDER_NUMBER],
            externalOrderId
        ),
        product: productBefore,
        quantity,
        state,
        currentStock: productAfter.stock_on_hand,
        productionIds,
        batches: afterOverview.production,
        duplicate:
            marketplace.action === "duplicate" || inventory.duplicate,
    });
}
