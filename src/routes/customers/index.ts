import type { Env } from "../../config/env";
import { handleAuthPreflight } from "../auth/auth-http";
import {
    handleCustomerDetail,
    handleCustomerList,
} from "./customers.route";

/** Route group ของหน้า Customers แยกจาก Dashboard summary เพื่อคง feature boundary ชัดเจน */
export async function handleCustomerRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (!pathname.startsWith("/customers")) return null;

    if (request.method === "OPTIONS") {
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

    if (pathname === "/customers") {
        return handleCustomerList(request, env);
    }

    const match = pathname.match(/^\/customers\/([^/]+)$/);
    if (match?.[1]) {
        return handleCustomerDetail(request, env, match[1]);
    }

    return null;
}
