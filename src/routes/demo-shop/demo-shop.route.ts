import type { Env } from "../../config/env";
import { AuthError } from "../../modules/auth/auth.error";
import {
    getDemoShopCatalog,
    isDemoShopEnabled,
} from "../../modules/demo-shop/demo-shop.service";
import { createDemoShopShopeeOrder } from "../../modules/demo-shop/demo-shop-shopee.service";
import { retryDemoShopLowStockNotification } from "../../modules/demo-shop/demo-shop-low-stock-retry.service";
import { renderDemoShopHtml } from "../../modules/demo-shop/demo-shop-html";
import { getPcOverview } from "../../modules/production-control/pc.service";
import type { PcProductionBatch } from "../../modules/production-control/pc.types";
import { OperationalError } from "../../utils/errors";
import {
    addAuthCorsHeaders,
    assertAllowedOrigin,
    readJsonObject,
} from "../auth/auth-http";
import {
    assertDashboardSession,
    dashboardApiErrorResponse,
    dashboardJson,
    dashboardMethodNotAllowed,
} from "../shared/dashboard-api";

// หน้า Demo แสดงเฉพาะสถานะที่มีผลกับการผลิตจริงแล้ว
// RECOMMENDED และ APPROVED เป็นสถานะภายใน/ชั่วคราว จึงไม่ควรทำให้ผู้สาธิตเข้าใจว่าอนุมัติแล้ว
const VISIBLE_PRODUCTION = new Set([
    "IN_PROGRESS",
    "BLOCKED_MATERIAL",
]);

function demoShopErrorResponse(
    request: Request,
    env: Env,
    error: unknown
): Response {
    const normalized =
        error instanceof OperationalError
            ? new AuthError(
                  error.code,
                  error.message,
                  error.status ?? 500,
                  error
              )
            : error;

    return dashboardApiErrorResponse(request, env, normalized, {
        code: "DEMO_SHOP_REQUEST_FAILED",
        publicMessage: "Demo Shop is unavailable",
        logLabel: "Demo Shop API failed",
    });
}

function demoShopCatalogEnv(env: Env): Env {
    return {
        ...env,
        PC_INVENTORY_ENABLED: "false",
    };
}

function normalizeKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function productionRank(batch: PcProductionBatch): number {
    return batch.production_status === "IN_PROGRESS" ? 2 : 1;
}

function visibleProductionBySku(
    production: PcProductionBatch[]
): Map<string, PcProductionBatch> {
    const result = new Map<string, PcProductionBatch>();

    for (const batch of production) {
        if (!VISIBLE_PRODUCTION.has(batch.production_status)) continue;
        const key = normalizeKey(batch.product_sku);
        const current = result.get(key);

        if (
            !current ||
            productionRank(batch) > productionRank(current) ||
            (productionRank(batch) === productionRank(current) &&
                batch.created_at > current.created_at)
        ) {
            result.set(key, batch);
        }
    }

    return result;
}

function htmlResponse(html: string, nonce: string): Response {
    return new Response(html, {
        status: 200,
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": [
                "default-src 'none'",
                `style-src 'nonce-${nonce}' https://fonts.googleapis.com`,
                `script-src 'nonce-${nonce}'`,
                "connect-src 'self'",
                "img-src 'self' data:",
                "font-src https://fonts.gstatic.com",
                "base-uri 'none'",
                "form-action 'none'",
                "frame-ancestors 'self'",
            ].join("; "),
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "SAMEORIGIN",
            "Permissions-Policy":
                "camera=(), microphone=(), geolocation=(), payment=()",
        },
    });
}

function assertDemoOperator(role: string): void {
    if (role !== "admin" && role !== "manager") {
        throw new AuthError(
            "DEMO_SHOP_PERMISSION_DENIED",
            "This account cannot operate Demo Shop orders",
            403
        );
    }
}

async function assertDemoStockAvailable(
    env: Env,
    sku: string,
    quantity: unknown
): Promise<void> {
    const normalizedSku = sku.trim().toLowerCase();
    const requestedQuantity = Number(quantity);

    if (
        !normalizedSku ||
        !Number.isInteger(requestedQuantity) ||
        requestedQuantity <= 0
    ) {
        return;
    }

    const catalog = await getDemoShopCatalog(demoShopCatalogEnv(env));
    const product = catalog.products.find(
        (item) => item.sku.trim().toLowerCase() === normalizedSku
    );

    if (!product) {
        throw new OperationalError(
            "DEMO_SHOP_PRODUCT_NOT_FOUND",
            "ไม่พบสินค้าที่เลือกใน Demo Shop",
            { retryable: false, status: 404 }
        );
    }

    const availableStock = Math.max(
        0,
        Math.floor(Number(product.stock_on_hand) || 0)
    );

    if (availableStock <= 0) {
        throw new OperationalError(
            "DEMO_SHOP_OUT_OF_STOCK",
            "สินค้านี้หมดแล้ว กรุณาเลือกสินค้า หรือไซซ์อื่น",
            { retryable: false, status: 409 }
        );
    }

    if (requestedQuantity > availableStock) {
        throw new OperationalError(
            "DEMO_SHOP_INSUFFICIENT_STOCK",
            `สินค้าคงเหลือ ${availableStock} ชิ้น กรุณาลดจำนวนที่สั่ง`,
            { retryable: false, status: 409 }
        );
    }
}

export function handleDemoShopPage(
    request: Request,
    env: Env
): Response {
    if (request.method !== "GET") {
        return new Response("Method not allowed", {
            status: 405,
            headers: { Allow: "GET" },
        });
    }

    if (!isDemoShopEnabled(env)) {
        return new Response("Not found", { status: 404 });
    }

    const nonce = crypto.randomUUID().replace(/-/g, "");
    return htmlResponse(
        renderDemoShopHtml({
            dashboardUrl: env.DASHBOARD_URL,
            nonce,
        }),
        nonce
    );
}

export async function handleDemoShopProducts(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return dashboardMethodNotAllowed(request, env);
    }

    try {
        await assertDashboardSession(request, env);
        const catalogEnv = demoShopCatalogEnv(env);
        const [catalog, overview] = await Promise.all([
            getDemoShopCatalog(catalogEnv),
            getPcOverview(catalogEnv),
        ]);
        const productionBySku = visibleProductionBySku(overview.production);

        return addAuthCorsHeaders(
            dashboardJson({
                ...catalog,
                products: catalog.products.map((product) => {
                    const batch = productionBySku.get(
                        normalizeKey(product.sku)
                    );
                    return {
                        ...product,
                        production_status: batch?.production_status ?? null,
                        production_qty: batch
                            ? Math.max(
                                  0,
                                  batch.planned_qty || batch.recommended_qty
                              )
                            : 0,
                        production_id: batch?.production_id ?? "",
                    };
                }),
            }),
            request,
            env
        );
    } catch (error) {
        return demoShopErrorResponse(request, env, error);
    }
}

export async function handleDemoShopOrderCreate(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return dashboardMethodNotAllowed(request, env);
    }

    try {
        assertAllowedOrigin(request, env);
        const session = await assertDashboardSession(request, env);
        assertDemoOperator(session.user.role);
        const body = await readJsonObject(request);
        const idempotencyKey =
            request.headers.get("Idempotency-Key")?.trim() || "";
        const sku = typeof body.sku === "string" ? body.sku : "";

        await assertDemoStockAvailable(env, sku, body.quantity);

        const result = await createDemoShopShopeeOrder(env, {
            sku,
            quantity: body.quantity,
            idempotency_key: idempotencyKey,
        });

        return addAuthCorsHeaders(
            dashboardJson(result, result.duplicate ? 200 : 201),
            request,
            env
        );
    } catch (error) {
        return demoShopErrorResponse(request, env, error);
    }
}

export async function handleDemoShopLowStockRetry(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return dashboardMethodNotAllowed(request, env);
    }

    try {
        assertAllowedOrigin(request, env);
        const session = await assertDashboardSession(request, env);
        assertDemoOperator(session.user.role);
        const body = await readJsonObject(request);
        const result = await retryDemoShopLowStockNotification(
            env,
            typeof body.order_number === "string"
                ? body.order_number
                : ""
        );

        return addAuthCorsHeaders(
            dashboardJson(result),
            request,
            env
        );
    } catch (error) {
        return demoShopErrorResponse(request, env, error);
    }
}
