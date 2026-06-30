import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { createAuthSession } from "../../modules/auth/auth.session";

const { updateOrderAmount } = vi.hoisted(() => ({ updateOrderAmount: vi.fn() }));
vi.mock("../../modules/orders/order-amount.service", () => ({ updateOrderAmount }));

import { handleOrderAmountUpdate } from "./orders.route";
import { handleOrderRoutes } from "./index";

const env = {
    DASHBOARD_URL: "https://crm.example.com",
    AUTH_ALLOWED_ORIGINS: "https://crm.example.com",
    AUTH_SESSION_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
    AUTH_SESSION_TTL_SECONDS: "3600",
    AUTH_COOKIE_SAME_SITE: "None",
} as Env;

const user = (role: "admin" | "manager" | "sales") => ({
    user_id: `user-${role}`,
    lark_open_id: `open-${role}`,
    name: role,
    email: null,
    avatar_url: null,
    role,
    sales_owner_name: null,
});

async function requestFor(role: "admin" | "manager" | "sales") {
    const session = await createAuthSession(env, user(role));
    return new Request("https://api.example.com/orders/rec-order-001/amount", {
        method: "POST",
        headers: {
            Origin: "https://crm.example.com",
            Cookie: `crm_session=${encodeURIComponent(session.token)}`,
            "Content-Type": "application/json",
            "Idempotency-Key": "order-amount-key-001",
        },
        body: JSON.stringify({
            total_amount: "1250.50",
            expected_updated_at: "2026-06-30T03:00:00.000Z",
            reason: "ยอดตามที่ตกลง",
        }),
    });
}

describe("POST /orders/:id/amount", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        updateOrderAmount.mockResolvedValue({ order: { order_id: "rec-order-001" }, idempotent: false, changed: true });
    });

    it("ปฏิเสธ Sales role ก่อนเรียก service", async () => {
        const response = await handleOrderAmountUpdate(await requestFor("sales"), env, "rec-order-001");
        expect(response.status).toBe(403);
        expect(updateOrderAmount).not.toHaveBeenCalled();
    });

    it("ส่ง amount, optimistic version, actor และ idempotency key ให้ service", async () => {
        const response = await handleOrderAmountUpdate(await requestFor("manager"), env, "rec-order-001");
        expect(response.status).toBe(200);
        expect(updateOrderAmount).toHaveBeenCalledWith(env, {
            orderId: "rec-order-001",
            amount: "1250.50",
            expectedUpdatedAt: "2026-06-30T03:00:00.000Z",
            idempotencyKey: "order-amount-key-001",
            reason: "ยอดตามที่ตกลง",
            actor: { userId: "user-manager", name: "manager", role: "manager" },
        });
    });

    it("รองรับ Idempotency-Key ใน CORS preflight", async () => {
        const response = await handleOrderRoutes(new Request(
            "https://api.example.com/orders/rec-order-001/amount",
            {
                method: "OPTIONS",
                headers: {
                    Origin: "https://crm.example.com",
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type, idempotency-key",
                },
            },
        ), env, "/orders/rec-order-001/amount");
        expect(response?.status).toBe(204);
        expect(response?.headers.get("Access-Control-Allow-Headers")).toContain("Idempotency-Key");
    });
});
