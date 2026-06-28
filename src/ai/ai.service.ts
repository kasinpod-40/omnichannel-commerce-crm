import type { Env } from "../config/env";
import { isOpenSalesStage } from "../core/sales-stage";
import type { MessageType } from "../modules/conversations/conversation.types";
import { analyzeTextWithGemini, isGeminiTextAIConfigured } from "./gemini";
import { analyzeImage } from "./image-ai.service";
import type {
    ImageAnalysisOverride,
    ImageAnalysisResult,
} from "./image-ai.types";
import type {
    AIAnalysisResult,
    ActionIntent,
    AIProviderName,
    BuyerIntent,
    CustomerStage,
    QuantityAction,
} from "./ai.types";
import { analyzeByRuleEngine } from "./rule-engine";
import {
    analyzeTextWithWorkersAI,
    isWorkersTextAIConfigured,
} from "./workers-ai";
import {
    extractPhoneNumber,
    normalizePhoneNumber,
} from "../utils/phone";
import { normalizeProductSize } from "../utils/product-size";
import { classifyOperationalError } from "../utils/errors";

const MIN_TEXT_AI_CONFIDENCE = 0.6;

const ACTION_INTENTS = new Set<ActionIntent>([
    "greeting",
    "general_inquiry",
    "ask_price",
    "ask_discount",
    "product_info",
    "product_order",
    "payment_request",
    "payment_slip",
    "delivery_address",
    "delivery_question",
    "lost",
    "support",
    "small_talk",
    "unknown",
]);

const BUYER_INTENTS = new Set<BuyerIntent>([
    "Just Browsing",
    "Interested",
    "Purchase Intent",
    "Ready To Buy",
]);

const QUANTITY_ACTIONS = new Set<QuantityAction>([
    "set",
    "add",
    "subtract",
]);

function cleanJsonText(raw: string): string {
    return raw
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();
}

function parseJsonObject(raw: string): Record<string, unknown> {
    const cleaned = cleanJsonText(raw);

    try {
        const parsed = JSON.parse(cleaned);

        if (parsed && typeof parsed === "object") {
            return parsed as Record<string, unknown>;
        }
    } catch {
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");

        if (start >= 0 && end > start) {
            const parsed = JSON.parse(cleaned.slice(start, end + 1));

            if (parsed && typeof parsed === "object") {
                return parsed as Record<string, unknown>;
            }
        }
    }

    throw new Error("Text AI response is not valid JSON");
}

function clampNumber(value: unknown, min: number, max: number): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return min;
    }

    return Math.min(max, Math.max(min, parsed));
}

function positiveInteger(value: unknown): number | undefined {
    const parsed = Math.trunc(Number(value));

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return undefined;
    }

    return parsed;
}

function normalizeIntent(value: unknown): ActionIntent {
    return typeof value === "string" &&
        ACTION_INTENTS.has(value as ActionIntent)
        ? (value as ActionIntent)
        : "unknown";
}

function normalizeBuyerIntent(value: unknown): BuyerIntent {
    return typeof value === "string" &&
        BUYER_INTENTS.has(value as BuyerIntent)
        ? (value as BuyerIntent)
        : "Just Browsing";
}

function normalizeCustomerStage(value: unknown): CustomerStage {
    // Text AI may classify active stages or Lost, but never closes a sale as Won.
    return isOpenSalesStage(value) || value === "Lost"
        ? value
        : "New Lead";
}

function normalizeQuantityAction(value: unknown): QuantityAction | undefined {
    return typeof value === "string" &&
        QUANTITY_ACTIONS.has(value as QuantityAction)
        ? (value as QuantityAction)
        : undefined;
}

function normalizeBoolean(value: unknown): boolean {
    if (typeof value === "boolean") {
        return value;
    }

    return String(value).trim().toLowerCase() === "true";
}

function enforceBusinessSafety(
    result: AIAnalysisResult
): AIAnalysisResult {
    if (result.intent === "lost") {
        return {
            ...result,
            buyer_intent: "Just Browsing",
            customer_stage: "Lost",
            lead_score: 0,
            hot_lead: false,
        };
    }

    if (
        result.intent === "greeting" ||
        result.intent === "general_inquiry" ||
        result.intent === "support" ||
        result.intent === "small_talk" ||
        result.intent === "unknown"
    ) {
        return {
            ...result,
            buyer_intent: "Just Browsing",
            customer_stage: "New Lead",
            lead_score: Math.min(result.lead_score, 10),
            hot_lead: false,
        };
    }

    if (result.intent === "ask_price") {
        return {
            ...result,
            buyer_intent:
                result.buyer_intent === "Just Browsing"
                    ? "Interested"
                    : result.buyer_intent,
            customer_stage: "Interested",
            lead_score: Math.min(Math.max(result.lead_score, 25), 55),
            hot_lead: false,
        };
    }

    if (result.intent === "ask_discount") {
        return {
            ...result,
            buyer_intent:
                result.buyer_intent === "Ready To Buy"
                    ? "Ready To Buy"
                    : "Purchase Intent",
            customer_stage:
                result.customer_stage === "Closing"
                    ? "Closing"
                    : "Negotiating",
            lead_score: Math.max(result.lead_score, 65),
            hot_lead:
                result.buyer_intent === "Ready To Buy" ||
                result.lead_score >= 80,
        };
    }

    if (
        result.intent === "product_order" ||
        result.intent === "payment_request" ||
        result.intent === "payment_slip" ||
        result.intent === "delivery_address"
    ) {
        return {
            ...result,
            buyer_intent: "Ready To Buy",
            customer_stage: "Closing",
            lead_score: Math.max(result.lead_score, 80),
            hot_lead: true,
        };
    }

    return {
        ...result,
        hot_lead:
            result.hot_lead ||
            result.lead_score >= 80 ||
            result.buyer_intent === "Ready To Buy",
    };
}

function attachMessagePhone(
    result: AIAnalysisResult,
    message: string
): AIAnalysisResult {
    const phone =
        extractPhoneNumber(message) ??
        normalizePhoneNumber(result.phone);

    if (!phone) {
        return result;
    }

    return {
        ...result,
        phone,
    };
}

function normalizeTextAIResult(
    rawText: string,
    provider: AIProviderName
): AIAnalysisResult {
    const raw = parseJsonObject(rawText);
    const intent = normalizeIntent(raw.intent);
    const confidence = clampNumber(raw.confidence, 0, 1);
    const quantity = positiveInteger(raw.quantity);
    const productName = String(raw.product_name ?? "").trim();
    const productSize = normalizeProductSize(raw.product_size);
    const productUnit = String(raw.product_unit ?? "").trim();
    const address = String(raw.address ?? "").trim();
    const phone = normalizePhoneNumber(
        String(raw.phone ?? "")
    );
    const summary = String(raw.ai_summary ?? "").trim();

    const result: AIAnalysisResult = {
        intent,
        buyer_intent: normalizeBuyerIntent(raw.buyer_intent),
        customer_stage: normalizeCustomerStage(raw.customer_stage),
        lead_score: Math.round(clampNumber(raw.lead_score, 0, 100)),
        hot_lead: normalizeBoolean(raw.hot_lead),
        ai_summary:
            summary || "AI วิเคราะห์ข้อความลูกค้าแล้ว",
        provider,
        confidence,
    };

    if (productName) {
        result.product_name = productName;
    }

    if (productSize) {
        result.product_size = productSize;
    }

    if (quantity) {
        result.quantity = quantity;
    }

    const quantityAction = normalizeQuantityAction(raw.quantity_action);

    if (quantityAction) {
        result.quantity_action = quantityAction;
    }

    if (productUnit) {
        result.product_unit = productUnit;
    }

    if (address) {
        result.address = address;
    }

    if (phone) {
        result.phone = phone;
    }

    return enforceBusinessSafety(result);
}

function withRuleMetadata(result: AIAnalysisResult): AIAnalysisResult {
    return {
        ...result,
        provider: "rule_engine",
        confidence: 1,
    };
}

export async function analyzeMessage(
    env: Env,
    message: string
): Promise<AIAnalysisResult> {
    const ruleResult = analyzeByRuleEngine(message);

    if (ruleResult.intent !== "unknown") {
        return attachMessagePhone(
            withRuleMetadata(ruleResult),
            message
        );
    }

    const errors: string[] = [];
    const retryableErrors: unknown[] = [];
    let providerResponded = false;

    if (isWorkersTextAIConfigured(env)) {
        try {
            const raw = await analyzeTextWithWorkersAI(env, message);
            providerResponded = true;
            const result = normalizeTextAIResult(raw, "workers_ai");

            if (
                result.intent !== "unknown" &&
                (result.confidence ?? 0) >= MIN_TEXT_AI_CONFIDENCE
            ) {
                return attachMessagePhone(result, message);
            }

            errors.push(
                `workers_ai: low confidence or unknown (${result.confidence ?? 0})`
            );
        } catch (error) {
            const classification = classifyOperationalError(error);
            errors.push(`workers_ai: ${classification.message}`);

            if (classification.retryable) {
                retryableErrors.push(error);
            }

            console.warn("TEXT_AI_WORKERS_AI_FAILED", {
                code: classification.code,
                retryable: classification.retryable,
                status: classification.status,
                message: classification.message,
            });
        }
    }

    if (isGeminiTextAIConfigured(env)) {
        try {
            const raw = await analyzeTextWithGemini(env, message);
            providerResponded = true;
            const result = normalizeTextAIResult(raw, "gemini");

            if ((result.confidence ?? 0) >= MIN_TEXT_AI_CONFIDENCE) {
                return attachMessagePhone(result, message);
            }

            errors.push(
                `gemini: low confidence (${result.confidence ?? 0})`
            );
        } catch (error) {
            const classification = classifyOperationalError(error);
            errors.push(`gemini: ${classification.message}`);

            if (classification.retryable) {
                retryableErrors.push(error);
            }

            console.warn("TEXT_AI_GEMINI_FAILED", {
                code: classification.code,
                retryable: classification.retryable,
                status: classification.status,
                message: classification.message,
            });
        }
    }

    /*
     * If every configured provider failed before returning a usable response
     * and at least one failure is transient, bubble the transient error to the
     * Queue. This prevents a temporary 429/503 from being acknowledged as an
     * "unknown" customer message. A low-confidence provider response is still
     * allowed to fall back safely because the provider itself was available.
     */
    if (!providerResponded && retryableErrors.length > 0) {
        throw retryableErrors.at(-1);
    }

    if (errors.length > 0) {
        console.warn("TEXT_AI_SAFE_FALLBACK", errors.join(" | "));
    }

    return attachMessagePhone(
        {
            ...ruleResult,
            provider: "safe_fallback",
            confidence: 0,
        },
        message
    );
}

function mapImageAnalysisToAI(
    image: ImageAnalysisResult
): AIAnalysisResult {
    if (image.image_type === "payment_slip") {
        return {
            intent: "payment_slip",
            buyer_intent: "Ready To Buy",
            customer_stage: "Closing",
            lead_score: 100,
            hot_lead: true,
            ai_summary:
                image.summary ||
                "ลูกค้าส่งหลักฐานการชำระเงินแล้ว รอ Sales ตรวจสอบ",
            image_ai: image,
            provider:
                image.provider === "gemini"
                    ? "gemini"
                    : "safe_fallback",
            confidence: image.confidence,
        };
    }

    if (image.image_type === "product_image") {
        return {
            intent: "product_info",
            buyer_intent: "Interested",
            customer_stage: "Interested",
            lead_score: 55,
            hot_lead: false,
            ai_summary:
                image.summary ||
                `ลูกค้าส่งรูปสินค้า: ${image.product_name}`,
            product_name: image.product_name,
            product_size: image.product_size || undefined,
            image_ai: image,
            provider:
                image.provider === "gemini"
                    ? "gemini"
                    : "safe_fallback",
            confidence: image.confidence,
        };
    }

    return {
        intent: "image_received",
        buyer_intent: "Just Browsing",
        customer_stage: "New Lead",
        lead_score: 0,
        hot_lead: false,
        ai_summary:
            image.summary ||
            "ลูกค้าส่งรูปภาพทั่วไป",
        image_ai: image,
        provider:
            image.provider === "gemini"
                ? "gemini"
                : "safe_fallback",
        confidence: image.confidence,
    };
}

export async function analyzeIncomingContent(
    env: Env,
    input: {
        message_type: MessageType;
        message: string;
        image_url?: string;
        image_analysis_override?: ImageAnalysisOverride;
        image_analysis_result?: ImageAnalysisResult;
    }
): Promise<AIAnalysisResult> {
    if (input.message_type === "sticker") {
        return mapImageAnalysisToAI({
            image_type: "other",
            product_name: "",
            product_size: "",
            slip_amount: 0,
            slip_bank: "",
            confidence: 1,
            summary: "ลูกค้าส่งสติกเกอร์",
            provider: "safe_fallback",
        });
    }

    if (input.message_type !== "image") {
        return await analyzeMessage(env, input.message);
    }

    if (input.image_analysis_result) {
        return mapImageAnalysisToAI(input.image_analysis_result);
    }

    const imageUrl = input.image_url?.trim();

    if (!imageUrl) {
        return mapImageAnalysisToAI({
            image_type: "other",
            product_name: "",
            product_size: "",
            slip_amount: 0,
            slip_bank: "",
            confidence: 0,
            summary:
                "ลูกค้าส่งรูปภาพ แต่ไม่มี URL สำหรับวิเคราะห์",
            provider: "safe_fallback",
            error_message: "IMAGE_URL_MISSING",
        });
    }

    const imageResult = await analyzeImage(
        env,
        imageUrl,
        input.image_analysis_override
    );

    return mapImageAnalysisToAI(imageResult);
}
