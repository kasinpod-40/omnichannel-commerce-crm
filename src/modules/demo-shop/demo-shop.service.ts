import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import {
    createCustomer,
    findCustomerByChannelCustomerId,
    updateCustomer,
    type LarkCustomerRecord,
} from "../customers/customer.repository";
import { createOrder, findOrderByChannelAndExternalId } from "../orders/order.repository";
import { applyManualPaymentVerification } from "../payments/payment.service";
import { createOpenPipelineForCustomer } from "../pipeline/pipeline.service";
import {
    getPcOverview,
    reconcileOrderInventory,
} from "../production-control/pc.service";
import { isPcInventoryEnabled } from "../production-control/pc.repository";
import type {
    PcOrderInventoryState,
    PcProduct,
} from "../production-control/pc.types";
import { getLarkNumber, getLarkText } from "../../utils/lark-field-value";
import { OperationalError } from "../../utils/errors";
import type {
    DemoShopCatalog,
    DemoShopOrderResult,
    DemoShopProduct,
} from "./demo-shop.types";

const DEMO_CUSTOMER_CHANNEL_ID = "pc_demo_shop_customer";
const DEMO_CUSTOMER_NAME = "Demo Shop Customer";
const DEMO_PHONE = "0800000000";
const DEMO_ADDRESS = "88 Demo Atelier Road, Bangkok 10110";
const DEMO_OWNER = "Demo Shop";
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

export function isDemoShopEnabled(env: Env): boolean {
    return env.PC_DEMO_SHOP_ENABLED?.trim().toLowerCase() === "true";
}

export function assertDemoShopSafeMode(env: Env): void {
    if (!isDemoShopEnabled(env)) {
        throw demoError(
            "DEMO_SHOP_DISABLED",
            "Demo Shop is disabled",
            503
        );
    }

    if (isPcInventoryEnabled(env)) {
        throw demoError(
            "DEMO_SHOP_UNSAFE_WITH_LIVE_PC",
            "Demo Shop cannot run while live PC inventory processing is enabled",
            503
        );
    }

    if (
        !env.PC_PRODUCTS_TABLE_ID?.trim() ||
        !env.PC_MATERIALS_TABLE_ID?.trim() ||
        !env.PC_PRODUCTION_TABLE_ID?.trim()
    ) {
        throw demoError(
            "DEMO_SHOP_PC_CONFIGURATION_MISSING",
            "Demo Shop product configuration is incomplete",
            503
        );
    }
}

function sanitizeProduct(product: PcProduct): DemoShopProduct {
    return {
        sku: product.sku,
        product_name: product.product_name,
        category: product.category,
        style_code: product.style_code,
        color: product.color,
        size: product.size,
        price_thb: product.sales_price_thb,
        stock_on_hand: product.stock_on_hand,
        stock_status: product.stock_status,
    };
}

function compareProducts(left: DemoShopProduct, right: DemoShopProduct): number {
    return (
        left.product_name.localeCompare(right.product_name, "th") ||
        left.style_code.localeCompare(right.style_code, "en") ||
        left.color.localeCompare(right.color, "th") ||
        left.size.localeCompare(right.size, "en") ||
        left.sku.localeCompare(right.sku, "en")
    );
}

export async function getDemoShopCatalog(env: Env): Promise<DemoShopCatalog> {
    assertDemoShopSafeMode(env);
    const overview = await getPcOverview(env);

    return {
        products: overview.products
            .filter((product) => product.active && product.sku.trim())
            .map(sanitizeProduct)
            .sort(compareProducts),
        updated_at: new Date().toISOString(),
    };
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

function generateDemoOrderNumber(now = new Date()): string {
    const stamp = now
        .toISOString()
        .replace(/[-:TZ.]/g, "")
        .slice(0, 14);
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
    return `DEMO-${stamp}-${suffix}`;
}

async function ensureDemoCustomer(
    env: Env,
    product: PcProduct,
    quantity: number
): Promise<LarkCustomerRecord> {
    const existing = await findCustomerByChannelCustomerId(
        env,
        "LINE",
        DEMO_CUSTOMER_CHANNEL_ID
    );

    if (existing) {
        return await updateCustomer(env, existing.record_id, {
            customer_name: DEMO_CUSTOMER_NAME,
            phone: DEMO_PHONE,
            current_stage: "Closing",
            buyer_intent: "Ready To Buy",
            lead_score: 100,
            hot_lead: true,
            ai_summary: "Demo Shop order simulation",
            last_message: `สั่งซื้อ ${product.product_name} ${product.size} จำนวน ${quantity} ชิ้น`,
            product_name: product.product_name,
            product_size: product.size,
            product_qty: quantity,
            product_unit: "ชิ้น",
            sales_owner: DEMO_OWNER,
        });
    }

    return await createCustomer(env, {
        channel: "LINE",
        channel_customer_id: DEMO_CUSTOMER_CHANNEL_ID,
        customer_name: DEMO_CUSTOMER_NAME,
        phone: DEMO_PHONE,
        current_stage: "Closing",
        buyer_intent: "Ready To Buy",
        lead_score: 100,
        hot_lead: true,
        ai_summary: "Demo Shop order simulation",
        last_message: `สั่งซื้อ ${product.product_name} ${product.size} จำนวน ${quantity} ชิ้น`,
        message_count: 1,
        product_name: product.product_name,
        product_size: product.size,
        product_qty: quantity,
        product_unit: "ชิ้น",
        pending_payment: false,
        pending_slip_amount: 0,
        pending_slip_bank: "",
        pending_slip_image_url: "",
        pending_slip_attachment_tokens: [],
        sales_owner: DEMO_OWNER,
    });
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

function demoPcEnv(env: Env): Env {
    return {
        ...env,
        PC_INVENTORY_ENABLED: "true",
    };
}

function findSelectedProduct(products: PcProduct[], sku: string): PcProduct {
    const normalizedSku = sku.trim().toLowerCase();
    const product = products.find(
        (item) => item.active && item.sku.trim().toLowerCase() === normalizedSku
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

function resultFromState(input: {
    orderRecordId: string;
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
        (item) => item.sku.trim().toLowerCase() === input.product.sku.trim().toLowerCase()
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
            stock_after: transition?.new_stock_on_hand ?? input.currentStock,
            stock_delta:
                transition === undefined
                    ? null
                    : transition.new_stock_on_hand - transition.old_stock_on_hand,
        },
        production: {
            created_or_updated: input.productionIds.length > 0,
            production_ids: input.productionIds,
            batches,
        },
        completed_at: new Date().toISOString(),
    };
}

export async function createDemoShopOrder(
    env: Env,
    input: {
        sku: string;
        quantity: unknown;
        idempotency_key: string;
    }
): Promise<DemoShopOrderResult> {
    assertDemoShopSafeMode(env);
    const idempotencyKey = normalizeIdempotencyKey(input.idempotency_key);
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
    const productBefore = findSelectedProduct(beforeOverview.products, sku);
    const externalOrderId = `demo-shop:${idempotencyKey}`;
    const existingOrder = await findOrderByChannelAndExternalId(
        env,
        "LINE",
        externalOrderId
    );

    if (existingOrder) {
        const existingProductName = getLarkText(
            existingOrder.fields[ORDER_FIELDS.PRODUCT_NAME]
        ).trim();
        const existingSize = getLarkText(
            existingOrder.fields[ORDER_FIELDS.PRODUCT_SIZE]
        ).trim();
        const existingQuantity = getLarkNumber(
            existingOrder.fields[ORDER_FIELDS.QUANTITY]
        );

        if (
            existingProductName !== productBefore.product_name ||
            existingSize !== productBefore.size ||
            existingQuantity !== quantity
        ) {
            throw demoError(
                "DEMO_SHOP_IDEMPOTENCY_CONFLICT",
                "Idempotency-Key นี้ถูกใช้กับคำสั่งซื้อที่มีสินค้า หรือจำนวนต่างกันแล้ว",
                409
            );
        }

        const inventory = await reconcileOrderInventory(
            demoPcEnv(env),
            existingOrder.record_id
        );
        const afterOverview = await getPcOverview(env);
        const productAfter = findSelectedProduct(afterOverview.products, sku);
        const refreshedOrder = await findOrderByChannelAndExternalId(
            env,
            "LINE",
            externalOrderId
        );
        const state = parseInventoryState(
            refreshedOrder?.fields[ORDER_FIELDS.PC_INVENTORY_STATE_JSON] ??
                existingOrder.fields[ORDER_FIELDS.PC_INVENTORY_STATE_JSON]
        );
        const existingProductionIds = afterOverview.production
            .filter((batch) => batch.source_order_id === existingOrder.record_id)
            .map((batch) => batch.production_id)
            .filter(Boolean);
        const productionIds = [
            ...new Set([
                ...inventory.production_ids,
                ...existingProductionIds,
            ]),
        ];

        return resultFromState({
            orderRecordId: existingOrder.record_id,
            orderNumber: getLarkText(
                existingOrder.fields[ORDER_FIELDS.ORDER_NUMBER],
                "DEMO"
            ),
            product: productBefore,
            quantity,
            state,
            currentStock: productAfter.stock_on_hand,
            productionIds,
            batches: afterOverview.production,
            duplicate: true,
        });
    }

    const customer = await ensureDemoCustomer(env, productBefore, quantity);
    const pipeline = await createOpenPipelineForCustomer(env, {
        customer_record_id: customer.record_id,
        stage: "Closing",
        lead_score: 100,
        ai_summary: "Demo Shop order simulation",
        sales_owner: DEMO_OWNER,
    });
    const orderNumber = generateDemoOrderNumber();
    const order = await createOrder(env, {
        order_number: orderNumber,
        customer_record_id: customer.record_id,
        pipeline_record_id: pipeline.record_id,
        channel: "LINE",
        external_order_id: externalOrderId,
        customer_name: DEMO_CUSTOMER_NAME,
        phone: DEMO_PHONE,
        address: DEMO_ADDRESS,
        product_name: productBefore.product_name,
        product_size: productBefore.size,
        product_unit: "ชิ้น",
        quantity,
        total_amount: Math.max(0, productBefore.sales_price_thb) * quantity,
        payment_status: "Waiting Payment",
        payment_verified: false,
        order_status: "Waiting Payment",
        sales_owner: DEMO_OWNER,
        payment_due_at: Date.now() + 24 * 60 * 60 * 1000,
        currency: "THB",
    });

    await updateCustomer(env, customer.record_id, {
        active_pipeline_id: pipeline.record_id,
        active_order_id: order.record_id,
    });

    const verified = await applyManualPaymentVerification(
        env,
        order,
        customer,
        pipeline
    );

    if (!verified?.order) {
        throw demoError(
            "DEMO_SHOP_PAYMENT_VERIFICATION_FAILED",
            "Demo order could not be marked as paid",
            409
        );
    }

    const inventory = await reconcileOrderInventory(
        demoPcEnv(env),
        verified.order.record_id
    );
    const afterOverview = await getPcOverview(env);
    const productAfter = findSelectedProduct(afterOverview.products, sku);
    const refreshedOrder = await findOrderByChannelAndExternalId(
        env,
        "LINE",
        externalOrderId
    );
    const state = parseInventoryState(
        refreshedOrder?.fields[ORDER_FIELDS.PC_INVENTORY_STATE_JSON]
    );

    return resultFromState({
        orderRecordId: verified.order.record_id,
        orderNumber,
        product: productBefore,
        quantity,
        state,
        currentStock: productAfter.stock_on_hand,
        productionIds: inventory.production_ids,
        batches: afterOverview.production,
        duplicate: inventory.duplicate,
    });
}
