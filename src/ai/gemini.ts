import type { Env } from "../config/env";
import {
    createHttpOperationalError,
    OperationalError,
} from "../utils/errors";
import {
    buildTextAIUserPrompt,
    TEXT_AI_SYSTEM_PROMPT,
} from "./text-ai.prompt";

function extractGeminiText(value: unknown): string {
    if (!value || typeof value !== "object") {
        return "";
    }

    const root = value as Record<string, unknown>;
    const candidates = Array.isArray(root.candidates)
        ? root.candidates
        : [];
    const first = candidates[0];

    if (!first || typeof first !== "object") {
        return "";
    }

    const content = (
        first as Record<string, unknown>
    ).content;

    if (!content || typeof content !== "object") {
        return "";
    }

    const parts = Array.isArray(
        (content as Record<string, unknown>).parts
    )
        ? ((content as Record<string, unknown>)
              .parts as unknown[])
        : [];

    return parts
        .map((part) => {
            if (!part || typeof part !== "object") {
                return "";
            }

            const text = (
                part as Record<string, unknown>
            ).text;

            return typeof text === "string"
                ? text
                : "";
        })
        .join("\n")
        .trim();
}

export function isGeminiTextAIConfigured(env: Env): boolean {
    return !!env.GEMINI_API_KEY?.trim();
}

export async function analyzeTextWithGemini(
    env: Env,
    message: string
): Promise<string> {
    const apiKey = env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
        throw new Error("GEMINI_API_KEY is not configured");
    }

    const model =
        env.GEMINI_TEXT_MODEL?.trim() ||
        env.GEMINI_IMAGE_MODEL?.trim() ||
        "gemini-2.5-flash";

    let response: Response;

    try {
        response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey,
                },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [
                            {
                                text: TEXT_AI_SYSTEM_PROMPT,
                            },
                        ],
                    },
                    contents: [
                        {
                            role: "user",
                            parts: [
                                {
                                    text: buildTextAIUserPrompt(message),
                                },
                            ],
                        },
                    ],
                    generationConfig: {
                        temperature: 0.1,
                        maxOutputTokens: 600,
                        responseMimeType: "application/json",
                    },
                }),
            }
        );
    } catch (error) {
        throw new OperationalError(
            "GEMINI_TEXT_NETWORK_ERROR",
            `Gemini text analysis network error: ${
                error instanceof Error ? error.message : String(error)
            }`,
            {
                retryable: true,
                cause: error,
            }
        );
    }

    const bodyText = await response.text();
    let body: unknown = {};

    try {
        body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
        body = { raw: bodyText.slice(0, 500) };
    }

    if (!response.ok) {
        throw createHttpOperationalError(
            "Gemini",
            "text analysis",
            response.status,
            JSON.stringify(body).slice(0, 500)
        );
    }

    const raw = extractGeminiText(body);

    if (!raw) {
        throw new Error("Gemini returned an empty response");
    }

    return raw;
}
