import type { Env } from "../../config/env";
import { handleLineWebhook } from "./webhook.route";

export async function handleLineRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname === "/webhooks/line") {
        return handleLineWebhook(request, env);
    }

    return null;
}
