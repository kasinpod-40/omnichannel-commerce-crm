import type { Env } from "../../config/env";
import { AuthError, isAuthError } from "../../modules/auth/auth.error";
import { verifyAuthSession } from "../../modules/auth/auth.session";
import type { DashboardLanguage } from "../../modules/dashboard-read/dashboard-read.types";
import {
    clearSessionCookie,
} from "../auth/auth-cookie";
import { getDashboardSessionToken } from "../auth/auth-session-token";
import {
    addAuthCorsHeaders,
    handleAuthPreflight,
} from "../auth/auth-http";

export function dashboardJson(data: unknown, status = 200): Response {
    return Response.json(data, {
        status,
        headers: { "Cache-Control": "no-store" },
    });
}

export async function assertDashboardSession(
    request: Request,
    env: Env
): Promise<void> {
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

export function parseDashboardLanguage(request: Request): DashboardLanguage {
    return new URL(request.url).searchParams.get("lang") === "en" ? "en" : "th";
}

export function parsePositiveInteger(
    value: string | null,
    fallback: number,
    maximum: number
): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, maximum);
}

export function parseBoolean(value: string | null): boolean | null {
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
}

export function dashboardApiErrorResponse(
    request: Request,
    env: Env,
    error: unknown,
    options: {
        code: string;
        publicMessage: string;
        logLabel: string;
    }
): Response {
    const normalized = isAuthError(error)
        ? error
        : new AuthError(options.code, options.publicMessage, 500, error);
    const headers = new Headers({
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
    });

    if (normalized.status === 401) {
        headers.append("Set-Cookie", clearSessionCookie(request, env));
    }

    if (!isAuthError(error)) {
        console.error(options.logLabel, {
            error: error instanceof Error ? error.message : String(error),
        });
    }

    return addAuthCorsHeaders(
        new Response(
            JSON.stringify({
                code: normalized.code,
                message: normalized.status >= 500
                    ? options.publicMessage
                    : normalized.message,
            }),
            { status: normalized.status, headers }
        ),
        request,
        env
    );
}

export function dashboardMethodNotAllowed(
    request: Request,
    env: Env
): Response {
    return addAuthCorsHeaders(
        dashboardJson({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed" }, 405),
        request,
        env
    );
}

export function dashboardPreflight(
    request: Request,
    env: Env
): Response {
    try {
        return handleAuthPreflight(request, env);
    } catch {
        return Response.json(
            {
                code: "AUTH_ORIGIN_FORBIDDEN",
                message: "Request origin is not allowed",
            },
            { status: 403 }
        );
    }
}
