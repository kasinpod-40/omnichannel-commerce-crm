import type { DocumentType } from "./document.types";

function bytesToHex(bytes: Uint8Array): string {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left: string, right: string): boolean {
    if (left.length !== right.length) {
        return false;
    }

    let mismatch = 0;
    for (let index = 0; index < left.length; index += 1) {
        mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return mismatch === 0;
}

function payload(recordId: string, type: DocumentType, expiresAt: number): string {
    return `${recordId}:${type}:${expiresAt}`;
}

export async function signDocumentLink(
    secret: string,
    recordId: string,
    type: DocumentType,
    expiresAt: number
): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(payload(recordId, type, expiresAt))
    );

    return bytesToHex(new Uint8Array(signature));
}

export async function verifyDocumentLink(
    secret: string,
    recordId: string,
    type: DocumentType,
    expiresAt: number,
    signature: string,
    now = Date.now()
): Promise<boolean> {
    if (!Number.isFinite(expiresAt) || expiresAt <= now || !signature) {
        return false;
    }

    const expected = await signDocumentLink(secret, recordId, type, expiresAt);
    return timingSafeEqual(expected, signature.toLowerCase());
}
