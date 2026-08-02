import type { Env } from "../../config/env";
import { AuthError } from "../../modules/auth/auth.error";
import {
    createDemoShopOrder,
    getDemoShopCatalog,
    isDemoShopEnabled,
} from "../../modules/demo-shop/demo-shop.service";
import { renderDemoShopHtml } from "../../modules/demo-shop/demo-shop-html";
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

function htmlResponse(html: string, nonce: string): Response {
    return new Response(html, {
        status: 200,
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": [
                "default-src 'none'",
                `style-src 'nonce-${nonce}'`,
                `script-src 'nonce-${nonce}'`,
                "connect-src 'self'",
                "img-src 'self' data:",
                "font-src 'self'",
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
        return addAuthCorsHeaders(
            dashboardJson(await getDemoShopCatalog(env)),
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

        if (session.user.role !== "admin" && session.user.role !== "manager") {
            throw new AuthError(
                "DEMO_SHOP_PERMISSION_DENIED",
                "This account cannot create Demo Shop orders",
                403
            );
        }

        const body = await readJsonObject(request);
        const idempotencyKey =
            request.headers.get("Idempotency-Key")?.trim() || "";
        const result = await createDemoShopOrder(env, {
            sku: typeof body.sku === "string" ? body.sku : "",
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
