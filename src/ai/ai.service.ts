import type { AIAnalysisResult } from "./ai.types";
import { analyzeByRuleEngine } from "./rule-engine";

export async function analyzeMessage(
    message: string
): Promise<AIAnalysisResult> {
    return analyzeByRuleEngine(message);
}