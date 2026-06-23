import type { Env } from "../../../config/env";
import { handleMarketplaceSimulation } from "./simulation.route";

export async function handleTikTokSimulation(
    request: Request,
    env: Env
): Promise<Response> {
    return handleMarketplaceSimulation(request, env, "TikTok");
}
