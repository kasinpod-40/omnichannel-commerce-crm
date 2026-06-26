import type { Env } from "../../config/env";
import { verifyAuthSession } from "../../modules/auth/auth.session";
import {
    getCookie,
    SESSION_COOKIE_NAME,
} from "../auth/auth-cookie";
import { isAdminAuthorized } from "../shared/admin-auth";
import { buildOpenApiDocument } from "./openapi";
import { renderSwaggerUi } from "./swagger-ui";

/**
 * API Docs อนุญาต 2 วิธี:
 * 1) Login Dashboard แล้วมี crm_session cookie
 * 2) ส่ง Admin Bearer token สำหรับอ่าน openapi.json ผ่าน CLI/Postman
 */
async function isApiDocsAuthorized(
    request: Request,
    env: Env
): Promise<boolean> {
    if (isAdminAuthorized(request, env)) {
        return true;
    }

    const token = getCookie(request, SESSION_COOKIE_NAME);

    if (!token) {
        return false;
    }

    try {
        await verifyAuthSession(env, token);
        return true;
    } catch {
        return false;
    }
}

function unauthorized(request: Request, env: Env): Response {
    const acceptsHtml = request.headers
        .get("Accept")
        ?.includes("text/html");

    if (acceptsHtml) {
        const loginUrl = new URL("/login", env.DASHBOARD_URL).toString();
        const html = `<!doctype html>
<html lang="th">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API Docs Login Required</title></head>
<body style="font-family:system-ui,sans-serif;padding:40px;line-height:1.6">
<h1>ต้องเข้าสู่ระบบก่อนเปิด API Docs</h1>
<p>กรุณา Login ด้วย Lark ผ่าน Dashboard แล้วกลับมาเปิด <code>/docs</code> อีกครั้ง</p>
<p><a href="${loginUrl}">เปิดหน้า Login</a></p>
</body></html>`;

        return new Response(html, {
            status: 401,
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
            },
        });
    }

    return Response.json(
        {
            ok: false,
            code: "API_DOCS_UNAUTHORIZED",
            message:
                "Login Dashboard หรือส่ง Admin Bearer token ก่อนอ่าน API Docs",
        },
        {
            status: 401,
            headers: { "Cache-Control": "no-store" },
        }
    );
}

function methodNotAllowed(): Response {
    return Response.json(
        {
            ok: false,
            code: "METHOD_NOT_ALLOWED",
            message: "Method not allowed",
        },
        {
            status: 405,
            headers: { Allow: "GET" },
        }
    );
}

/** GET /docs และ /docs/ แสดง Swagger UI */
export async function handleSwaggerDocs(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return methodNotAllowed();
    }

    if (!(await isApiDocsAuthorized(request, env))) {
        return unauthorized(request, env);
    }

    return new Response(renderSwaggerUi(), {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "Content-Security-Policy": [
                "default-src 'none'",
                "script-src 'unsafe-inline' https://cdn.jsdelivr.net",
                "style-src 'unsafe-inline' https://cdn.jsdelivr.net",
                "img-src data: https:",
                "font-src https://cdn.jsdelivr.net data:",
                "connect-src 'self'",
            ].join("; "),
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
        },
    });
}

/** GET /openapi.json คืน Contract ที่เครื่องมือภายนอก Import ได้ */
export async function handleOpenApiJson(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return methodNotAllowed();
    }

    if (!(await isApiDocsAuthorized(request, env))) {
        return unauthorized(request, env);
    }

    return Response.json(buildOpenApiDocument(request), {
        headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
