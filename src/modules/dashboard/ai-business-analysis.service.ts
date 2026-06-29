import type { Env } from "../../config/env";
import type { CommerceDashboardSummary, DashboardLanguage } from "./commerce-dashboard.service";
import { getCommerceDashboardSummary } from "./commerce-dashboard.service";
import type { DashboardPeriod } from "./dashboard-period";

export type AiAnalysisScope = "all" | "line" | "marketplaces";
export type AiAnalysisJobStatus = "pending" | "processing" | "completed" | "failed" | "expired";

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

export type AiBusinessAnalysisStartResponse = {
    request_id: string;
    status: "processing";
    poll_after_ms: number;
    expires_at: string;
    period: CommerceDashboardSummary["period"];
    scope: AiAnalysisScope;
    language: DashboardLanguage;
};

export type AiBusinessAnalysisJobResponse =
    | {
        request_id: string;
        status: "pending" | "processing";
        poll_after_ms: number;
        expires_at: string;
    }
    | {
        request_id: string;
        status: "completed";
        result: AiBusinessAnalysisResponse;
    }
    | {
        request_id: string;
        status: "failed" | "expired";
        error: { code: string; message: string };
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

type StoredAiAnalysisJob = {
    version: 1;
    request_id: string;
    status: AiAnalysisJobStatus;
    created_at: string;
    expires_at: string;
    data_updated_at: string;
    prompt_version: "lark-business-analysis-v1";
    period: CommerceDashboardSummary["period"];
    scope: AiAnalysisScope;
    language: DashboardLanguage;
    metrics: AiBusinessAnalysisResponse["metrics"];
    result?: AiBusinessAnalysisResponse;
    error?: { code: string; message: string };
};

const PROMPT_VERSION = "lark-business-analysis-v1" as const;
const JOB_PREFIX = "ai-analysis-job:";
const JOB_TTL_SECONDS = 15 * 60;
const POLL_AFTER_MS = 1_500;
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

export function validateAiBusinessNarrative(value: unknown): WorkflowNarrative {
    const unwrapped = unwrapWorkflowResponse(value);
    if (typeof unwrapped !== "object" || unwrapped === null || Array.isArray(unwrapped)) {
        throw new AiBusinessAnalysisError(
            "LARK_AI_RESPONSE_INVALID",
            "Lark AI workflow returned an invalid response",
            400
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
            400
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
        `Use only numbers and facts contained in analytics_json. Never invent, recalculate, estimate or alter numeric values.`,
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

function requireJobStore(env: Env): KVNamespace {
    const store = env.AI_ANALYSIS_JOBS ?? env.MARKETPLACE_TOKENS;
    if (!store) {
        throw new AiBusinessAnalysisError(
            "AI_ANALYSIS_STORE_NOT_CONFIGURED",
            "AI analysis job store is not configured",
            503
        );
    }
    return store;
}

function jobKey(requestId: string): string {
    return `${JOB_PREFIX}${requestId}`;
}

async function writeJob(env: Env, job: StoredAiAnalysisJob): Promise<void> {
    await requireJobStore(env).put(jobKey(job.request_id), JSON.stringify(job), {
        expirationTtl: JOB_TTL_SECONDS,
    });
}

async function readJob(env: Env, requestId: string): Promise<StoredAiAnalysisJob | null> {
    const raw = await requireJobStore(env).get(jobKey(requestId));
    if (!raw) return null;
    try {
        return JSON.parse(raw) as StoredAiAnalysisJob;
    } catch {
        return null;
    }
}

function validateWebhookUrl(env: Env): URL {
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
    if (!env.LARK_AI_CALLBACK_TOKEN?.trim()) {
        throw new AiBusinessAnalysisError(
            "LARK_AI_CALLBACK_NOT_CONFIGURED",
            "Lark AI callback token is not configured",
            503
        );
    }
    return parsedUrl;
}

function periodLabel(period: CommerceDashboardSummary["period"], language: DashboardLanguage): string {
    if (period.mode === "range") {
        const [startValue = "", endValue = ""] = period.value.split("..");
        const format = (value: string) => {
            const [year, month, day] = value.split("-").map(Number);
            return new Intl.DateTimeFormat(language === "th" ? "th-TH-u-ca-gregory" : "en-US", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Bangkok",
            }).format(new Date(Date.UTC(year, (month || 1) - 1, day || 1)));
        };
        return `${format(startValue)} – ${format(endValue)}`;
    }
    if (period.mode === "year") return language === "th" ? `ปี ${period.value}` : period.value;
    if (period.mode === "month") {
        const [year, month] = period.value.split("-").map(Number);
        return new Intl.DateTimeFormat(language === "th" ? "th-TH-u-ca-gregory" : "en-US", {
            month: "long",
            year: "numeric",
            timeZone: "Asia/Bangkok",
        }).format(new Date(Date.UTC(year, (month || 1) - 1, 1)));
    }
    const [year, month, day] = period.value.split("-").map(Number);
    return new Intl.DateTimeFormat(language === "th" ? "th-TH-u-ca-gregory" : "en-US", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Asia/Bangkok",
    }).format(new Date(Date.UTC(year, (month || 1) - 1, day || 1)));
}

export async function startAiBusinessAnalysis(
    env: Env,
    input: {
        language: DashboardLanguage;
        scope: AiAnalysisScope;
        period: DashboardPeriod;
    }
): Promise<AiBusinessAnalysisStartResponse> {
    const webhookUrl = validateWebhookUrl(env);
    const summary = await getCommerceDashboardSummary(
        env,
        input.language,
        input.period,
        Date.now(),
        input.scope
    );
    const requestId = crypto.randomUUID();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + JOB_TTL_SECONDS * 1_000);
    const metrics: AiBusinessAnalysisResponse["metrics"] = {
        urgent_actions: summary.action_counts.total,
        hot_leads: summary.action_counts.hot_leads,
        revenue_change_percent: summary.changes.revenue_percent,
        data_confidence_percent: confidence(summary),
    };
    const job: StoredAiAnalysisJob = {
        version: 1,
        request_id: requestId,
        status: "pending",
        created_at: createdAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        data_updated_at: summary.updated_at,
        prompt_version: PROMPT_VERSION,
        period: summary.period,
        scope: input.scope,
        language: input.language,
        metrics,
    };
    await writeJob(env, job);

    const headers = new Headers({ "Content-Type": "application/json" });
    const token = env.LARK_AI_WORKFLOW_TOKEN?.trim();
    if (token) headers.set("Authorization", `Bearer ${token}`);

    try {
        const response = await fetch(webhookUrl.toString(), {
            method: "POST",
            headers,
            body: JSON.stringify({
                request_id: requestId,
                prompt_version: PROMPT_VERSION,
                language: input.language,
                period_type: summary.period.mode,
                period_label: periodLabel(summary.period, input.language),
                scope: input.scope,
                prompt: buildPrompt(input.language),
                analytics_json: JSON.stringify(scopeSnapshot(summary, input.scope)),
            }),
            signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            const accepted = await response.json().catch(() => null) as Record<string, unknown> | null;
            if (accepted && typeof accepted.code === "number" && accepted.code !== 0) {
                throw new Error(`Lark code ${accepted.code}`);
            }
        }
        job.status = "processing";
        await writeJob(env, job);
    } catch (error) {
        job.status = "failed";
        job.error = {
            code: "LARK_AI_WORKFLOW_UNAVAILABLE",
            message: error instanceof Error ? error.message : "Lark AI workflow is unavailable",
        };
        await writeJob(env, job);
        throw new AiBusinessAnalysisError(
            "LARK_AI_WORKFLOW_UNAVAILABLE",
            "Lark AI workflow is unavailable",
            502
        );
    }

    return {
        request_id: requestId,
        status: "processing",
        poll_after_ms: POLL_AFTER_MS,
        expires_at: expiresAt.toISOString(),
        period: summary.period,
        scope: input.scope,
        language: input.language,
    };
}

export async function getAiBusinessAnalysisJob(
    env: Env,
    requestId: string
): Promise<AiBusinessAnalysisJobResponse> {
    const job = await readJob(env, requestId);
    if (!job) {
        throw new AiBusinessAnalysisError(
            "AI_ANALYSIS_NOT_FOUND",
            "AI analysis job was not found",
            404
        );
    }
    if (job.status !== "completed" && Date.now() >= Date.parse(job.expires_at)) {
        job.status = "expired";
        job.error = { code: "AI_ANALYSIS_EXPIRED", message: "AI analysis job expired" };
        await writeJob(env, job);
    }
    if (job.status === "completed" && job.result) {
        return { request_id: requestId, status: "completed", result: job.result };
    }
    if (job.status === "failed" || job.status === "expired") {
        return {
            request_id: requestId,
            status: job.status,
            error: job.error ?? { code: "AI_ANALYSIS_FAILED", message: "AI analysis failed" },
        };
    }
    return {
        request_id: requestId,
        status: job.status === "pending" ? "pending" : "processing",
        poll_after_ms: POLL_AFTER_MS,
        expires_at: job.expires_at,
    };
}

export async function completeAiBusinessAnalysis(
    env: Env,
    requestId: string,
    workflowResponse: unknown
): Promise<AiBusinessAnalysisResponse> {
    const job = await readJob(env, requestId);
    if (!job) {
        throw new AiBusinessAnalysisError(
            "AI_ANALYSIS_NOT_FOUND",
            "AI analysis job was not found",
            404
        );
    }
    if (job.status === "completed" && job.result) return job.result;
    if (Date.now() >= Date.parse(job.expires_at)) {
        throw new AiBusinessAnalysisError(
            "AI_ANALYSIS_EXPIRED",
            "AI analysis job expired",
            410
        );
    }
    let narrative: WorkflowNarrative;
    try {
        narrative = validateAiBusinessNarrative(workflowResponse);
    } catch (error) {
        const normalized = error instanceof AiBusinessAnalysisError
            ? error
            : new AiBusinessAnalysisError(
                "LARK_AI_RESPONSE_INVALID",
                "Lark AI workflow returned an invalid response",
                400
            );
        job.status = "failed";
        job.error = { code: normalized.code, message: normalized.message };
        await writeJob(env, job);
        throw normalized;
    }
    const result: AiBusinessAnalysisResponse = {
        request_id: requestId,
        generated_at: new Date().toISOString(),
        data_updated_at: job.data_updated_at,
        prompt_version: job.prompt_version,
        period: job.period,
        scope: job.scope,
        language: job.language,
        metrics: job.metrics,
        ...narrative,
        recommended_actions: narrative.recommended_actions.map((item) => ({
            ...item,
            target_work_queue: item.target_work_queue ?? null,
        })),
    };
    job.status = "completed";
    job.result = result;
    delete job.error;
    await writeJob(env, job);
    return result;
}
