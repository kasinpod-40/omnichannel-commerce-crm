export type ImageType =
    | "product_image"
    | "payment_slip"
    | "other";

export type ImageAIProviderName =
    | "workers_ai"
    | "gemini"
    | "test_override"
    | "safe_fallback";

export type LoadedImage = {
    source_url: string;
    mime_type: string;
    base64: string;
    data_url: string;
    size_bytes: number;
};

export type ImageAnalysisResult = {
    image_type: ImageType;
    product_name: string;
    slip_amount: number;
    slip_bank: string;
    confidence: number;
    summary: string;
    provider: ImageAIProviderName;
    error_message?: string;
};

export type ImageAnalysisOverride = Partial<
    Omit<
        ImageAnalysisResult,
        "provider"
    >
> & {
    image_type: ImageType;
};

export type ImageAIProviderResponse = {
    provider: Exclude<
        ImageAIProviderName,
        "test_override" | "safe_fallback"
    >;
    raw_text: string;
};

export interface ImageAIProvider {
    readonly name: ImageAIProviderResponse["provider"];

    isConfigured(): boolean;

    analyze(
        image: LoadedImage
    ): Promise<ImageAIProviderResponse>;
}
