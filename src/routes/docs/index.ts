import type { Env } from "../../config/env";
import {
    handleOpenApiJson,
    handleSwaggerDocs,
} from "./docs.route";

/** รวม API Documentation routes ไว้ใน Feature Boundary เดียว */
export async function handleApiDocsRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname === "/docs" || pathname === "/docs/") {
        return handleSwaggerDocs(request, env);
    }

    if (
        pathname === "/openapi.json" ||
        pathname === "/docs/openapi.json"
    ) {
        return handleOpenApiJson(request, env);
    }

    return null;
}
