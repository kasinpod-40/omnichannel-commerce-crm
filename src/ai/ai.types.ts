export type AIIntent =
    | "unknown"
    | "just_browsing"
    | "interested"
    | "purchase_intent"
    | "ready_to_buy"
    | "lost";

export type CustomerStage =
    | "New Lead"
    | "Interested"
    | "Negotiating"
    | "Closing"
    | "Won"
    | "Lost";

export interface AIAnalysisResult {
    intent: AIIntent;
    customer_stage: CustomerStage;
    lead_score: number;
    hot_lead: boolean;
    ai_summary: string;
}