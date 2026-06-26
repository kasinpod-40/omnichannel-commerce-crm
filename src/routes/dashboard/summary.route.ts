import type { Env } from "../../config/env";
import { AuthError, isAuthError } from "../../modules/auth/auth.error";
import { verifyAuthSession } from "../../modules/auth/auth.session";
import {
    getCommerceDashboardSummary,
    type DashboardLanguage,
} from "../../modules/dashboard/commerce-dashboard.service";
import {
    clearSessionCookie,
    getCookie,
    SESSION_COOKIE_NAME,
} from "../auth/auth-cookie";
import { addAuthCorsHeaders } from "../auth/auth-http";

function json(data: unknown, status = 200): Response {
    return Response.json(data, {
        status,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}

function parseLanguage(request: Request): DashboardLanguage {
    return new URL(request.url).searchParams.get("lang") === "en"
        ? "en"
        : "th";
}

/** ตรวจ HttpOnly Session ก่อนให้หน้า Dashboard อ่านข้อมูล Lark Base */
async function assertDashboardSession(
    request: Request,
    env: Env
): Promise<void> {
    const token = getCookie(request, SESSION_COOKIE_NAME);

    if (!token) {
        throw new AuthError(
            "AUTH_SESSION_MISSING",
            "Dashboard session is missing",
            401
        );
    }

    await verifyAuthSession(env, token);
}

function errorResponse(
    request: Request,
    env: Env,
    error: unknown
): Response {
    const normalized = isAuthError(error)
        ? error
        : new AuthError(
              "DASHBOARD_SUMMARY_FAILED",
              "Dashboard summary is unavailable",
              500,
              error
          );
    const headers = new Headers({
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
    });

    // Session ที่ไม่ถูกต้องต้องถูกล้าง เพื่อให้ AuthGuard พากลับไป Login ได้ถูกต้อง
    if (normalized.status === 401) {
        headers.append(
            "Set-Cookie",
            clearSessionCookie(request, env)
        );
    }

    if (!isAuthError(error)) {
        console.error("Dashboard summary failed", {
            error:
                error instanceof Error
                    ? error.message
                    : String(error),
        });
    }

    return addAuthCorsHeaders(
        new Response(
            JSON.stringify({
                code: normalized.code,
                message:
                    normalized.status >= 500
                        ? "Dashboard summary is unavailable"
                        : normalized.message,
            }),
            { status: normalized.status, headers }
        ),
        request,
        env
    );
}

/** GET /dashboard/summary: Contract ตรงกับ DashboardSummaryResponse ของ React */
export async function handleCommerceDashboardSummary(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return addAuthCorsHeaders(
            json(
                {
                    code: "METHOD_NOT_ALLOWED",
                    message: "Method not allowed",
                },
                405
            ),
            request,
            env
        );
    }

    try {
        await assertDashboardSession(request, env);
        const summary = await getCommerceDashboardSummary(
            env,
            parseLanguage(request)
        );

        return addAuthCorsHeaders(json(summary), request, env);
    } catch (error) {
        return errorResponse(request, env, error);
    }
}
