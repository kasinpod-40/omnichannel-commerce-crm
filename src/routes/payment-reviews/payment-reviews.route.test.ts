import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { createAuthSession } from "../../modules/auth/auth.session";

const { approvePaymentReview, rejectPaymentReview, getPaymentReviewDetail, getPaymentReviewImage } =
    vi.hoisted(() => ({
        approvePaymentReview: vi.fn(),
        rejectPaymentReview: vi.fn(),
        getPaymentReviewDetail: vi.fn(),
        getPaymentReviewImage: vi.fn(),
    }));

vi.mock("../../modules/payments/payment-review.service", async (importOriginal) => {
    const original = await importOriginal<
        typeof import("../../modules/payments/payment-review.service")
    >();
    return {
        ...original,
        approvePaymentReview,
        rejectPaymentReview,
        getPaymentReviewDetail,
        getPaymentReviewImage,
    };
});

import {
    handlePaymentReviewApprove,
    handlePaymentReviewReject,
} from "./payment-reviews.route";

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

async function requestFor(role: "admin" | "manager" | "sales", path: string, body: object) {
    const session = await createAuthSession(env, user(role));
    return new Request(`https://api.example.com${path}`, {
        method: "POST",
        headers: {
            Origin: "https://crm.example.com",
            Cookie: `crm_session=${encodeURIComponent(session.token)}`,
            "Content-Type": "application/json",
            "Idempotency-Key": "payment-review-key-001",
        },
        body: JSON.stringify(body),
    });
}

describe("Payment Review routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        approvePaymentReview.mockResolvedValue({ ok: true, outcome: "SALE_COMPLETED" });
        rejectPaymentReview.mockResolvedValue({ ok: true, outcome: "REJECTED" });
    });

    it("ปฏิเสธ Sales role ที่พยายาม Approve", async () => {
        const response = await handlePaymentReviewApprove(
            await requestFor("sales", "/payment-reviews/rec-order-001/approve", {}),
            env,
            "rec-order-001"
        );

        expect(response.status).toBe(403);
        expect(approvePaymentReview).not.toHaveBeenCalled();
    });

    it("ส่ง Actor และ Idempotency-Key ให้ Core service สำหรับ Admin", async () => {
        const response = await handlePaymentReviewApprove(
            await requestFor("admin", "/payment-reviews/rec-order-001/approve", {}),
            env,
            "rec-order-001"
        );

        expect(response.status).toBe(200);
        expect(approvePaymentReview).toHaveBeenCalledWith(env, {
            order_record_id: "rec-order-001",
            idempotency_key: "payment-review-key-001",
            actor: expect.objectContaining({ role: "admin", user_id: "user-admin" }),
        });
    });

    it("ส่งเหตุผล Reject ให้ Service โดย Manager มีสิทธิ์ดำเนินการ", async () => {
        const response = await handlePaymentReviewReject(
            await requestFor("manager", "/payment-reviews/rec-order-001/reject", {
                reason: "ยอดเงินไม่ตรง",
            }),
            env,
            "rec-order-001"
        );

        expect(response.status).toBe(200);
        expect(rejectPaymentReview).toHaveBeenCalledWith(env, {
            order_record_id: "rec-order-001",
            idempotency_key: "payment-review-key-001",
            reason: "ยอดเงินไม่ตรง",
            actor: expect.objectContaining({ role: "manager" }),
        });
    });
});
