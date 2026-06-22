import type {
    ImageAnalysisResult,
} from "./image-ai.types";

export type ActionIntent =
    | "greeting"
    | "general_inquiry"
    | "ask_price"
    | "ask_discount"
    | "product_info"
    | "product_order"
    | "payment_request"
    | "payment_slip"
    | "delivery_address"
    | "delivery_question"
    | "lost"
    | "support"
    | "small_talk"
    | "image_received"
    | "unknown";

// Backward-compatible alias for modules that still import AIIntent.
export type AIIntent = ActionIntent;

export type QuantityAction =
    | "set"
    | "add"
    | "subtract";

export type BuyerIntent =
    | "Just Browsing"
    | "Interested"
    | "Purchase Intent"
    | "Ready To Buy";

export type CustomerStage =
    | "New Lead"
    | "Interested"
    | "Negotiating"
    | "Closing"
    | "Won"
    | "Lost";

export type AIProviderName =
    | "rule_engine"
    | "workers_ai"
    | "gemini"
    | "safe_fallback";

export interface AIAnalysisResult {
    intent: ActionIntent;

    buyer_intent: BuyerIntent;

    customer_stage: CustomerStage;

    lead_score: number;

    hot_lead: boolean;

    ai_summary: string;

    product_name?: string;

    product_size?: string;

    quantity?: number;

    quantity_action?: QuantityAction;

    product_unit?: string;

    address?: string;

    phone?: string;

    provider?: AIProviderName;

    confidence?: number;

    image_ai?: ImageAnalysisResult;
}
