import type { Env } from "../../config/env";
import {
    classifyOperationalError,
    createHttpOperationalError,
    OperationalError,
} from "../../utils/errors";

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

async function sendLarkGroupPayload(
    env: Env,
    payload: Record<string, unknown>
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

    let response: Response;

    try {
        response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        throw new OperationalError(
            "LARK_GROUP_WEBHOOK_NETWORK_ERROR",
            `Lark Group Webhook network error: ${
                error instanceof Error ? error.message : String(error)
            }`,
            {
                retryable: true,
                cause: error,
            }
        );
    }

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
        throw createHttpOperationalError(
            "Lark Group Webhook",
            "send",
            response.status,
            rawBody.slice(0, 1000)
        );
    }

    const code = getNumericCode(responseData);

    if (code !== null && code !== 0) {
        const message = getResponseMessage(responseData);

        const errorMessage =
            `Lark Group Webhook Error ${code}${
                message ? `: ${message}` : ""
            }`;
        const classification =
            classifyOperationalError(errorMessage);

        throw new OperationalError(
            `LARK_GROUP_WEBHOOK_${code}`,
            errorMessage,
            {
                retryable: classification.retryable,
            }
        );
    }

    return {
        ok: true,
        response: responseData,
    };
}

export async function sendLarkGroupText(
    env: Env,
    text: string
): Promise<LarkGroupWebhookResult> {
    return await sendLarkGroupPayload(env, {
        msg_type: "text",
        content: { text },
    });
}

export type LarkReviewCardInput = {
    title: string;
    markdown: string;
    button_text: string;
    button_url: string;
};

/** ส่ง Message Card แบบ one-way ผ่าน Custom Bot โดยปุ่มเปิด Dashboard URL ที่ผ่านการตรวจสิทธิ์อีกชั้น */
export async function sendLarkGroupReviewCard(
    env: Env,
    input: LarkReviewCardInput
): Promise<LarkGroupWebhookResult> {
    const buttonUrl = input.button_url.trim();

    if (!buttonUrl.startsWith("https://")) {
        throw new Error("Lark review card URL must start with https://");
    }

    return await sendLarkGroupPayload(env, {
        msg_type: "interactive",
        card: {
            config: {
                wide_screen_mode: true,
                enable_forward: true,
            },
            header: {
                template: "orange",
                title: {
                    tag: "plain_text",
                    content: input.title,
                },
            },
            elements: [
                {
                    tag: "div",
                    text: {
                        tag: "lark_md",
                        content: input.markdown,
                    },
                },
                {
                    tag: "action",
                    actions: [
                        {
                            tag: "button",
                            type: "primary",
                            text: {
                                tag: "plain_text",
                                content: input.button_text,
                            },
                            url: buttonUrl,
                        },
                    ],
                },
            ],
        },
    });
}
