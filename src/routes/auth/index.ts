import type { Env } from "../../config/env";
import {
    handleAuthLogout,
    handleAuthMe,
    handleLarkBrowserCallback,
    handleLarkBrowserLogin,
    handleLarkClientSession,
} from "./auth.route";
import { handleAuthPreflight } from "./auth-http";

/** รวม Route ของ Dashboard Authentication ไว้ใน Feature Boundary เดียว */
export async function handleAuthRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (!pathname.startsWith("/auth/")) {
        return null;
    }

    if (request.method === "OPTIONS") {
        try {
            return handleAuthPreflight(request, env);
        } catch {
            return Response.json(
                {
                    ok: false,
                    code: "AUTH_ORIGIN_FORBIDDEN",
                    message: "Request origin is not allowed",
                },
                { status: 403 }
            );
        }
    }

    switch (pathname) {
        case "/auth/lark/login":
            return handleLarkBrowserLogin(request, env);
        case "/auth/lark/callback":
            return handleLarkBrowserCallback(request, env);
        case "/auth/lark/client-session":
            return handleLarkClientSession(request, env);
        case "/auth/me":
            return handleAuthMe(request, env);
        case "/auth/logout":
            return handleAuthLogout(request, env);
        default:
            return null;
    }
}
