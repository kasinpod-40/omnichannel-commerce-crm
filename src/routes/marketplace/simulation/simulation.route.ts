import type { Env } from "../../../config/env";
import {
    adaptLazadaThailand,
} from "../../../modules/marketplace/adapters/lazada.adapter";
import {
    adaptShopeeThailand,
} from "../../../modules/marketplace/adapters/shopee.adapter";
import {
    adaptTikTokThailand,
} from "../../../modules/marketplace/adapters/tiktok.adapter";
import type {
    MarketplaceAdapter,
    MarketplaceSimulationEnvelope,
} from "../../../modules/marketplace/adapters/adapter.types";
import type { MarketplaceChannel } from "../../../modules/marketplace/marketplace.types";
import { upsertMarketplaceOrder } from "../../../modules/marketplace/marketplace.service";
import { jsonResponse } from "../../../utils/response";
import { getAdminToken } from "../../shared/admin-auth";

function adapterForChannel(channel: MarketplaceChannel): MarketplaceAdapter {
    if (channel === "Shopee") {
        return adaptShopeeThailand;
    }

    if (channel === "Lazada") {
        return adaptLazadaThailand;
    }

    return adaptTikTokThailand;
}

export async function handleMarketplaceSimulation(
    request: Request,
    env: Env,
    channel: MarketplaceChannel
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    const configuredToken = env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "";

    if (!configuredToken || getAdminToken(request) !== configuredToken) {
        return jsonResponse(
            {
                ok: false,
                code: "UNAUTHORIZED",
                message: "Admin token ไม่ถูกต้อง",
            },
            401
        );
    }

    let body: MarketplaceSimulationEnvelope;

    try {
        body = (await request.json()) as MarketplaceSimulationEnvelope;
    } catch {
        return jsonResponse({ ok: false, code: "INVALID_JSON" }, 400);
    }

    try {
        const adapted = adapterForChannel(channel)(body);

        if (body.dry_run === true) {
            return jsonResponse({
                ok: true,
                mode: "dry_run",
                adapter: `${channel.toLowerCase()}-th`,
                region: adapted.region,
                currency: adapted.currency,
                source: adapted.source,
                normalized: adapted.normalized,
            });
        }

        const result = await upsertMarketplaceOrder(env, adapted.normalized);

        return jsonResponse({
            ok: true,
            mode: "upsert",
            adapter: `${channel.toLowerCase()}-th`,
            region: adapted.region,
            currency: adapted.currency,
            source: adapted.source,
            normalized: adapted.normalized,
            result,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const badRequest =
            message.includes("MISSING_") ||
            message.startsWith("MARKETPLACE_") ||
            message.endsWith("_REQUIRED");

        return jsonResponse(
            {
                ok: false,
                code: badRequest
                    ? "INVALID_MARKETPLACE_SIMULATION"
                    : "MARKETPLACE_SIMULATION_FAILED",
                message,
                channel,
                region: "TH",
            },
            badRequest ? 400 : 500
        );
    }
}
