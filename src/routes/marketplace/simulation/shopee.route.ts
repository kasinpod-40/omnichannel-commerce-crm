import type { Env } from "../../../config/env";
import { handleMarketplaceSimulation } from "./simulation.route";

export async function handleShopeeSimulation(
    request: Request,
    env: Env
): Promise<Response> {
    return handleMarketplaceSimulation(request, env, "Shopee");
}
