import type { Env } from "../../config/env";
import { getTenantAccessToken } from "./lark.provider";

const MAX_SINGLE_UPLOAD_BYTES = 20 * 1024 * 1024;

export type LarkAttachmentUploadInput = {
    file_name: string;
    mime_type: string;
    bytes: ArrayBuffer;
};

type LarkMediaUploadResponse = {
    code: number;
    msg: string;
    data?: {
        file_token?: string;
    };
};

function sanitizeFileName(value: string): string {
    const cleaned = value
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        .replace(/\s+/g, "_")
        .slice(0, 180);

    return cleaned || `line-image-${Date.now()}.jpg`;
}

export function toLarkAttachmentFieldValue(
    fileTokens: string[]
): Array<{ file_token: string }> {
    return [...new Set(fileTokens.map((token) => token.trim()))]
        .filter(Boolean)
        .map((file_token) => ({ file_token }));
}

export async function uploadLarkBitableImage(
    env: Env,
    input: LarkAttachmentUploadInput
): Promise<string> {
    if (input.bytes.byteLength === 0) {
        throw new Error("Cannot upload an empty attachment");
    }

    if (input.bytes.byteLength > MAX_SINGLE_UPLOAD_BYTES) {
        throw new Error(
            `Lark attachment exceeds 20 MB: ${input.bytes.byteLength} bytes`
        );
    }

    const token = await getTenantAccessToken(env);
    const form = new FormData();
    const fileName = sanitizeFileName(input.file_name);
    const mimeType = input.mime_type || "image/jpeg";

    form.set("file_name", fileName);
    form.set("parent_type", "bitable_image");
    form.set("parent_node", env.LARK_APP_TOKEN);
    form.set("size", String(input.bytes.byteLength));
    form.set(
        "file",
        new Blob([input.bytes], { type: mimeType }),
        fileName
    );

    const response = await fetch(
        "https://open.larksuite.com/open-apis/drive/v1/medias/upload_all",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
            },
            body: form,
        }
    );

    const bodyText = await response.text();
    let body: LarkMediaUploadResponse;

    try {
        body = JSON.parse(bodyText) as LarkMediaUploadResponse;
    } catch {
        throw new Error(
            `Lark attachment upload returned invalid JSON: ${response.status} ${bodyText.slice(0, 500)}`
        );
    }

    const fileToken = body.data?.file_token?.trim();

    if (!response.ok || body.code !== 0 || !fileToken) {
        throw new Error(
            `Lark attachment upload failed: ${response.status} ${bodyText.slice(0, 1000)}`
        );
    }

    return fileToken;
}
