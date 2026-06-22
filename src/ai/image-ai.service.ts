import { normalizeProductSize } from "../utils/product-size";
import { classifyOperationalError } from "../utils/errors";
import type { Env } from "../config/env";
import { GeminiImageAIProvider } from "../providers/ai/gemini-image-ai.provider";
import type {
    ImageAIProvider,
    ImageAnalysisOverride,
    ImageAnalysisResult,
    ImageAIProviderResponse,
    ImageType,
    LoadedImage,
} from "./image-ai.types";

const MIN_CONFIDENCE = 0.6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function clampConfidence(value: unknown): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return 0;
    }

    return Math.min(1, Math.max(0, parsed));
}

function toNumber(value: unknown): number {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return 0;
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }

    const parsed = Number(
        String(value)
            .replace(/,/g, "")
            .replace(/[^\d.]/g, "")
    );

    return Number.isFinite(parsed) ? parsed : 0;
}

function cleanJsonText(raw: string): string {
    return raw
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
}

function parseJsonValue(raw: string): unknown {
    const parsed = JSON.parse(raw);

    if (typeof parsed === "string") {
        return JSON.parse(parsed);
    }

    return parsed;
}

function parseJsonObject(raw: string): Record<string, unknown> {
    const cleaned = cleanJsonText(raw)
        .replace(/^\uFEFF/, "")
        .trim();

    try {
        const parsed = parseJsonValue(cleaned);

        if (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        ) {
            return parsed as Record<string, unknown>;
        }
    } catch {
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");

        if (start >= 0 && end > start) {
            try {
                const parsed = parseJsonValue(
                    cleaned.slice(start, end + 1)
                );

                if (
                    parsed &&
                    typeof parsed === "object" &&
                    !Array.isArray(parsed)
                ) {
                    return parsed as Record<string, unknown>;
                }
            } catch {
                // Fall through to the detailed error below.
            }
        }
    }

    const preview = cleaned
        .replace(/\s+/g, " ")
        .slice(0, 500);

    throw new Error(
        `Image AI response is not valid JSON: ${preview || "<empty>"}`
    );
}

function normalizeImageType(value: unknown): ImageType {
    if (
        value === "product_image" ||
        value === "payment_slip" ||
        value === "other"
    ) {
        return value;
    }

    return "other";
}

function normalizeProviderResult(
    result: ImageAIProviderResponse
): ImageAnalysisResult {
    const raw = parseJsonObject(result.raw_text);
    const confidence = clampConfidence(raw.confidence);
    let imageType = normalizeImageType(raw.image_type);
    let productName = String(raw.product_name ?? "").trim();
    let productSize = normalizeProductSize(raw.product_size) ?? "";
    let slipAmount = toNumber(raw.slip_amount);
    let slipBank = String(raw.slip_bank ?? "").trim();

    if (confidence < MIN_CONFIDENCE) {
        imageType = "other";
    }

    if (imageType === "product_image" && !productName) {
        imageType = "other";
    }

    if (imageType !== "product_image") {
        productName = "";
        productSize = "";
    }

    if (imageType !== "payment_slip") {
        slipAmount = 0;
        slipBank = "";
    }

    const defaultSummary =
        imageType === "product_image"
            ? `ลูกค้าส่งรูปสินค้า${productName ? `: ${productName}` : ""}`
            : imageType === "payment_slip"
              ? "ลูกค้าส่งหลักฐานการชำระเงินแล้ว รอ Sales ตรวจสอบ"
              : "ลูกค้าส่งรูปภาพทั่วไป";

    return {
        image_type: imageType,
        product_name: productName,
        product_size: productSize,
        slip_amount: slipAmount,
        slip_bank: slipBank,
        confidence,
        summary:
            String(raw.summary ?? "").trim() ||
            defaultSummary,
        provider: result.provider,
    };
}

function normalizeOverride(
    override: ImageAnalysisOverride
): ImageAnalysisResult {
    const confidence = clampConfidence(
        override.confidence ?? 0.99
    );
    let imageType = normalizeImageType(
        override.image_type
    );
    let productName =
        override.product_name?.trim() || "";
    let productSize =
        normalizeProductSize(override.product_size) ?? "";
    let slipAmount = toNumber(
        override.slip_amount
    );
    let slipBank =
        override.slip_bank?.trim() || "";

    if (confidence < MIN_CONFIDENCE) {
        imageType = "other";
    }

    if (imageType === "product_image" && !productName) {
        imageType = "other";
    }

    if (imageType !== "product_image") {
        productName = "";
        productSize = "";
    }

    if (imageType !== "payment_slip") {
        slipAmount = 0;
        slipBank = "";
    }

    return {
        image_type: imageType,
        product_name: productName,
        product_size: productSize,
        slip_amount: slipAmount,
        slip_bank: slipBank,
        confidence,
        summary:
            override.summary?.trim() ||
            (imageType === "product_image"
                ? `ลูกค้าส่งรูปสินค้า: ${productName}`
                : imageType === "payment_slip"
                  ? "ลูกค้าส่งหลักฐานการชำระเงินแล้ว รอ Sales ตรวจสอบ"
                  : "ลูกค้าส่งรูปภาพทั่วไป"),
        provider: "test_override",
    };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = "";

    for (
        let index = 0;
        index < bytes.length;
        index += chunkSize
    ) {
        const chunk = bytes.subarray(
            index,
            index + chunkSize
        );
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

function createLoadedImage(
    buffer: ArrayBuffer,
    mimeType: string,
    sourceUrl: string
): LoadedImage {
    const normalizedMimeType =
        mimeType.split(";")[0]?.trim() || "image/jpeg";

    if (!normalizedMimeType.startsWith("image/")) {
        throw new Error(
            `Unsupported image content type: ${normalizedMimeType}`
        );
    }

    if (buffer.byteLength === 0) {
        throw new Error("Image is empty");
    }

    if (buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error(
            `Image is too large for AI analysis: ${buffer.byteLength} bytes`
        );
    }

    const base64 = arrayBufferToBase64(buffer);

    return {
        source_url: sourceUrl,
        mime_type: normalizedMimeType,
        base64,
        data_url: `data:${normalizedMimeType};base64,${base64}`,
        size_bytes: buffer.byteLength,
    };
}

async function loadImage(imageUrl: string): Promise<LoadedImage> {
    const response = await fetch(imageUrl);

    if (!response.ok) {
        throw new Error(
            `Image fetch failed: ${response.status}`
        );
    }

    const buffer = await response.arrayBuffer();
    const mimeType =
        response.headers.get("content-type") || "image/jpeg";

    return createLoadedImage(
        buffer,
        mimeType,
        imageUrl
    );
}

function safeFallback(
    errorMessages: string[]
): ImageAnalysisResult {
    return {
        image_type: "other",
        product_name: "",
        product_size: "",
        slip_amount: 0,
        slip_bank: "",
        confidence: 0,
        summary:
            "ลูกค้าส่งรูปภาพ แต่ระบบยังวิเคราะห์รูปไม่ได้",
        provider: "safe_fallback",
        error_message: errorMessages.join(" | ").slice(0, 1000),
    };
}

async function analyzeLoadedImage(
    env: Env,
    image: LoadedImage
): Promise<ImageAnalysisResult> {
    const errors: string[] = [];
    const providers: ImageAIProvider[] = [
        new GeminiImageAIProvider(env),
    ];

    for (const provider of providers) {
        if (!provider.isConfigured()) {
            continue;
        }

        try {
            const rawResult = await provider.analyze(image);
            return normalizeProviderResult(rawResult);
        } catch (error) {
            const classification =
                classifyOperationalError(error);
            const message = classification.message;

            errors.push(`${provider.name}: ${message}`);
            console.warn(
                `IMAGE_AI_${provider.name.toUpperCase()}_FAILED`,
                {
                    code: classification.code,
                    retryable: classification.retryable,
                    status: classification.status,
                    message,
                }
            );

            if (classification.retryable) {
                throw error;
            }
        }
    }

    if (errors.length === 0) {
        errors.push("No image AI provider is configured");
    }

    return safeFallback(errors);
}

export async function analyzeImageBytes(
    env: Env,
    buffer: ArrayBuffer,
    mimeType: string,
    sourceUrl = "memory://image"
): Promise<ImageAnalysisResult> {
    try {
        const image = createLoadedImage(
            buffer,
            mimeType,
            sourceUrl
        );
        return await analyzeLoadedImage(env, image);
    } catch (error) {
        const classification =
            classifyOperationalError(error);

        if (classification.retryable) {
            throw error;
        }

        return safeFallback([
            classification.message,
        ]);
    }
}

export async function analyzeImage(
    env: Env,
    imageUrl: string,
    override?: ImageAnalysisOverride
): Promise<ImageAnalysisResult> {
    if (override) {
        return normalizeOverride(override);
    }

    try {
        const image = await loadImage(imageUrl);
        return await analyzeLoadedImage(env, image);
    } catch (error) {
        const classification =
            classifyOperationalError(error);

        if (classification.retryable) {
            throw error;
        }

        return safeFallback([
            classification.message,
        ]);
    }
}
