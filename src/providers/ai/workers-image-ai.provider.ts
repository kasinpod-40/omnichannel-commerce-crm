import { IMAGE_AI_PROMPT } from "../../ai/image-ai.prompt";
import type {
    ImageAIProvider,
    ImageAIProviderResponse,
    LoadedImage,
} from "../../ai/image-ai.types";
import type { Env } from "../../config/env";

function extractResponseText(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    if (!value || typeof value !== "object") {
        return "";
    }

    const record = value as Record<string, unknown>;

    for (const key of ["response", "result", "text"]) {
        const candidate = record[key];

        if (typeof candidate === "string") {
            return candidate;
        }
    }

    return "";
}

export class WorkersImageAIProvider
implements ImageAIProvider {
    readonly name = "workers_ai" as const;

    constructor(private readonly env: Env) {}

    isConfigured(): boolean {
        return !!this.env.AI;
    }

    async analyze(
        image: LoadedImage
    ): Promise<ImageAIProviderResponse> {
        if (!this.env.AI) {
            throw new Error(
                "Workers AI binding is not configured"
            );
        }

        const model =
            this.env.WORKERS_IMAGE_MODEL?.trim() ||
            "@cf/meta/llama-3.2-11b-vision-instruct";

        const response = await this.env.AI.run(
            model,
            {
                messages: [
                    {
                        role: "system",
                        content:
                            "Return valid JSON only.",
                    },
                    {
                        role: "user",
                        content: IMAGE_AI_PROMPT,
                    },
                ],
                image: image.data_url,
                temperature: 0.1,
                max_tokens: 512,
            }
        );

        const raw = extractResponseText(response);

        if (!raw) {
            throw new Error(
                "Workers AI returned an empty response"
            );
        }

        return {
            provider: this.name,
            raw_text: raw,
        };
    }
}
