import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { createAuthSession } from "../../modules/auth/auth.session";

const { getCommerceDashboardSummary } = vi.hoisted(() => ({
    getCommerceDashboardSummary: vi.fn(),
}));

vi.mock(
    "../../modules/dashboard/commerce-dashboard.service",
    () => ({
        getCommerceDashboardSummary,
    })
);

import { handleCommerceDashboardSummary } from "./summary.route";

const env = {
    DASHBOARD_URL: "https://crm.example.com",
    AUTH_ALLOWED_ORIGINS: "https://crm.example.com",
    AUTH_SESSION_SECRET:
        "test-secret-that-is-longer-than-thirty-two-characters",
    AUTH_SESSION_TTL_SECONDS: "3600",
    AUTH_COOKIE_SAME_SITE: "None",
} as Env;

const user = {
    user_id: "ou_user_001",
    lark_open_id: "ou_user_001",
    name: "Kasinpod",
    email: null,
    avatar_url: null,
    role: "admin" as const,
    sales_owner_name: null,
};

describe("GET /dashboard/summary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getCommerceDashboardSummary.mockResolvedValue({
            totals: {
                revenue_thb: 1_000,
                total_leads: 10,
                close_rate_percent: 50,
                pending_orders: 2,
            },
            changes: {
                revenue_percent: 0,
                leads_percent: 0,
                close_rate_percent: 0,
                pending_orders_percent: 0,
            },
            channels: [],
            revenue_trend: {
                period_days: 7,
                current_period: [],
                previous_period: [],
                change_percent: 0,
            },
            action_counts: {
                payment_review: 0,
                waiting_payment: 0,
                missing_delivery: 0,
                ready_to_ship: 0,
                hot_leads: 0,
                marketplace_ready_to_ship: 0,
                total: 0,
            },
            pipeline_stages: [],
            sales_performance: [],
            order_statuses: [],
            recent_activities: [],
            updated_at: "2026-06-26T00:00:00.000Z",
        });
    });

    it("ปฏิเสธ request ที่ไม่มี Session", async () => {
        const response = await handleCommerceDashboardSummary(
            new Request("https://api.example.com/dashboard/summary", {
                headers: { Origin: "https://crm.example.com" },
            }),
            env
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
            "https://crm.example.com"
        );
        await expect(response.json()).resolves.toMatchObject({
            code: "AUTH_SESSION_MISSING",
        });
    });

    it("คืน Dashboard Contract และส่งภาษาจาก Query ไป Service", async () => {
        const session = await createAuthSession(env, user);
        const response = await handleCommerceDashboardSummary(
            new Request(
                "https://api.example.com/dashboard/summary?lang=en&period_mode=month&period_value=2026-06",
                {
                    headers: {
                        Origin: "https://crm.example.com",
                        Cookie: `crm_session=${encodeURIComponent(session.token)}`,
                    },
                }
            ),
            env
        );

        expect(response.status).toBe(200);
        expect(getCommerceDashboardSummary).toHaveBeenCalledWith(
            env,
            "en",
            expect.objectContaining({
                mode: "month",
                value: "2026-06",
                granularity: "day",
            })
        );
        await expect(response.json()).resolves.toMatchObject({
            totals: { revenue_thb: 1_000 },
            updated_at: "2026-06-26T00:00:00.000Z",
        });
    });
    it("คืน 400 เมื่อช่วงเวลาจาก URL ไม่ถูกต้อง", async () => {
        const session = await createAuthSession(env, user);
        const response = await handleCommerceDashboardSummary(
            new Request(
                "https://api.example.com/dashboard/summary?period_mode=month&period_value=2026-13",
                {
                    headers: {
                        Origin: "https://crm.example.com",
                        Cookie: `crm_session=${encodeURIComponent(session.token)}`,
                    },
                }
            ),
            env
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
            code: "INVALID_DASHBOARD_PERIOD",
        });
        expect(getCommerceDashboardSummary).not.toHaveBeenCalled();
    });

});
