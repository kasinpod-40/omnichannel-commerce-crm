import type { Env } from "../../config/env";
import { getSessionSecret, getSessionTtlSeconds } from "./auth.config";
import { AuthError } from "./auth.error";
import type {
    AuthSessionPayload,
    AuthUserResponse,
    OAuthStatePayload,
} from "./auth.types";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_SIGNED_TOKEN_LENGTH = 8_192;

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "="
    );
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
    );
}

/** ลงลายเซ็น Payload ด้วย HMAC-SHA256 โดยไม่ต้องมี Session Database เพิ่ม */
async function signPayload(
    secret: string,
    payload: AuthSessionPayload | OAuthStatePayload
): Promise<string> {
    const encodedPayload = toBase64Url(
        encoder.encode(JSON.stringify(payload))
    );
    const key = await importHmacKey(secret);
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(encodedPayload)
    );

    return `${encodedPayload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function verifySignedPayload(
    secret: string,
    token: string
): Promise<unknown> {
    if (!token || token.length > MAX_SIGNED_TOKEN_LENGTH) {
        throw new AuthError(
            "AUTH_TOKEN_INVALID",
            "Authentication token is invalid",
            401
        );
    }

    const [encodedPayload, encodedSignature, extraPart] = token.split(".");

    if (!encodedPayload || !encodedSignature || extraPart !== undefined) {
        throw new AuthError(
            "AUTH_TOKEN_INVALID",
            "Authentication token is invalid",
            401
        );
    }

    try {
        const key = await importHmacKey(secret);
        const valid = await crypto.subtle.verify(
            "HMAC",
            key,
            fromBase64Url(encodedSignature),
            encoder.encode(encodedPayload)
        );

        if (!valid) {
            throw new AuthError(
                "AUTH_TOKEN_INVALID",
                "Authentication token signature is invalid",
                401
            );
        }

        return JSON.parse(
            decoder.decode(fromBase64Url(encodedPayload))
        ) as unknown;
    } catch (error) {
        if (error instanceof AuthError) {
            throw error;
        }

        throw new AuthError(
            "AUTH_TOKEN_INVALID",
            "Authentication token cannot be decoded",
            401,
            error
        );
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isSessionPayload(value: unknown): value is AuthSessionPayload {
    if (!isObject(value) || !isObject(value.user)) {
        return false;
    }

    return (
        value.kind === "session" &&
        value.version === 1 &&
        typeof value.session_id === "string" &&
        typeof value.issued_at === "number" &&
        typeof value.expires_at === "number" &&
        typeof value.user.user_id === "string" &&
        typeof value.user.lark_open_id === "string" &&
        typeof value.user.name === "string" &&
        ["admin", "manager", "sales"].includes(
            String(value.user.role)
        )
    );
}

function isOAuthStatePayload(value: unknown): value is OAuthStatePayload {
    return (
        isObject(value) &&
        value.kind === "oauth_state" &&
        value.version === 1 &&
        typeof value.nonce === "string" &&
        typeof value.return_to === "string" &&
        typeof value.issued_at === "number" &&
        typeof value.expires_at === "number"
    );
}

export async function createAuthSession(
    env: Env,
    user: AuthUserResponse,
    nowMs = Date.now()
): Promise<{ token: string; payload: AuthSessionPayload }> {
    const issuedAt = Math.floor(nowMs / 1_000);
    const payload: AuthSessionPayload = {
        kind: "session",
        version: 1,
        session_id: crypto.randomUUID(),
        user,
        issued_at: issuedAt,
        expires_at: issuedAt + getSessionTtlSeconds(env),
    };

    return {
        token: await signPayload(getSessionSecret(env), payload),
        payload,
    };
}

export async function verifyAuthSession(
    env: Env,
    token: string,
    nowMs = Date.now()
): Promise<AuthSessionPayload> {
    const payload = await verifySignedPayload(
        getSessionSecret(env),
        token
    );

    if (!isSessionPayload(payload)) {
        throw new AuthError(
            "AUTH_SESSION_INVALID",
            "Dashboard session has an invalid format",
            401
        );
    }

    if (payload.expires_at <= Math.floor(nowMs / 1_000)) {
        throw new AuthError(
            "AUTH_SESSION_EXPIRED",
            "Dashboard session has expired",
            401
        );
    }

    return payload;
}

export async function createOAuthState(
    env: Env,
    returnTo: string,
    nowMs = Date.now()
): Promise<{ token: string; payload: OAuthStatePayload }> {
    const issuedAt = Math.floor(nowMs / 1_000);
    const payload: OAuthStatePayload = {
        kind: "oauth_state",
        version: 1,
        nonce: crypto.randomUUID(),
        return_to: returnTo,
        issued_at: issuedAt,
        expires_at: issuedAt + 600,
    };

    return {
        token: await signPayload(getSessionSecret(env), payload),
        payload,
    };
}

export async function verifyOAuthState(
    env: Env,
    token: string,
    nowMs = Date.now()
): Promise<OAuthStatePayload> {
    const payload = await verifySignedPayload(
        getSessionSecret(env),
        token
    );

    if (!isOAuthStatePayload(payload)) {
        throw new AuthError(
            "AUTH_STATE_INVALID",
            "OAuth state has an invalid format",
            400
        );
    }

    if (payload.expires_at <= Math.floor(nowMs / 1_000)) {
        throw new AuthError(
            "AUTH_STATE_EXPIRED",
            "OAuth state has expired",
            400
        );
    }

    return payload;
}
