import { IMAGE_AI_PROMPT } from "../../ai/image-ai.prompt";
import type {
    ImageAIProvider,
    ImageAIProviderResponse,
    LoadedImage,
} from "../../ai/image-ai.types";
import type { Env } from "../../config/env";
import {
    createHttpOperationalError,
    OperationalError,
} from "../../utils/errors";

const IMAGE_ANALYSIS_JSON_SCHEMA = {
    type: "object",
    properties: {
        image_type: {
            type: "string",
            enum: [
                "product_image",
                "payment_slip",
                "other",
            ],
            description:
                "ประเภทของรูปภาพตามค่าที่ระบบกำหนด",
        },
        product_name: {
            type: "string",
            description:
                "ชื่อและรายละเอียดสินค้าหลักที่มองเห็นจริง โดยไม่ใช้ไซส์แทนชื่อสินค้า",
        },
        product_size: {
            type: "string",
            description:
                "ไซส์หรือขนาดที่มองเห็นจริง เช่น S, XL, 38 หรือ Free Size ถ้าไม่เห็นให้เป็นค่าว่าง",
        },
        slip_amount: {
            type: "number",
            minimum: 0,
            description:
                "ยอดเงินที่อ่านได้จากสลิป ถ้าอ่านไม่ได้หรือไม่ใช่สลิปให้เป็น 0",
        },
        slip_bank: {
            type: "string",
            description:
                "ชื่อธนาคารที่อ่านได้จากสลิป ถ้าอ่านไม่ได้หรือไม่ใช่สลิปให้เป็นค่าว่าง",
        },
        confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description:
                "ค่าความมั่นใจตั้งแต่ 0 ถึง 1",
        },
        summary: {
            type: "string",
            description:
                "สรุปสิ่งที่เห็นจริงในรูปเป็นภาษาไทยแบบสั้นและชัดเจน",
        },
    },
    required: [
        "image_type",
        "product_name",
        "product_size",
        "slip_amount",
        "slip_bank",
        "confidence",
        "summary",
    ],
    additionalProperties: false,
    propertyOrdering: [
        "image_type",
        "product_name",
        "product_size",
        "slip_amount",
        "slip_bank",
        "confidence",
        "summary",
    ],
} as const;

function extractCandidateParts(value: unknown): unknown[] {
    if (!value || typeof value !== "object") {
        return [];
    }

    const root = value as Record<string, unknown>;
    const candidates = Array.isArray(root.candidates)
        ? root.candidates
        : [];
    const first = candidates[0];

    if (!first || typeof first !== "object") {
        return [];
    }

    const content = (
        first as Record<string, unknown>
    ).content;

    if (!content || typeof content !== "object") {
        return [];
    }

    return Array.isArray(
        (content as Record<string, unknown>).parts
    )
        ? ((content as Record<string, unknown>)
              .parts as unknown[])
        : [];
}

function extractGeminiText(value: unknown): string {
    const parts = extractCandidateParts(value);
    const answerTexts: string[] = [];
    const fallbackTexts: string[] = [];

    for (const part of parts) {
        if (!part || typeof part !== "object") {
            continue;
        }

        const record = part as Record<string, unknown>;
        const text = record.text;

        if (typeof text !== "string" || !text.trim()) {
            continue;
        }

        fallbackTexts.push(text.trim());

        if (record.thought !== true) {
            answerTexts.push(text.trim());
        }
    }

    const texts =
        answerTexts.length > 0
            ? answerTexts
            : fallbackTexts;

    return texts.at(-1)?.trim() || "";
}

function extractFinishReason(value: unknown): string {
    if (!value || typeof value !== "object") {
        return "unknown";
    }

    const root = value as Record<string, unknown>;
    const candidates = Array.isArray(root.candidates)
        ? root.candidates
        : [];
    const first = candidates[0];

    if (!first || typeof first !== "object") {
        return "unknown";
    }

    const finishReason = (
        first as Record<string, unknown>
    ).finishReason;

    return typeof finishReason === "string"
        ? finishReason
        : "unknown";
}

export class GeminiImageAIProvider
implements ImageAIProvider {
    readonly name = "gemini" as const;

    constructor(private readonly env: Env) {}

    isConfigured(): boolean {
        return !!this.env.GEMINI_API_KEY?.trim();
    }

    async analyze(
        image: LoadedImage
    ): Promise<ImageAIProviderResponse> {
        const apiKey =
            this.env.GEMINI_API_KEY?.trim();

        if (!apiKey) {
            throw new Error(
                "GEMINI_API_KEY is not configured"
            );
        }

        const model =
            this.env.GEMINI_IMAGE_MODEL?.trim() ||
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
                    contents: [
                        {
                            role: "user",
                            parts: [
                                {
                                    text: IMAGE_AI_PROMPT,
                                },
                                {
                                    inlineData: {
                                        mimeType:
                                            image.mime_type,
                                        data: image.base64,
                                    },
                                },
                            ],
                        },
                    ],
                    generationConfig: {
                        temperature: 0,
                        candidateCount: 1,
                        maxOutputTokens: 1024,
                        responseMimeType:
                            "application/json",
                        responseJsonSchema:
                            IMAGE_ANALYSIS_JSON_SCHEMA,
                        thinkingConfig: {
                            thinkingBudget: 0,
                        },
                    },
                }),
                }
            );
        } catch (error) {
            throw new OperationalError(
                "GEMINI_IMAGE_NETWORK_ERROR",
                `Gemini image analysis network error: ${
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
            body = { raw: bodyText.slice(0, 1000) };
        }

        if (!response.ok) {
            throw createHttpOperationalError(
                "Gemini",
                "image analysis",
                response.status,
                JSON.stringify(body).slice(0, 1000)
            );
        }

        const raw = extractGeminiText(body);

        if (!raw) {
            throw new Error(
                `Gemini returned an empty response (finishReason=${extractFinishReason(body)})`
            );
        }

        return {
            provider: this.name,
            raw_text: raw,
        };
    }
}
