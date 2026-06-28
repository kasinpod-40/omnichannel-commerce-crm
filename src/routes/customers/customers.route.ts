import type { Env } from "../../config/env";
import { isSalesStage } from "../../core/sales-stage";
import { AuthError, isAuthError } from "../../modules/auth/auth.error";
import { verifyAuthSession } from "../../modules/auth/auth.session";
import {
    getCustomerDetail,
    getCustomerList,
    type CustomerDashboardLanguage,
    type CustomerListQuery,
} from "../../modules/customers/customer-dashboard.service";
import {
    clearSessionCookie,
} from "../auth/auth-cookie";
import { getDashboardSessionToken } from "../auth/auth-session-token";
import { addAuthCorsHeaders } from "../auth/auth-http";

function json(data: unknown, status = 200): Response {
    return Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

/** Customers API ใช้ Session เดียวกับ Dashboard และไม่ยอมให้เรียกข้อมูล Lark แบบ anonymous */
async function assertCustomerSession(request: Request, env: Env): Promise<void> {
    const token = getDashboardSessionToken(request);

    if (!token) {
        throw new AuthError(
            "AUTH_SESSION_MISSING",
            "Dashboard session is missing",
            401
        );
    }

    await verifyAuthSession(env, token);
}

function parsePositiveInteger(
    value: string | null,
    fallback: number,
    maximum: number
): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, maximum);
}

function parseBoolean(value: string | null): boolean | null {
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
}

function parseLanguage(request: Request): CustomerDashboardLanguage {
    return new URL(request.url).searchParams.get("lang") === "en" ? "en" : "th";
}

/** แปลง Query String จาก Frontend และ whitelist sort เพื่อไม่ส่งค่าที่ไม่รู้จักเข้า Service */
function parseListQuery(request: Request): CustomerListQuery {
    const searchParams = new URL(request.url).searchParams;
    const rawSort = searchParams.get("sort");
    const sort =
        rawSort === "lead_score_desc" ||
        rawSort === "name_asc" ||
        rawSort === "updated_desc"
            ? rawSort
            : "updated_desc";

    const rawChannel = searchParams.get("channel");
    const rawStage = searchParams.get("stage");
    const allowedChannels = new Set(["LINE", "Shopee", "Lazada", "TikTok Shop"]);

    return {
        search: searchParams.get("search") ?? "",
        channel: rawChannel && allowedChannels.has(rawChannel) ? rawChannel : null,
        stage: isSalesStage(rawStage) ? rawStage : null,
        hot_lead: parseBoolean(searchParams.get("hot_lead")),
        sort,
        page: parsePositiveInteger(searchParams.get("page"), 1, 100_000),
        page_size: parsePositiveInteger(
            searchParams.get("page_size"),
            10,
            100
        ),
    };
}

function errorResponse(request: Request, env: Env, error: unknown): Response {
    const normalized = isAuthError(error)
        ? error
        : new AuthError(
              "CUSTOMERS_READ_FAILED",
              "Customer data is unavailable",
              500,
              error
          );
    const headers = new Headers({
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
    });

    if (normalized.status === 401) {
        headers.append("Set-Cookie", clearSessionCookie(request, env));
    }

    if (!isAuthError(error)) {
        console.error("Customers API failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    }

    return addAuthCorsHeaders(
        new Response(
            JSON.stringify({
                code: normalized.code,
                message:
                    normalized.status >= 500
                        ? "Customer data is unavailable"
                        : normalized.message,
            }),
            { status: normalized.status, headers }
        ),
        request,
        env
    );
}

/** GET /customers: รายการลูกค้าพร้อม Search, Filter, Sort และ Pagination */
export async function handleCustomerList(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return addAuthCorsHeaders(
            json({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed" }, 405),
            request,
            env
        );
    }

    try {
        await assertCustomerSession(request, env);
        const result = await getCustomerList(env, parseListQuery(request));
        return addAuthCorsHeaders(json(result), request, env);
    } catch (error) {
        return errorResponse(request, env, error);
    }
}

/** GET /customers/:customerId: Customer 360° พร้อม Timeline ที่เกี่ยวข้อง */
export async function handleCustomerDetail(
    request: Request,
    env: Env,
    customerId: string
): Promise<Response> {
    if (request.method !== "GET") {
        return addAuthCorsHeaders(
            json({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed" }, 405),
            request,
            env
        );
    }

    try {
        await assertCustomerSession(request, env);
        const result = await getCustomerDetail(
            env,
            decodeURIComponent(customerId),
            parseLanguage(request)
        );

        if (!result) {
            return addAuthCorsHeaders(
                json(
                    {
                        code: "CUSTOMER_NOT_FOUND",
                        message: "Customer was not found",
                    },
                    404
                ),
                request,
                env
            );
        }

        return addAuthCorsHeaders(json(result), request, env);
    } catch (error) {
        return errorResponse(request, env, error);
    }
}
