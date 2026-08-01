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

const DEFAULT_WEBHOOK_KEYWORD = "CRM";
const MAX_WEBHOOK_KEYWORD_LENGTH = 80;

export type LarkGroupWebhookTarget =
    | "crm"
    | "production-control";

const PC_NOTIFICATION_TITLES = [
    "📦 พบข้อยกเว้นด้านสต็อกสินค้า",
    "🧵 วัตถุดิบไม่เพียงพอสำหรับแผนผลิต",
] as const;

function getWebhookKeyword(env: Env): string {
    /*
     * Notification แบบข้อความเดิมขึ้นต้นด้วย [CRM] อยู่แล้ว และ Bot เดิมใช้คำนี้
     * เป็น Security Keyword จึง fallback เป็น CRM เพื่อไม่บังคับให้ระบบ Production
     * ต้องเปลี่ยนค่าใน Lark Console หลังอัปเกรดเป็น Interactive Card
     */
    const keyword =
        env.LARK_GROUP_WEBHOOK_KEYWORD?.trim() ||
        DEFAULT_WEBHOOK_KEYWORD;

    if (
        keyword.length > MAX_WEBHOOK_KEYWORD_LENGTH ||
        /[\r\n]/u.test(keyword)
    ) {
        throw new OperationalError(
            "LARK_GROUP_WEBHOOK_KEYWORD_INVALID",
            "LARK_GROUP_WEBHOOK_KEYWORD must be a single line of 80 characters or fewer",
            { retryable: false }
        );
    }

    return keyword;
}

function includeWebhookKeyword(
    text: string,
    keyword: string
): string {
    return text.includes(keyword)
        ? text
        : `[${keyword}] ${text}`;
}

/**
 * PC notifications มีหัวข้อคงที่จาก Notification formatter และต้องไปกลุ่มเฉพาะ
 * เท่านั้น การตรวจเฉพาะบรรทัดแรกช่วยไม่ให้ข้อความรายละเอียดที่บังเอิญมีคำเดียวกัน
 * ถูก route ผิดกลุ่ม
 */
export function resolveLarkGroupWebhookTarget(
    text: string
): LarkGroupWebhookTarget {
    const firstLine = text.split(/\r?\n/u, 1)[0]?.trim() ?? "";

    return PC_NOTIFICATION_TITLES.some((title) =>
        firstLine.includes(title)
    )
        ? "production-control"
        : "crm";
}

function getWebhookUrl(
    env: Env,
    target: LarkGroupWebhookTarget
): string {
    const envName =
        target === "production-control"
            ? "LARK_PC_GROUP_WEBHOOK_URL"
            : "LARK_GROUP_WEBHOOK_URL";
    const webhookUrl =
        target === "production-control"
            ? env.LARK_PC_GROUP_WEBHOOK_URL?.trim()
            : env.LARK_GROUP_WEBHOOK_URL?.trim();

    if (!webhookUrl) {
        throw new OperationalError(
            `${envName}_NOT_CONFIGURED`,
            `${envName} is not configured`,
            { retryable: false }
        );
    }

    if (!webhookUrl.startsWith("https://")) {
        throw new OperationalError(
            `${envName}_INVALID`,
            `${envName} must start with https://`,
            { retryable: false }
        );
    }

    return webhookUrl;
}

export type LarkGroupWebhookResult = {
    ok: true;
    response: unknown;
};

async function sendLarkGroupPayload(
    env: Env,
    payload: Record<string, unknown>,
    target: LarkGroupWebhookTarget
): Promise<LarkGroupWebhookResult> {
    const webhookUrl = getWebhookUrl(env, target);

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
                error instanceof Error
                    ? error.message
                    : String(error)
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

        if (code === 19024) {
            throw new OperationalError(
                "LARK_GROUP_WEBHOOK_KEYWORD_MISMATCH",
                "Lark Group Webhook keyword mismatch (19024): LARK_GROUP_WEBHOOK_KEYWORD must exactly match one of the Custom Bot security keywords",
                { retryable: false }
            );
        }

        const errorMessage = `Lark Group Webhook Error ${code}${
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
    const keyword = getWebhookKeyword(env);
    const target = resolveLarkGroupWebhookTarget(text);

    return await sendLarkGroupPayload(
        env,
        {
            msg_type: "text",
            content: {
                text: includeWebhookKeyword(text, keyword),
            },
        },
        target
    );
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
    const keyword = getWebhookKeyword(env);

    if (!buttonUrl.startsWith("https://")) {
        throw new Error(
            "Lark review card URL must start with https://"
        );
    }

    return await sendLarkGroupPayload(
        env,
        {
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
                        content: includeWebhookKeyword(
                            input.title,
                            keyword
                        ),
                    },
                },
                elements: [
                    {
                        tag: "div",
                        text: {
                            tag: "lark_md",
                            content: includeWebhookKeyword(
                                input.markdown,
                                keyword
                            ),
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
        },
        "crm"
    );
}
