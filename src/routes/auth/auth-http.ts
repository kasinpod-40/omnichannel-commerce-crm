import type { Env } from "../../config/env";
import { getAllowedOrigins } from "../../modules/auth/auth.config";
import { AuthError } from "../../modules/auth/auth.error";

function getRequestOrigin(request: Request): string | null {
    const origin = request.headers.get("Origin")?.trim();
    return origin || null;
}

function isSameOriginRequest(request: Request, origin: string): boolean {
    try {
        return new URL(request.url).origin === origin;
    } catch {
        return false;
    }
}

function isAllowedRequestOrigin(
    request: Request,
    env: Env,
    origin: string
): boolean {
    if (isSameOriginRequest(request, origin)) {
        return true;
    }

    return getAllowedOrigins(env).has(origin);
}

/**
 * ตรวจ Origin สำหรับ request ที่เปลี่ยนสถานะ เช่น client-session และ logout
 * การ Navigation ตรงไป /auth/lark/login ไม่มี Origin ก็ยังอนุญาต เพราะเป็น Top-level GET
 * Request ที่มาจาก Origin เดียวกับ Worker อนุญาตโดยตรง เพื่อรองรับ Demo Shop แบบ same-origin.
 */
export function assertAllowedOrigin(request: Request, env: Env): void {
    const origin = getRequestOrigin(request);

    if (!origin || !isAllowedRequestOrigin(request, env, origin)) {
        throw new AuthError(
            "AUTH_ORIGIN_FORBIDDEN",
            "Request origin is not allowed",
            403
        );
    }
}

export function addAuthCorsHeaders(
    response: Response,
    request: Request,
    env: Env
): Response {
    const origin = getRequestOrigin(request);

    if (!origin) {
        return response;
    }

    let allowed = false;

    try {
        allowed = isAllowedRequestOrigin(request, env, origin);
    } catch {
        // หาก Config ยังไม่ครบ ให้คง Response เดิมแทนการทำ Error ซ้อนในขั้นตอนแนบ CORS
        return response;
    }

    if (!allowed) {
        return response;
    }

    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Idempotency-Key"
    );
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.append("Vary", "Origin");

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}

export function handleAuthPreflight(
    request: Request,
    env: Env
): Response {
    assertAllowedOrigin(request, env);

    return addAuthCorsHeaders(
        new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Max-Age": "600",
            },
        }),
        request,
        env
    );
}

export async function readJsonObject(
    request: Request
): Promise<Record<string, unknown>> {
    const contentType = request.headers.get("Content-Type") ?? "";

    if (!contentType.toLowerCase().includes("application/json")) {
        throw new AuthError(
            "AUTH_CONTENT_TYPE_INVALID",
            "Content-Type must be application/json",
            415
        );
    }

    try {
        const payload = (await request.json()) as unknown;

        if (
            typeof payload !== "object" ||
            payload === null ||
            Array.isArray(payload)
        ) {
            throw new Error("JSON body must be an object");
        }

        return payload as Record<string, unknown>;
    } catch (error) {
        throw new AuthError(
            "AUTH_JSON_INVALID",
            "Request body must be valid JSON object",
            400,
            error
        );
    }
}
