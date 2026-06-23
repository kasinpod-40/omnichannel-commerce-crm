import type { Env } from "../config/env";
import { handleMarketplaceSimulation } from "./marketplace-simulation.route";

export async function handleLazadaSimulation(
    request: Request,
    env: Env
): Promise<Response> {
    return handleMarketplaceSimulation(request, env, "Lazada");
}
