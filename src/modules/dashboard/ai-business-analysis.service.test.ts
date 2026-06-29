import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateAiBusinessAnalysis } from "./ai-business-analysis.service";
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

const env = {
    LARK_AI_WORKFLOW_WEBHOOK_URL: "https://example.com/workflow",
} as never;

beforeEach(() => {
    getCommerceDashboardSummary.mockResolvedValue(summaryFixture);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("generateAiBusinessAnalysis", () => {
    it("sends real metrics to Lark Workflow and accepts strict narrative JSON", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            headline: "ยอดขายดีขึ้น",
            executive_summary: "มีงานค้างสองรายการ",
            priority_items: ["ตรวจสลิป"], opportunity_items: ["ติดตาม Hot Lead"],
            sales_items: [], risk_items: [],
            recommended_actions: [{ title: "ตรวจสลิป", description: "ตรวจรายการค้าง", target_work_queue: "payment_review" }],
        }), { headers: { "content-type": "application/json" } })));
        const result = await generateAiBusinessAnalysis(env, {
            language: "th", scope: "all", period: parseDashboardPeriod("day", "2026-06-29"),
        });
        expect(result.metrics.urgent_actions).toBe(2);
        expect(result.recommended_actions[0]?.target_work_queue).toBe("payment_review");
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
            prompt_version: "lark-business-analysis-v1",
            analytics_payload: expect.objectContaining({ scope: "all" }),
        });
    });

    it("fails clearly when workflow is not configured", async () => {
        await expect(generateAiBusinessAnalysis({} as never, {
            language: "th", scope: "all", period: parseDashboardPeriod("day", "2026-06-29"),
        })).rejects.toMatchObject({ code: "LARK_AI_WORKFLOW_NOT_CONFIGURED" });
    });
});
