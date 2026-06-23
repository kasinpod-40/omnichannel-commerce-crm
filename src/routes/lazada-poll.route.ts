import type { Env } from "../config/env";
import {
    getLazadaPollState,
    resetLazadaPollState,
} from "../modules/marketplace/lazada/lazada.poll-state";
import { runLazadaPolling } from "../modules/marketplace/lazada/lazada.poller";
import {
    listLazadaCredentials,
    resolveLazadaCredential,
} from "../modules/marketplace/lazada/lazada.token-store";
import { jsonResponse } from "../utils/response";

function text(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }

    if (typeof value === "number" || typeof value === "bigint") {
        return String(value);
    }

    return "";
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function getAdminToken(request: Request): string {
    const authorization = request.headers.get("Authorization") ?? "";

    return /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : request.headers.get("X-Admin-Token")?.trim() ?? "";
}

function isAdminAuthorized(request: Request, env: Env): boolean {
    const configured = env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "";
    return Boolean(configured && getAdminToken(request) === configured);
}

function booleanValue(value: unknown): boolean {
    return value === true || text(value).toLowerCase() === "true";
}

function numberValue(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}

export async function handleLazadaAdminSyncRecent(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    if (!isAdminAuthorized(request, env)) {
        return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
    }

    let body: Record<string, unknown> = {};

    try {
        const raw = await request.text();
        body = raw.trim() ? asRecord(JSON.parse(raw)) : {};
    } catch {
        return jsonResponse({ ok: false, code: "INVALID_JSON" }, 400);
    }

    try {
        const report = await runLazadaPolling({
            env,
            trigger: "admin",
            sellerId: text(body.seller_id) || undefined,
            shortCode: text(body.short_code) || undefined,
            lookbackMinutes: numberValue(body.lookback_minutes),
            resetCursor: booleanValue(body.reset_cursor),
        });

        return jsonResponse(report, report.ok ? 200 : 207);
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                code: "LAZADA_RECENT_SYNC_FAILED",
                message:
                    error instanceof Error ? error.message : String(error),
            },
            500
        );
    }
}

export async function handleLazadaAdminPollStatus(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "GET") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    if (!isAdminAuthorized(request, env)) {
        return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
    }

    try {
        const url = new URL(request.url);
        const sellerId = text(url.searchParams.get("seller_id"));
        const shortCode = text(url.searchParams.get("short_code"));
        const credentials = sellerId || shortCode
            ? [
                  await resolveLazadaCredential(env, {
                      sellerId,
                      shortCode,
                  }),
              ].filter(Boolean)
            : await listLazadaCredentials(env);
        const sellers = await Promise.all(
            credentials.map(async (credential) => ({
                seller_id: credential!.seller_id,
                account: credential!.account,
                state: await getLazadaPollState(env, credential!.seller_id),
            }))
        );

        return jsonResponse({
            ok: true,
            enabled:
                env.LAZADA_POLL_ENABLED?.trim().toLowerCase() !== "false",
            schedule: "every 5 minutes",
            sellers,
        });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                code: "LAZADA_POLL_STATUS_FAILED",
                message:
                    error instanceof Error ? error.message : String(error),
            },
            500
        );
    }
}

export async function handleLazadaAdminResetPollCursor(
    request: Request,
    env: Env
): Promise<Response> {
    if (request.method !== "POST") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    if (!isAdminAuthorized(request, env)) {
        return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
    }

    let body: Record<string, unknown>;

    try {
        body = asRecord(await request.json());
    } catch {
        return jsonResponse({ ok: false, code: "INVALID_JSON" }, 400);
    }

    const sellerId = text(body.seller_id);
    const lookbackMinutes = Math.max(
        5,
        Math.trunc(numberValue(body.lookback_minutes) ?? 24 * 60)
    );

    if (!sellerId) {
        return jsonResponse(
            { ok: false, code: "LAZADA_SELLER_ID_REQUIRED" },
            400
        );
    }

    try {
        const state = await resetLazadaPollState(
            env,
            sellerId,
            Date.now() - lookbackMinutes * 60 * 1000
        );

        return jsonResponse({ ok: true, state });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                code: "LAZADA_POLL_CURSOR_RESET_FAILED",
                message:
                    error instanceof Error ? error.message : String(error),
            },
            500
        );
    }
}
