import type { Env } from "../../config/env";
import { handleDocumentLinkRoutes } from "./link.route";
import { handleTaxFormRoutes } from "./tax-form.route";
import { handleDocumentViewRoutes } from "./view.route";

export async function handleDocumentRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    const handlers = [
        handleDocumentLinkRoutes,
        handleTaxFormRoutes,
        handleDocumentViewRoutes,
    ] as const;

    for (const handler of handlers) {
        const response = await handler(request, env, pathname);

        if (response) {
            return response;
        }
    }

    return null;
}
