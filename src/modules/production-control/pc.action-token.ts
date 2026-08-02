import type { Env } from "../../config/env";
import { getSessionSecret } from "../auth/auth.config";
import { OperationalError } from "../../utils/errors";

export type PcWorkflowAction =
    | "approve-production"
    | "purchase-materials"
    | "complete-production";

export type PcWorkflowActionTokenPayload = {
    version: 1;
    action: PcWorkflowAction;
    production_record_id: string;
    expires_at: number;
};

const ACTION_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function tokenError(
    code: string,
    message: string,
    status = 400
): OperationalError {
    return new OperationalError(code, message, {
        retryable: false,
        status,
    });
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "="
    );

    try {
        const binary = atob(padded);
        return Uint8Array.from(binary, (character) =>
            character.charCodeAt(0)
        );
    } catch (error) {
        throw tokenError(
            "PC_ACTION_TOKEN_INVALID",
            "Production action token is invalid",
            400
        );
    }
}

async function signingKey(env: Env): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
        "raw",
        encoder.encode(getSessionSecret(env)),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

function assertPayload(value: unknown): PcWorkflowActionTokenPayload {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw tokenError(
            "PC_ACTION_TOKEN_INVALID",
            "Production action token payload is invalid"
        );
    }

    const payload = value as Partial<PcWorkflowActionTokenPayload>;
    const allowedActions = new Set<PcWorkflowAction>([
        "approve-production",
        "purchase-materials",
        "complete-production",
    ]);

    if (
        payload.version !== 1 ||
        !allowedActions.has(payload.action as PcWorkflowAction) ||
        typeof payload.production_record_id !== "string" ||
        !payload.production_record_id.trim() ||
        typeof payload.expires_at !== "number" ||
        !Number.isFinite(payload.expires_at)
    ) {
        throw tokenError(
            "PC_ACTION_TOKEN_INVALID",
            "Production action token payload is invalid"
        );
    }

    return {
        version: 1,
        action: payload.action as PcWorkflowAction,
        production_record_id: payload.production_record_id.trim(),
        expires_at: payload.expires_at,
    };
}

export async function createPcWorkflowActionToken(
    env: Env,
    input: {
        action: PcWorkflowAction;
        production_record_id: string;
        now?: number;
    }
): Promise<string> {
    const recordId = input.production_record_id.trim();
    if (!recordId) {
        throw tokenError(
            "PC_PRODUCTION_RECORD_ID_REQUIRED",
            "production_record_id is required"
        );
    }

    const payload: PcWorkflowActionTokenPayload = {
        version: 1,
        action: input.action,
        production_record_id: recordId,
        expires_at:
            Math.floor((input.now ?? Date.now()) / 1000) +
            ACTION_TOKEN_TTL_SECONDS,
    };
    const encodedPayload = bytesToBase64Url(
        encoder.encode(JSON.stringify(payload))
    );
    const signature = new Uint8Array(
        await crypto.subtle.sign(
            "HMAC",
            await signingKey(env),
            encoder.encode(encodedPayload)
        )
    );

    return `${encodedPayload}.${bytesToBase64Url(signature)}`;
}

export async function verifyPcWorkflowActionToken(
    env: Env,
    token: string,
    expected?: {
        action?: PcWorkflowAction;
        production_record_id?: string;
        now?: number;
    }
): Promise<PcWorkflowActionTokenPayload> {
    const normalized = token.trim();
    if (!normalized || normalized.length > 4096) {
        throw tokenError(
            "PC_ACTION_TOKEN_INVALID",
            "Production action token is invalid"
        );
    }

    const parts = normalized.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw tokenError(
            "PC_ACTION_TOKEN_INVALID",
            "Production action token is invalid"
        );
    }

    const [encodedPayload, encodedSignature] = parts;
    const valid = await crypto.subtle.verify(
        "HMAC",
        await signingKey(env),
        base64UrlToBytes(encodedSignature),
        encoder.encode(encodedPayload)
    );

    if (!valid) {
        throw tokenError(
            "PC_ACTION_TOKEN_INVALID",
            "Production action token signature is invalid"
        );
    }

    let decoded: unknown;
    try {
        decoded = JSON.parse(decoder.decode(base64UrlToBytes(encodedPayload)));
    } catch {
        throw tokenError(
            "PC_ACTION_TOKEN_INVALID",
            "Production action token payload is invalid"
        );
    }

    const payload = assertPayload(decoded);
    const nowSeconds = Math.floor((expected?.now ?? Date.now()) / 1000);

    if (payload.expires_at < nowSeconds) {
        throw tokenError(
            "PC_ACTION_TOKEN_EXPIRED",
            "Production action token has expired",
            410
        );
    }

    if (expected?.action && payload.action !== expected.action) {
        throw tokenError(
            "PC_ACTION_TOKEN_MISMATCH",
            "Production action token does not match this action",
            403
        );
    }

    if (
        expected?.production_record_id &&
        payload.production_record_id !==
            expected.production_record_id.trim()
    ) {
        throw tokenError(
            "PC_ACTION_TOKEN_MISMATCH",
            "Production action token does not match this production batch",
            403
        );
    }

    return payload;
}

function workerOrigin(env: Env): string {
    try {
        return new URL(env.LARK_AUTH_REDIRECT_URI).origin;
    } catch (error) {
        throw new OperationalError(
            "PC_ACTION_ORIGIN_INVALID",
            "LARK_AUTH_REDIRECT_URI must be an absolute URL",
            { retryable: false, status: 500, cause: error }
        );
    }
}

export async function createPcWorkflowActionUrl(
    env: Env,
    input: {
        action: PcWorkflowAction;
        production_record_id: string;
    }
): Promise<string> {
    const recordId = input.production_record_id.trim();
    const token = await createPcWorkflowActionToken(env, input);
    const url = new URL(
        `/pc/actions/${encodeURIComponent(recordId)}/${input.action}`,
        workerOrigin(env)
    );
    url.searchParams.set("token", token);
    return url.toString();
}
