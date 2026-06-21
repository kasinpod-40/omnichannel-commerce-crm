import type { Env } from "../config/env";
import {
    buildTextAIUserPrompt,
    TEXT_AI_SYSTEM_PROMPT,
} from "./text-ai.prompt";

function extractWorkersAIText(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }

    if (!value || typeof value !== "object") {
        return "";
    }

    const root = value as Record<string, unknown>;

    for (const key of ["response", "result", "text"]) {
        const candidate = root[key];

        if (typeof candidate === "string") {
            return candidate.trim();
        }
    }

    const choices = Array.isArray(root.choices)
        ? root.choices
        : [];
    const first = choices[0];

    if (first && typeof first === "object") {
        const message = (
            first as Record<string, unknown>
        ).message;

        if (message && typeof message === "object") {
            const content = (
                message as Record<string, unknown>
            ).content;

            if (typeof content === "string") {
                return content.trim();
            }
        }

        const text = (
            first as Record<string, unknown>
        ).text;

        if (typeof text === "string") {
            return text.trim();
        }
    }

    return "";
}

export function isWorkersTextAIConfigured(env: Env): boolean {
    return !!env.AI;
}

export async function analyzeTextWithWorkersAI(
    env: Env,
    message: string
): Promise<string> {
    if (!env.AI) {
        throw new Error("Workers AI binding is not configured");
    }

    const model =
        env.WORKERS_TEXT_MODEL?.trim() ||
        "@cf/zai-org/glm-4.7-flash";

    const response = await env.AI.run(model, {
        messages: [
            {
                role: "system",
                content: TEXT_AI_SYSTEM_PROMPT,
            },
            {
                role: "user",
                content: buildTextAIUserPrompt(message),
            },
        ],
        temperature: 0.1,
        max_completion_tokens: 600,
    });

    const raw = extractWorkersAIText(response);

    if (!raw) {
        throw new Error("Workers AI returned an empty response");
    }

    return raw;
}
