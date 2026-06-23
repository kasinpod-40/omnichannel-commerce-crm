import type { Env } from "../config/env";
import {
    buildMarketplaceDashboardSummary,
    type MarketplaceDashboardFilters,
} from "../modules/dashboard/marketplace-dashboard.service";
import type { MarketplaceChannel } from "../modules/marketplace/marketplace.types";
import { jsonResponse } from "../utils/response";

const MARKETPLACE_CHANNELS = new Set<MarketplaceChannel>([
    "Shopee",
    "Lazada",
    "TikTok",
]);

function getBearerToken(request: Request): string {
    const authorization = request.headers.get("Authorization") ?? "";

    return /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : request.headers.get("X-Admin-Token")?.trim() ?? "";
}

function parseDateBoundary(
    value: string | null,
    boundary: "start" | "end"
): number | undefined {
    if (!value?.trim()) {
        return undefined;
    }

    const text = value.trim();
    const numeric = Number(text);

    if (Number.isFinite(numeric)) {
        return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const time = boundary === "start" ? "00:00:00.000" : "23:59:59.999";
        const parsed = Date.parse(`${text}T${time}+07:00`);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFilters(url: URL): MarketplaceDashboardFilters {
    const rawChannel = url.searchParams.get("channel")?.trim() ?? "";
    const channel = MARKETPLACE_CHANNELS.has(rawChannel as MarketplaceChannel)
        ? (rawChannel as MarketplaceChannel)
        : undefined;
    const storeId = url.searchParams.get("store_id")?.trim() || undefined;
    const dateFrom = parseDateBoundary(
        url.searchParams.get("date_from"),
        "start"
    );
    const dateTo = parseDateBoundary(
        url.searchParams.get("date_to"),
        "end"
    );

    if (rawChannel && !channel && rawChannel.toLowerCase() !== "all") {
        throw new Error("INVALID_CHANNEL");
    }

    if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) {
        throw new Error("INVALID_DATE_RANGE");
    }

    return {
        channel,
        store_id: storeId,
        date_from_ms: dateFrom,
        date_to_ms: dateTo,
    };
}

export async function handleMarketplaceDashboard(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return jsonResponse(
            { ok: false, message: "Method not allowed" },
            405
        );
    }

    const configuredToken = env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "";

    if (!configuredToken || getBearerToken(request) !== configuredToken) {
        return jsonResponse(
            {
                ok: false,
                code: "UNAUTHORIZED",
                message: "Admin token ไม่ถูกต้อง",
            },
            401
        );
    }

    try {
        const filters = parseFilters(new URL(request.url));
        const result = await buildMarketplaceDashboardSummary(env, filters);
        return jsonResponse({ ok: true, result });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message === "INVALID_CHANNEL") {
            return jsonResponse(
                {
                    ok: false,
                    code: "INVALID_CHANNEL",
                    message: "channel ต้องเป็น Shopee, Lazada, TikTok หรือ All",
                },
                400
            );
        }

        if (message === "INVALID_DATE_RANGE") {
            return jsonResponse(
                {
                    ok: false,
                    code: "INVALID_DATE_RANGE",
                    message: "date_from ต้องไม่มากกว่า date_to",
                },
                400
            );
        }

        throw error;
    }
}
