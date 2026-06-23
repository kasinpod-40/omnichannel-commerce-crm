const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary);
}

async function hmacSha256(
    secret: string,
    message: string
): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(message)
    );

    return new Uint8Array(signature);
}

export async function hmacSha256Hex(
    secret: string,
    message: string
): Promise<string> {
    return bytesToHex(await hmacSha256(secret, message));
}

export async function hmacSha256Base64(
    secret: string,
    message: string
): Promise<string> {
    return bytesToBase64(await hmacSha256(secret, message));
}

export async function generateTikTokApiSignature(input: {
    appSecret: string;
    path: string;
    query: Record<string, string | number | boolean | undefined>;
    body?: string;
}): Promise<string> {
    const entries = Object.entries(input.query)
        .filter(
            ([key, value]) =>
                key !== "sign" &&
                key !== "access_token" &&
                value !== undefined
        )
        .sort(([left], [right]) => left.localeCompare(right));
    const queryString = entries
        .map(([key, value]) => `${key}${String(value)}`)
        .join("");
    const canonical = `${input.path}${queryString}${input.body ?? ""}`;
    const wrapped = `${input.appSecret}${canonical}${input.appSecret}`;

    return hmacSha256Hex(input.appSecret, wrapped);
}

function normalizeSignatureHeader(value: string): string[] {
    const trimmed = value.trim();
    const candidates = new Set<string>([trimmed]);

    for (const prefix of ["sha256=", "hmac-sha256=", "HMAC-SHA256 "]) {
        if (trimmed.startsWith(prefix)) {
            candidates.add(trimmed.slice(prefix.length).trim());
        }
    }

    return [...candidates].filter(Boolean);
}

function constantTimeEqual(left: string, right: string): boolean {
    if (left.length !== right.length) {
        return false;
    }

    let diff = 0;

    for (let index = 0; index < left.length; index += 1) {
        diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }

    return diff === 0;
}

export async function verifyTikTokWebhookSignature(input: {
    appSecret: string;
    rawBody: string;
    authorizationHeader: string;
}): Promise<boolean> {
    if (!input.authorizationHeader.trim()) {
        return false;
    }

    const expectedHex = await hmacSha256Hex(
        input.appSecret,
        input.rawBody
    );
    const expectedBase64 = await hmacSha256Base64(
        input.appSecret,
        input.rawBody
    );

    return normalizeSignatureHeader(input.authorizationHeader).some(
        (candidate) =>
            constantTimeEqual(candidate.toLowerCase(), expectedHex) ||
            constantTimeEqual(candidate, expectedBase64)
    );
}
