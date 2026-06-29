import type { Env } from "../../config/env";
import type { CommerceDashboardSummary, DashboardLanguage } from "./commerce-dashboard.service";
import { getCommerceDashboardSummary } from "./commerce-dashboard.service";
import type { DashboardPeriod } from "./dashboard-period";

export type AiAnalysisScope = "all" | "line" | "marketplaces";

export type AiBusinessAnalysisResponse = {
    request_id: string;
    generated_at: string;
    data_updated_at: string;
    prompt_version: "lark-business-analysis-v1";
    period: CommerceDashboardSummary["period"];
    scope: AiAnalysisScope;
    language: DashboardLanguage;
    metrics: {
        urgent_actions: number;
        hot_leads: number;
        revenue_change_percent: number;
        data_confidence_percent: number;
    };
    headline: string;
    executive_summary: string;
    priority_items: string[];
    opportunity_items: string[];
    sales_items: string[];
    risk_items: string[];
    recommended_actions: Array<{
        title: string;
        description: string;
        target_work_queue: string | null;
    }>;
};

export class AiBusinessAnalysisError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status: number
    ) {
        super(message);
        this.name = "AiBusinessAnalysisError";
    }
}

type WorkflowNarrative = {
    headline: string;
    executive_summary: string;
    priority_items: string[];
    opportunity_items: string[];
    sales_items: string[];
    risk_items: string[];
    recommended_actions: Array<{
        title: string;
        description: string;
        target_work_queue?: string | null;
    }>;
};

const PROMPT_VERSION = "lark-business-analysis-v1" as const;
const ALLOWED_TARGETS = new Set([
    "payment_review",
    "waiting_new_slip",
    "waiting_payment",
    "missing_delivery",
    "ready_to_ship",
    "hot_lead",
    "marketplace_ready_to_ship",
]);

function text(value: unknown, max = 1_500): string {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function textList(value: unknown, maxItems = 5): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => text(item, 500)).filter(Boolean).slice(0, maxItems);
}

function parseJsonText(value: string): unknown {
    const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(trimmed) as unknown;
}

function unwrapWorkflowResponse(value: unknown): unknown {
    if (typeof value === "string") return parseJsonText(value);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
    const object = value as Record<string, unknown>;
    for (const key of ["analysis", "analysis_json", "result", "output", "data"]) {
        const nested = object[key];
        if (typeof nested === "string") {
            try {
                return parseJsonText(nested);
            } catch {
                continue;
            }
        }
        if (nested && typeof nested === "object" && !Array.isArray(nested)) return nested;
    }
    return object;
}

function validateNarrative(value: unknown): WorkflowNarrative {
    const unwrapped = unwrapWorkflowResponse(value);
    if (typeof unwrapped !== "object" || unwrapped === null || Array.isArray(unwrapped)) {
        throw new AiBusinessAnalysisError(
            "LARK_AI_RESPONSE_INVALID",
            "Lark AI workflow returned an invalid response",
            502
        );
    }
    const object = unwrapped as Record<string, unknown>;
    const actions = Array.isArray(object.recommended_actions)
        ? object.recommended_actions.slice(0, 5).map((item) => {
            const row = typeof item === "object" && item !== null && !Array.isArray(item)
                ? (item as Record<string, unknown>)
                : {};
            const target = text(row.target_work_queue, 80);
            return {
                title: text(row.title, 180),
                description: text(row.description, 500),
                target_work_queue: ALLOWED_TARGETS.has(target) ? target : null,
            };
        }).filter((item) => item.title && item.description)
        : [];
    const narrative: WorkflowNarrative = {
        headline: text(object.headline, 250),
        executive_summary: text(object.executive_summary, 2_000),
        priority_items: textList(object.priority_items),
        opportunity_items: textList(object.opportunity_items),
        sales_items: textList(object.sales_items),
        risk_items: textList(object.risk_items),
        recommended_actions: actions,
    };
    if (!narrative.headline || !narrative.executive_summary) {
        throw new AiBusinessAnalysisError(
            "LARK_AI_RESPONSE_INVALID",
            "Lark AI workflow response is incomplete",
            502
        );
    }
    return narrative;
}

function scopeSnapshot(summary: CommerceDashboardSummary, scope: AiAnalysisScope) {
    const channels = scope === "line"
        ? summary.channels.filter((item) => item.channel === "LINE")
        : scope === "marketplaces"
          ? summary.channels.filter((item) => item.channel !== "LINE")
          : summary.channels;
    return {
        period: summary.period,
        scope,
        totals: summary.totals,
        changes: summary.changes,
        channels,
        revenue_trend: summary.revenue_trend,
        action_counts: summary.action_counts,
        pipeline_stages: summary.pipeline_stages,
        sales_performance: summary.sales_performance,
        order_statuses: summary.order_statuses,
        data_quality: summary.data_quality,
        data_updated_at: summary.updated_at,
        scope_note:
            scope === "all"
                ? "All metrics cover the whole business."
                : "All metrics in this payload are filtered to the selected channel scope.",
    };
}

function buildPrompt(language: DashboardLanguage): string {
    const outputLanguage = language === "th" ? "Thai" : "English";
    return [
        `You are Lark AI acting as a careful business analyst for an omnichannel commerce CRM.`,
        `Write all user-facing content in ${outputLanguage}.`,
        `Use only numbers and facts contained in analytics_payload. Never invent, recalculate, estimate or alter numeric values.`,
        `Respect scope_note. If a metric is organization-wide, do not claim it is channel-specific.`,
        `Prioritize operationally useful insights: payment review, waiting new slip, waiting payment, missing delivery data, shipping, hot leads, marketplace shipping, pipeline, channel mix and sales workload.`,
        `Do not make accusations about employees. Use neutral language and explain context.`,
        `Return strict JSON only with keys: headline, executive_summary, priority_items, opportunity_items, sales_items, risk_items, recommended_actions.`,
        `Each *_items value is an array of up to 4 concise strings.`,
        `recommended_actions is an array of up to 3 objects with title, description, target_work_queue.`,
        `target_work_queue may be one of payment_review, waiting_new_slip, waiting_payment, missing_delivery, ready_to_ship, hot_lead, marketplace_ready_to_ship, or null.`,
    ].join("\n");
}

function confidence(summary: CommerceDashboardSummary): number {
    const issues =
        summary.data_quality.paid_orders_missing_paid_at +
        summary.data_quality.unknown_channel_orders;
    return Math.max(70, Math.min(100, 100 - issues * 3));
}

export async function generateAiBusinessAnalysis(
    env: Env,
    input: {
        language: DashboardLanguage;
        scope: AiAnalysisScope;
        period: DashboardPeriod;
    }
): Promise<AiBusinessAnalysisResponse> {
    const webhookUrl = env.LARK_AI_WORKFLOW_WEBHOOK_URL?.trim();
    if (!webhookUrl) {
        throw new AiBusinessAnalysisError(
            "LARK_AI_WORKFLOW_NOT_CONFIGURED",
            "Lark AI workflow is not configured",
            503
        );
    }
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(webhookUrl);
    } catch {
        throw new AiBusinessAnalysisError(
            "LARK_AI_WORKFLOW_URL_INVALID",
            "Lark AI workflow URL is invalid",
            500
        );
    }
    if (parsedUrl.protocol !== "https:") {
        throw new AiBusinessAnalysisError(
            "LARK_AI_WORKFLOW_URL_INVALID",
            "Lark AI workflow URL must use HTTPS",
            500
        );
    }

    const summary = await getCommerceDashboardSummary(
        env,
        input.language,
        input.period,
        Date.now(),
        input.scope
    );
    const requestId = crypto.randomUUID();
    const configuredTimeout = Number(env.LARK_AI_WORKFLOW_TIMEOUT_MS ?? 45_000);
    const timeout = Math.min(
        Math.max(Number.isFinite(configuredTimeout) ? configuredTimeout : 45_000, 5_000),
        90_000
    );
    const headers = new Headers({ "Content-Type": "application/json" });
    const token = env.LARK_AI_WORKFLOW_TOKEN?.trim();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let response: Response;
    try {
        response = await fetch(parsedUrl.toString(), {
            method: "POST",
            headers,
            body: JSON.stringify({
                request_id: requestId,
                prompt_version: PROMPT_VERSION,
                prompt: buildPrompt(input.language),
                analytics_payload: scopeSnapshot(summary, input.scope),
            }),
            signal: AbortSignal.timeout(timeout),
        });
    } catch (error) {
        throw new AiBusinessAnalysisError(
            "LARK_AI_WORKFLOW_UNAVAILABLE",
            error instanceof Error ? error.message : "Lark AI workflow is unavailable",
            502
        );
    }
    if (!response.ok) {
        throw new AiBusinessAnalysisError(
            "LARK_AI_WORKFLOW_FAILED",
            `Lark AI workflow failed with HTTP ${response.status}`,
            502
        );
    }
    const raw = (response.headers.get("content-type") ?? "").includes("application/json")
        ? await response.json()
        : await response.text();
    const narrative = validateNarrative(raw);

    return {
        request_id: requestId,
        generated_at: new Date().toISOString(),
        data_updated_at: summary.updated_at,
        prompt_version: PROMPT_VERSION,
        period: summary.period,
        scope: input.scope,
        language: input.language,
        metrics: {
            urgent_actions: summary.action_counts.total,
            hot_leads: summary.action_counts.hot_leads,
            revenue_change_percent: summary.changes.revenue_percent,
            data_confidence_percent: confidence(summary),
        },
        ...narrative,
        recommended_actions: narrative.recommended_actions.map((item) => ({
            ...item,
            target_work_queue: item.target_work_queue ?? null,
        })),
    };
}
