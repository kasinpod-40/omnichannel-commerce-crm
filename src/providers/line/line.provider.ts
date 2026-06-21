import type { Env } from "../../config/env";

export type LineUserProfile = {
    userId: string;
    displayName: string;
    pictureUrl?: string;
    statusMessage?: string;
    language?: string;
};

export type DownloadedLineContent = {
    bytes: ArrayBuffer;
    mime_type: string;
    size_bytes: number;
};

function base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function constantTimeEqual(
    left: Uint8Array,
    right: Uint8Array
): boolean {
    if (left.length !== right.length) {
        return false;
    }

    let difference = 0;

    for (let index = 0; index < left.length; index += 1) {
        difference |= left[index] ^ right[index];
    }

    return difference === 0;
}

export async function verifyLineWebhookSignature(
    rawBody: string,
    receivedSignature: string,
    channelSecret: string
): Promise<boolean> {
    const signature = receivedSignature.trim();
    const secret = channelSecret.trim();

    if (!signature || !secret) {
        return false;
    }

    let receivedBytes: Uint8Array;

    try {
        receivedBytes = base64ToBytes(signature);
    } catch {
        return false;
    }

    const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        {
            name: "HMAC",
            hash: "SHA-256",
        },
        false,
        ["sign"]
    );

    const digest = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(rawBody)
    );

    return constantTimeEqual(
        new Uint8Array(digest),
        receivedBytes
    );
}

export async function getLineUserProfile(
    env: Env,
    userId: string
): Promise<LineUserProfile | null> {
    const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();

    if (!token) {
        throw new Error(
            "LINE_CHANNEL_ACCESS_TOKEN is not configured"
        );
    }

    const response = await fetch(
        `https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }
    );

    if (response.status === 404) {
        return null;
    }

    const bodyText = await response.text();

    if (!response.ok) {
        throw new Error(
            `LINE profile error: ${response.status} ${bodyText.slice(0, 500)}`
        );
    }

    const body = JSON.parse(bodyText) as LineUserProfile;

    return body;
}

export async function downloadLineMessageContent(
    env: Env,
    messageId: string
): Promise<DownloadedLineContent> {
    const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();

    if (!token) {
        throw new Error(
            "LINE_CHANNEL_ACCESS_TOKEN is not configured"
        );
    }

    const response = await fetch(
        `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        }
    );

    if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(
            `LINE content error: ${response.status} ${bodyText.slice(0, 500)}`
        );
    }

    const bytes = await response.arrayBuffer();

    if (bytes.byteLength === 0) {
        throw new Error("LINE content is empty");
    }

    const mimeType =
        response.headers
            .get("content-type")
            ?.split(";")[0]
            .trim() || "application/octet-stream";

    return {
        bytes,
        mime_type: mimeType,
        size_bytes: bytes.byteLength,
    };
}

export async function downloadExternalContent(
    url: string
): Promise<DownloadedLineContent> {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(
            `External content error: ${response.status}`
        );
    }

    const bytes = await response.arrayBuffer();

    if (bytes.byteLength === 0) {
        throw new Error("External content is empty");
    }

    const mimeType =
        response.headers
            .get("content-type")
            ?.split(";")[0]
            .trim() || "application/octet-stream";

    return {
        bytes,
        mime_type: mimeType,
        size_bytes: bytes.byteLength,
    };
}
