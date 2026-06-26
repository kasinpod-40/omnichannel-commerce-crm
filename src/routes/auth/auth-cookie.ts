import type { Env } from "../../config/env";
import {
    getCookieSameSite,
    getSessionTtlSeconds,
} from "../../modules/auth/auth.config";

export const SESSION_COOKIE_NAME = "crm_session";
export const OAUTH_STATE_COOKIE_NAME = "crm_oauth_state";

/** อ่าน Cookie แบบไม่พึ่ง Library เพื่อให้ทำงานตรงใน Cloudflare Workers */
export function getCookie(request: Request, name: string): string | null {
    const header = request.headers.get("Cookie") ?? "";

    for (const part of header.split(";")) {
        const separator = part.indexOf("=");

        if (separator < 0) {
            continue;
        }

        const key = part.slice(0, separator).trim();

        if (key === name) {
            return decodeURIComponent(part.slice(separator + 1).trim());
        }
    }

    return null;
}

function shouldUseSecureCookie(request: Request, env: Env): boolean {
    return (
        new URL(request.url).protocol === "https:" ||
        getCookieSameSite(env) === "None"
    );
}

function serializeCookie(
    request: Request,
    env: Env,
    name: string,
    value: string,
    maxAgeSeconds: number,
    path = "/"
): string {
    const attributes = [
        `${name}=${encodeURIComponent(value)}`,
        `Path=${path}`,
        `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
        "HttpOnly",
        `SameSite=${getCookieSameSite(env)}`,
    ];

    if (shouldUseSecureCookie(request, env)) {
        attributes.push("Secure");
    }

    return attributes.join("; ");
}

export function createSessionCookie(
    request: Request,
    env: Env,
    token: string
): string {
    return serializeCookie(
        request,
        env,
        SESSION_COOKIE_NAME,
        token,
        getSessionTtlSeconds(env)
    );
}

export function clearSessionCookie(request: Request, env: Env): string {
    return serializeCookie(
        request,
        env,
        SESSION_COOKIE_NAME,
        "",
        0
    );
}

export function createOAuthStateCookie(
    request: Request,
    env: Env,
    state: string
): string {
    return serializeCookie(
        request,
        env,
        OAUTH_STATE_COOKIE_NAME,
        state,
        600,
        "/auth/lark/callback"
    );
}

export function clearOAuthStateCookie(
    request: Request,
    env: Env
): string {
    return serializeCookie(
        request,
        env,
        OAUTH_STATE_COOKIE_NAME,
        "",
        0,
        "/auth/lark/callback"
    );
}
