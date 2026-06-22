import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeImageBytes } from "./image-ai.service";
import { classifyOperationalError } from "../utils/errors";

const env = {
    GEMINI_API_KEY: "test-key",
    GEMINI_IMAGE_MODEL: "test-model",
} as any;

function imageBytes(): ArrayBuffer {
    return new Uint8Array([1, 2, 3]).buffer;
}

describe("image AI retry policy", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("bubbles Gemini 503 so the Queue can retry", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        error: {
                            message: "high demand",
                        },
                    }),
                    {
                        status: 503,
                        headers: {
                            "Content-Type": "application/json",
                        },
                    }
                )
            )
        );

        try {
            await analyzeImageBytes(
                env,
                imageBytes(),
                "image/jpeg"
            );
            throw new Error("expected rejection");
        } catch (error) {
            expect(
                classifyOperationalError(error).retryable
            ).toBe(true);
        }
    });

    it("uses a safe fallback for permanent Gemini 401", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        error: {
                            message: "invalid API key",
                        },
                    }),
                    {
                        status: 401,
                        headers: {
                            "Content-Type": "application/json",
                        },
                    }
                )
            )
        );

        const result = await analyzeImageBytes(
            env,
            imageBytes(),
            "image/jpeg"
        );

        expect(result.provider).toBe("safe_fallback");
        expect(result.error_message).toContain("401");
    });
});
