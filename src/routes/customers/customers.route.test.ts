import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { createAuthSession } from "../../modules/auth/auth.session";

const { getCustomerList, getCustomerDetail } = vi.hoisted(() => ({
    getCustomerList: vi.fn(),
    getCustomerDetail: vi.fn(),
}));

vi.mock("../../modules/customers/customer-dashboard.service", () => ({
    getCustomerList,
    getCustomerDetail,
}));

import {
    handleCustomerDetail,
    handleCustomerList,
} from "./customers.route";

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

describe("Customers routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getCustomerList.mockResolvedValue({
            items: [],
            summary: {
                total_customers: 0,
                hot_leads: 0,
                closing_customers: 0,
                unassigned_customers: 0,
            },
            total: 0,
            page: 1,
            page_size: 10,
            total_pages: 1,
            updated_at: "2026-06-26T00:00:00.000Z",
        });
        getCustomerDetail.mockResolvedValue(null);
    });

    it("ปฏิเสธรายการลูกค้าที่ไม่มี Session", async () => {
        const response = await handleCustomerList(
            new Request("https://api.example.com/customers", {
                headers: { Origin: "https://crm.example.com" },
            }),
            env
        );

        expect(response.status).toBe(401);
    });

    it("ส่ง Query ที่ผ่านการ normalize เข้า Service", async () => {
        const session = await createAuthSession(env, user);
        const response = await handleCustomerList(
            new Request(
                "https://api.example.com/customers?search=min&channel=LINE&hot_lead=true&sort=lead_score_desc&page=2&page_size=20",
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
        expect(getCustomerList).toHaveBeenCalledWith(env, {
            search: "min",
            channel: "LINE",
            stage: null,
            hot_lead: true,
            sort: "lead_score_desc",
            page: 2,
            page_size: 20,
        });
    });

    it("คืน 404 เมื่อไม่พบ Customer detail", async () => {
        const session = await createAuthSession(env, user);
        const response = await handleCustomerDetail(
            new Request("https://api.example.com/customers/rec_missing?lang=en", {
                headers: {
                    Origin: "https://crm.example.com",
                    Cookie: `crm_session=${encodeURIComponent(session.token)}`,
                },
            }),
            env,
            "rec_missing"
        );

        expect(response.status).toBe(404);
        expect(getCustomerDetail).toHaveBeenCalledWith(
            env,
            "rec_missing",
            "en"
        );
    });
});
