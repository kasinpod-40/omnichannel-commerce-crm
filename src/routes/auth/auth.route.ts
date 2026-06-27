import type { Env } from "../../config/env";
import {
    getDashboardUrl,
    getLarkRedirectUri,
    sanitizeReturnTo,
} from "../../modules/auth/auth.config";
import { AuthError, isAuthError } from "../../modules/auth/auth.error";
import {
    createOAuthState,
    verifyAuthSession,
    verifyOAuthState,
} from "../../modules/auth/auth.session";
import { authenticateWithLarkCode } from "../../modules/auth/auth.service";
import {
    OAUTH_STATE_COOKIE_NAME,
    clearOAuthStateCookie,
    clearSessionCookie,
    createOAuthStateCookie,
    createSessionCookie,
    getCookie,
} from "./auth-cookie";
import { getDashboardSessionToken } from "./auth-session-token";
import {
    addAuthCorsHeaders,
    assertAllowedOrigin,
    readJsonObject,
} from "./auth-http";

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
    return Response.json(data, {
        status,
        headers: {
            "Cache-Control": "no-store",
            ...headers,
        },
    });
}

function methodNotAllowed(allowed: string): Response {
    return json(
        {
            ok: false,
            code: "METHOD_NOT_ALLOWED",
            message: "Method not allowed",
        },
        405,
        { Allow: allowed }
    );
}

function createLarkAuthorizeUrl(
    env: Env,
    state: string
): string {
    const url = new URL(
        "https://open.larksuite.com/open-apis/authen/v1/authorize"
    );
    url.searchParams.set("app_id", env.LARK_APP_ID);
    url.searchParams.set("redirect_uri", getLarkRedirectUri(env));
    url.searchParams.set("state", state);

    return url.toString();
}

function createDashboardRedirect(
    env: Env,
    returnTo: string
): string {
    return new URL(returnTo, getDashboardUrl(env)).toString();
}

function createLoginErrorRedirect(env: Env, code: string): string {
    const url = new URL("/login", getDashboardUrl(env));
    url.searchParams.set("larkClientError", "1");
    url.searchParams.set("reason", code);
    return url.toString();
}

function logAuthError(error: unknown, route: string): void {
    if (isAuthError(error)) {
        console.error("Authentication error", {
            route,
            code: error.code,
            status: error.status,
            message: error.message,
        });
        return;
    }

    console.error("Unexpected authentication error", {
        route,
        error: error instanceof Error ? error.message : String(error),
    });
}

function authErrorResponse(error: unknown): Response {
    const normalized = isAuthError(error)
        ? error
        : new AuthError(
              "AUTH_INTERNAL_ERROR",
              "Authentication service failed",
              500,
              error
          );

    // Error 5xx ส่งข้อความกลางเพื่อไม่เปิดเผย Config หรือข้อมูลจาก Lark
    const message =
        normalized.status >= 500
            ? "Authentication service is unavailable"
            : normalized.message;

    return json(
        {
            ok: false,
            code: normalized.code,
            message,
        },
        normalized.status
    );
}

/** GET /auth/lark/client-config: คืนค่า public app id สำหรับ requestAccess ใน Lark WebView */
export function handleLarkClientConfig(
    request: Request,
    env: Env
): Response {
    if (request.method !== "GET") {
        return addAuthCorsHeaders(
            methodNotAllowed("GET"),
            request,
            env
        );
    }

    return addAuthCorsHeaders(
        json({ app_id: env.LARK_APP_ID }),
        request,
        env
    );
}

/** GET /auth/lark/login: สร้าง OAuth state และ Redirect Browser ไปหน้า Lark */
export async function handleLarkBrowserLogin(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return methodNotAllowed("GET");
    }

    try {
        const returnTo = sanitizeReturnTo(
            new URL(request.url).searchParams.get("return_to")
        );
        const state = await createOAuthState(env, returnTo);

        const headers = new Headers({
            Location: createLarkAuthorizeUrl(env, state.token),
            "Cache-Control": "no-store",
        });
        // เริ่ม Login ใหม่จาก Cookie ที่สะอาดเสมอ โดยเฉพาะหลัง Session เดิมหมดอายุ
        headers.append("Set-Cookie", clearSessionCookie(request, env));
        headers.append(
            "Set-Cookie",
            createOAuthStateCookie(request, env, state.token)
        );

        return new Response(null, { status: 302, headers });
    } catch (error) {
        logAuthError(error, "/auth/lark/login");
        return authErrorResponse(error);
    }
}

/** GET /auth/lark/callback: ตรวจ state, แลก code, ตั้ง Session Cookie และกลับ Dashboard */
export async function handleLarkBrowserCallback(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return methodNotAllowed("GET");
    }

    try {
        const url = new URL(request.url);
        const stateToken = url.searchParams.get("state") ?? "";
        const stateCookie = getCookie(request, OAUTH_STATE_COOKIE_NAME);

        if (!stateCookie || stateCookie !== stateToken) {
            throw new AuthError(
                "AUTH_STATE_MISMATCH",
                "OAuth state does not match the login request",
                400
            );
        }

        const state = await verifyOAuthState(env, stateToken);
        const result = await authenticateWithLarkCode(
            env,
            url.searchParams.get("code") ?? ""
        );
        const headers = new Headers({
            Location: createDashboardRedirect(env, state.return_to),
            "Cache-Control": "no-store",
        });
        headers.append(
            "Set-Cookie",
            createSessionCookie(request, env, result.token)
        );
        headers.append(
            "Set-Cookie",
            clearOAuthStateCookie(request, env)
        );

        return new Response(null, { status: 302, headers });
    } catch (error) {
        logAuthError(error, "/auth/lark/callback");
        const code = isAuthError(error)
            ? error.code
            : "AUTH_INTERNAL_ERROR";

        try {
            const headers = new Headers({
                Location: createLoginErrorRedirect(env, code),
                "Cache-Control": "no-store",
            });
            headers.append(
                "Set-Cookie",
                clearOAuthStateCookie(request, env)
            );

            return new Response(null, { status: 302, headers });
        } catch (redirectError) {
            // หาก DASHBOARD_URL ยังไม่ถูกตั้ง จะตอบ JSON 500 แทนการเกิด Error ซ้อนใน Catch
            logAuthError(redirectError, "/auth/lark/callback-error-redirect");
            return authErrorResponse(error);
        }
    }
}

/** POST /auth/lark/client-session: รับ code จาก tt.requestAccess และคืน Session ให้ React */
export async function handleLarkClientSession(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return addAuthCorsHeaders(
            methodNotAllowed("POST"),
            request,
            env
        );
    }

    try {
        assertAllowedOrigin(request, env);
        const body = await readJsonObject(request);
        const code = typeof body.code === "string" ? body.code : "";
        const result = await authenticateWithLarkCode(env, code);
        const response = json(
            {
                ...result.response,
                session_token: result.token,
            },
            200,
            {
                "Set-Cookie": createSessionCookie(
                    request,
                    env,
                    result.token
                ),
            }
        );

        return addAuthCorsHeaders(response, request, env);
    } catch (error) {
        logAuthError(error, "/auth/lark/client-session");
        return addAuthCorsHeaders(
            authErrorResponse(error),
            request,
            env
        );
    }
}

/** GET /auth/me: ตรวจลายเซ็นและอายุ Cookie ก่อนคืนผู้ใช้ปัจจุบัน */
export async function handleAuthMe(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return addAuthCorsHeaders(
            methodNotAllowed("GET"),
            request,
            env
        );
    }

    try {
        const token = getDashboardSessionToken(request);

        if (!token) {
            throw new AuthError(
                "AUTH_SESSION_MISSING",
                "Dashboard session is missing",
                401
            );
        }

        const session = await verifyAuthSession(env, token);
        return addAuthCorsHeaders(
            json({
                user: session.user,
                expires_at: new Date(
                    session.expires_at * 1_000
                ).toISOString(),
            }),
            request,
            env
        );
    } catch (error) {
        const response = authErrorResponse(error);
        const headers = new Headers(response.headers);

        if (isAuthError(error) && error.status === 401) {
            headers.append(
                "Set-Cookie",
                clearSessionCookie(request, env)
            );
        }

        return addAuthCorsHeaders(
            new Response(response.body, {
                status: response.status,
                headers,
            }),
            request,
            env
        );
    }
}

/** POST /auth/logout: ตรวจ Origin แล้วล้าง HttpOnly Session Cookie */
export async function handleAuthLogout(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return addAuthCorsHeaders(
            methodNotAllowed("POST"),
            request,
            env
        );
    }

    try {
        assertAllowedOrigin(request, env);
        return addAuthCorsHeaders(
            new Response(null, {
                status: 204,
                headers: {
                    "Cache-Control": "no-store",
                    "Set-Cookie": clearSessionCookie(request, env),
                },
            }),
            request,
            env
        );
    } catch (error) {
        return addAuthCorsHeaders(
            authErrorResponse(error),
            request,
            env
        );
    }
}
