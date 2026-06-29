import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    completeAiBusinessAnalysis,
    getAiBusinessAnalysisJob,
    startAiBusinessAnalysis,
} from "./ai-business-analysis.service";
import { parseDashboardPeriod } from "./dashboard-period";

const { getCommerceDashboardSummary } = vi.hoisted(() => ({
    getCommerceDashboardSummary: vi.fn(),
}));

const summaryFixture = {
    period: {
        mode: "day", value: "2026-06-29", start_at: "2026-06-28T17:00:00.000Z",
        end_at: "2026-06-29T17:00:00.000Z", previous_start_at: "2026-06-27T17:00:00.000Z",
        previous_end_at: "2026-06-28T17:00:00.000Z", granularity: "hour",
    },
    totals: { revenue_thb: 1000, total_leads: 2, close_rate_percent: 50, paid_orders: 1, pending_orders: 1 },
    changes: { revenue_percent: 20, leads_percent: 0, close_rate_percent: 10, paid_orders_percent: 0, pending_orders_percent: 0 },
    channels: [{ channel: "LINE", orders: 1, revenue_thb: 1000, share_percent: 100 }],
    revenue_trend: { granularity: "hour", current_period: [], previous_period: [], change_percent: 20 },
    action_counts: { payment_review: 1, waiting_new_slip: 0, waiting_payment: 0, missing_delivery: 0, ready_to_ship: 0, hot_leads: 1, marketplace_ready_to_ship: 0, total: 2 },
    pipeline_stages: [], sales_performance: [], order_statuses: [], recent_activities: [],
    data_quality: { paid_orders_missing_paid_at: 0, unknown_channel_orders: 0 },
    updated_at: "2026-06-29T00:00:00.000Z",
};

vi.mock("./commerce-dashboard.service", () => ({ getCommerceDashboardSummary }));

function memoryKv(): KVNamespace {
    const values = new Map<string, string>();
    return {
        get: vi.fn(async (key: string) => values.get(key) ?? null),
        put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
        delete: vi.fn(async (key: string) => { values.delete(key); }),
        list: vi.fn(async () => ({ keys: [], list_complete: true, cacheStatus: null })),
        getWithMetadata: vi.fn(async (key: string) => ({ value: values.get(key) ?? null, metadata: null, cacheStatus: null })),
    } as unknown as KVNamespace;
}

function createEnv() {
    return {
        LARK_AI_WORKFLOW_WEBHOOK_URL: "https://example.com/workflow",
        LARK_AI_WORKFLOW_TOKEN: "trigger-secret",
        LARK_AI_CALLBACK_TOKEN: "callback-secret",
        MARKETPLACE_TOKENS: memoryKv(),
    } as never;
}

beforeEach(() => {
    getCommerceDashboardSummary.mockResolvedValue(summaryFixture);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 0, msg: "", data: {} }), {
        headers: { "content-type": "application/json" },
    })));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("async AI business analysis", () => {
    it("creates a processing job and sends the Lark-compatible flat payload", async () => {
        const env = createEnv();
        const started = await startAiBusinessAnalysis(env, {
            language: "th", scope: "all", period: parseDashboardPeriod("day", "2026-06-29"),
        });
        expect(started.status).toBe("processing");
        expect(getCommerceDashboardSummary).toHaveBeenCalledWith(
            env,
            "th",
            expect.objectContaining({ mode: "day", value: "2026-06-29" }),
            expect.any(Number),
            "all"
        );
        const request = vi.mocked(fetch).mock.calls[0]?.[1];
        const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
            request_id: started.request_id,
            prompt_version: "lark-business-analysis-v1",
            language: "th",
            period_type: "day",
            scope: "all",
        });
        expect(typeof body.analytics_json).toBe("string");
        expect(new Headers(request?.headers).get("authorization")).toBe("Bearer trigger-secret");
        await expect(getAiBusinessAnalysisJob(env, started.request_id)).resolves.toMatchObject({
            status: "processing",
        });
    });

    it("completes the same job idempotently after the Lark callback", async () => {
        const env = createEnv();
        const started = await startAiBusinessAnalysis(env, {
            language: "th", scope: "all", period: parseDashboardPeriod("day", "2026-06-29"),
        });
        const payload = {
            analysis_json: JSON.stringify({
                headline: "ยอดขายดีขึ้น",
                executive_summary: "มีงานค้างสองรายการ",
                priority_items: ["ตรวจสลิป"], opportunity_items: ["ติดตาม Hot Lead"],
                sales_items: [], risk_items: [],
                recommended_actions: [{ title: "ตรวจสลิป", description: "ตรวจรายการค้าง", target_work_queue: "payment_review" }],
            }),
        };
        const first = await completeAiBusinessAnalysis(env, started.request_id, payload);
        const second = await completeAiBusinessAnalysis(env, started.request_id, payload);
        expect(first.metrics.urgent_actions).toBe(2);
        expect(first.recommended_actions[0]?.target_work_queue).toBe("payment_review");
        expect(second).toEqual(first);
        await expect(getAiBusinessAnalysisJob(env, started.request_id)).resolves.toMatchObject({
            status: "completed",
            result: { headline: "ยอดขายดีขึ้น" },
        });
    });

    it("marks the job failed when Lark returns invalid JSON instead of polling forever", async () => {
        const env = createEnv();
        const started = await startAiBusinessAnalysis(env, {
            language: "th", scope: "all", period: parseDashboardPeriod("day", "2026-06-29"),
        });
        await expect(completeAiBusinessAnalysis(env, started.request_id, {
            analysis_json: "not-json",
        })).rejects.toMatchObject({ code: "LARK_AI_RESPONSE_INVALID" });
        await expect(getAiBusinessAnalysisJob(env, started.request_id)).resolves.toMatchObject({
            status: "failed",
            error: { code: "LARK_AI_RESPONSE_INVALID" },
        });
    });

    it("fails clearly when workflow or callback security is not configured", async () => {
        await expect(startAiBusinessAnalysis({ MARKETPLACE_TOKENS: memoryKv() } as never, {
            language: "th", scope: "all", period: parseDashboardPeriod("day", "2026-06-29"),
        })).rejects.toMatchObject({ code: "LARK_AI_WORKFLOW_NOT_CONFIGURED" });
        await expect(startAiBusinessAnalysis({
            LARK_AI_WORKFLOW_WEBHOOK_URL: "https://example.com/workflow",
            MARKETPLACE_TOKENS: memoryKv(),
        } as never, {
            language: "th", scope: "all", period: parseDashboardPeriod("day", "2026-06-29"),
        })).rejects.toMatchObject({ code: "LARK_AI_CALLBACK_NOT_CONFIGURED" });
    });
});
