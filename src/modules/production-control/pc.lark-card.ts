import type { Env } from "../../config/env";
import {
    createHttpOperationalError,
    OperationalError,
} from "../../utils/errors";

export type PcLarkCardAction = {
    text: string;
    url: string;
    style?: "primary" | "default" | "danger";
};

export type PcLarkActionCardInput = {
    title: string;
    markdown: string;
    template?: "blue" | "green" | "orange" | "red" | "grey";
    actions?: PcLarkCardAction[];
};

function webhookUrl(env: Env): string {
    const url = env.LARK_PC_GROUP_WEBHOOK_URL?.trim() ?? "";

    if (!url) {
        throw new OperationalError(
            "LARK_PC_GROUP_WEBHOOK_URL_NOT_CONFIGURED",
            "LARK_PC_GROUP_WEBHOOK_URL is not configured",
            { retryable: false }
        );
    }

    if (!url.startsWith("https://")) {
        throw new OperationalError(
            "LARK_PC_GROUP_WEBHOOK_URL_INVALID",
            "LARK_PC_GROUP_WEBHOOK_URL must start with https://",
            { retryable: false }
        );
    }

    return url;
}

function webhookKeyword(env: Env): string {
    const keyword = env.LARK_GROUP_WEBHOOK_KEYWORD?.trim() || "CRM";

    if (keyword.length > 80 || /[\r\n]/u.test(keyword)) {
        throw new OperationalError(
            "LARK_GROUP_WEBHOOK_KEYWORD_INVALID",
            "LARK_GROUP_WEBHOOK_KEYWORD must be a single line of 80 characters or fewer",
            { retryable: false }
        );
    }

    return keyword;
}

function includeKeyword(value: string, keyword: string): string {
    return value.includes(keyword) ? value : `[${keyword}] ${value}`;
}

function responseCode(value: unknown): number | null {
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.code === "number") return record.code;
    if (typeof record.StatusCode === "number") return record.StatusCode;
    return null;
}

function responseMessage(value: unknown): string {
    if (typeof value !== "object" || value === null) return "";
    const record = value as Record<string, unknown>;
    for (const key of ["msg", "message", "StatusMessage"] as const) {
        if (typeof record[key] === "string") return record[key];
    }
    return "";
}

function normalizeActions(
    actions: PcLarkCardAction[] | undefined
): PcLarkCardAction[] {
    return (actions ?? [])
        .filter((action) => action.text.trim() && action.url.trim())
        .slice(0, 3)
        .map((action) => {
            const url = action.url.trim();
            if (!url.startsWith("https://")) {
                throw new OperationalError(
                    "PC_LARK_CARD_ACTION_URL_INVALID",
                    "Production card action URL must start with https://",
                    { retryable: false }
                );
            }
            return {
                text: action.text.trim().slice(0, 80),
                url,
                style: action.style ?? "primary",
            };
        });
}

export async function sendPcLarkActionCard(
    env: Env,
    input: PcLarkActionCardInput
): Promise<{ ok: true; response: unknown }> {
    const keyword = webhookKeyword(env);
    const actions = normalizeActions(input.actions);
    const elements: Array<Record<string, unknown>> = [
        {
            tag: "div",
            text: {
                tag: "lark_md",
                content: includeKeyword(input.markdown.trim(), keyword),
            },
        },
    ];

    if (actions.length > 0) {
        elements.push({
            tag: "action",
            actions: actions.map((action) => ({
                tag: "button",
                type: action.style,
                text: {
                    tag: "plain_text",
                    content: action.text,
                },
                url: action.url,
            })),
        });
    }

    let response: Response;
    try {
        response = await fetch(webhookUrl(env), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                msg_type: "interactive",
                card: {
                    config: {
                        wide_screen_mode: true,
                        enable_forward: true,
                    },
                    header: {
                        template: input.template ?? "orange",
                        title: {
                            tag: "plain_text",
                            content: includeKeyword(input.title.trim(), keyword),
                        },
                    },
                    elements,
                },
            }),
        });
    } catch (error) {
        throw new OperationalError(
            "LARK_PC_CARD_NETWORK_ERROR",
            `Lark Production Card network error: ${
                error instanceof Error ? error.message : String(error)
            }`,
            { retryable: true, cause: error }
        );
    }

    const raw = await response.text();
    let data: unknown = raw;
    if (raw) {
        try {
            data = JSON.parse(raw);
        } catch {
            data = raw;
        }
    }

    if (!response.ok) {
        throw createHttpOperationalError(
            "Lark Production Card",
            "send",
            response.status,
            raw.slice(0, 1000)
        );
    }

    const code = responseCode(data);
    if (code !== null && code !== 0) {
        const message = responseMessage(data);
        throw new OperationalError(
            code === 19024
                ? "LARK_GROUP_WEBHOOK_KEYWORD_MISMATCH"
                : `LARK_PC_CARD_${code}`,
            `Lark Production Card Error ${code}${
                message ? `: ${message}` : ""
            }`,
            { retryable: code === 99991663 || code === 99991664 }
        );
    }

    return { ok: true, response: data };
}
