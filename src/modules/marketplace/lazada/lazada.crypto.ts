const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
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

function compareAscii(left: string, right: string): number {
    if (left < right) {
        return -1;
    }

    if (left > right) {
        return 1;
    }

    return 0;
}

export async function generateLazadaApiSignature(input: {
    appSecret: string;
    path: string;
    parameters: Record<
        string,
        string | number | boolean | undefined
    >;
}): Promise<string> {
    const concatenated = Object.entries(input.parameters)
        .filter(([key, value]) => key !== "sign" && value !== undefined)
        .sort(([left], [right]) => compareAscii(left, right))
        .map(([key, value]) => `${key}${String(value)}`)
        .join("");
    const canonical = `${input.path}${concatenated}`;

    return (await hmacSha256Hex(input.appSecret, canonical)).toUpperCase();
}

function signatureCandidates(value: string): string[] {
    const trimmed = value.trim();
    const candidates = new Set<string>();

    if (trimmed) {
        candidates.add(trimmed);
    }

    for (const part of trimmed.split(/[;,]/)) {
        const normalized = part.trim();
        const separator = normalized.indexOf("=");

        if (separator >= 0) {
            const key = normalized.slice(0, separator).trim().toLowerCase();
            const candidate = normalized.slice(separator + 1).trim();

            if (["signature", "sign", "sha256"].includes(key)) {
                candidates.add(candidate.replace(/^"|"$/g, ""));
            }
        }
    }

    const match = trimmed.match(/[a-fA-F0-9]{64}/);

    if (match) {
        candidates.add(match[0]);
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

export async function verifyLazadaWebhookSignature(input: {
    appKey: string;
    appSecret: string;
    rawBody: string;
    authorizationHeader: string;
}): Promise<boolean> {
    if (!input.authorizationHeader.trim()) {
        return false;
    }

    const expected = await hmacSha256Hex(
        input.appSecret,
        `${input.appKey}${input.rawBody}`
    );

    return signatureCandidates(input.authorizationHeader).some(
        (candidate) =>
            constantTimeEqual(candidate.toLowerCase(), expected.toLowerCase())
    );
}
