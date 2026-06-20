import type { Env } from "../../config/env";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function getNumericCode(data: unknown): number | null {
    if (!isRecord(data)) {
        return null;
    }

    if (typeof data.code === "number") {
        return data.code;
    }

    if (typeof data.StatusCode === "number") {
        return data.StatusCode;
    }

    return null;
}

function getResponseMessage(data: unknown): string {
    if (!isRecord(data)) {
        return "";
    }

    if (typeof data.msg === "string") {
        return data.msg;
    }

    if (typeof data.StatusMessage === "string") {
        return data.StatusMessage;
    }

    if (typeof data.message === "string") {
        return data.message;
    }

    return "";
}

export type LarkGroupWebhookResult = {
    ok: true;
    response: unknown;
};

export async function sendLarkGroupText(
    env: Env,
    text: string
): Promise<LarkGroupWebhookResult> {
    const webhookUrl = env.LARK_GROUP_WEBHOOK_URL?.trim();

    if (!webhookUrl) {
        throw new Error(
            "LARK_GROUP_WEBHOOK_URL is not configured"
        );
    }

    if (!webhookUrl.startsWith("https://")) {
        throw new Error(
            "LARK_GROUP_WEBHOOK_URL must start with https://"
        );
    }

    const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            msg_type: "text",
            content: {
                text,
            },
        }),
    });

    const rawBody = await response.text();
    let responseData: unknown = rawBody;

    if (rawBody) {
        try {
            responseData = JSON.parse(rawBody);
        } catch {
            responseData = rawBody;
        }
    }

    if (!response.ok) {
        throw new Error(
            `Lark Group Webhook HTTP ${response.status}: ${rawBody}`
        );
    }

    const code = getNumericCode(responseData);

    if (code !== null && code !== 0) {
        const message = getResponseMessage(responseData);

        throw new Error(
            `Lark Group Webhook Error ${code}${
                message ? `: ${message}` : ""
            }`
        );
    }

    return {
        ok: true,
        response: responseData,
    };
}
