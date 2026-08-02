import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { AuthError } from "../../modules/auth/auth.error";

const mocks = vi.hoisted(() => ({
    verifyPcWorkflowActionToken: vi.fn(),
    runPcWorkflowAction: vi.fn(),
    refreshPcDerivedState: vi.fn(),
    markPcProductionBlocked: vi.fn(),
    assertDashboardSession: vi.fn(),
}));

vi.mock("../../modules/production-control/pc.action-token", () => ({
    verifyPcWorkflowActionToken: mocks.verifyPcWorkflowActionToken,
}));

vi.mock("../../modules/production-control/pc.derived-state", () => ({
    refreshPcDerivedState: mocks.refreshPcDerivedState,
}));

vi.mock("../../modules/production-control/pc.service", () => ({
    markPcProductionBlocked: mocks.markPcProductionBlocked,
}));

vi.mock("../../modules/production-control/pc.workflow.service", () => ({
    runPcWorkflowAction: mocks.runPcWorkflowAction,
}));

vi.mock("../shared/dashboard-api", () => ({
    assertDashboardSession: mocks.assertDashboardSession,
}));

import { handlePcWorkflowActionPage } from "./pc-action.route";

function env(): Env {
    return {} as Env;
}

function session(role: "admin" | "manager" | "viewer" = "manager") {
    return {
        user: {
            user_id: "user-1",
            open_id: "ou-1",
            name: "Production Manager",
            role,
        },
    };
}

function request(
    method: "GET" | "POST",
    headers?: HeadersInit
): Request {
    return new Request(
        "https://worker.example.com/pc/actions/production-rec-1/approve-production?token=signed",
        {
            method,
            headers:
                method === "POST"
                    ? headers ?? { Origin: "https://worker.example.com" }
                    : headers,
        }
    );
}

describe("Production workflow action page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.verifyPcWorkflowActionToken.mockResolvedValue({
            version: 1,
            action: "approve-production",
            production_record_id: "production-rec-1",
            expires_at: Math.floor(Date.now() / 1000) + 60,
        });
        mocks.assertDashboardSession.mockResolvedValue(session());
        mocks.refreshPcDerivedState.mockResolvedValue({
            materials_updated: 23,
            material_critical_count: 4,
            products_reconciled: 2,
            production_reconciled: 1,
        });
        mocks.runPcWorkflowAction.mockResolvedValue({
            ok: true,
            action: "approve-production",
            production_record_id: "production-rec-1",
            production_id: "PROD-1",
            production_status: "IN_PROGRESS",
            message: "อนุมัติและเริ่มผลิตสินค้าแล้ว",
            materials_replenished: [],
            duplicate: false,
        });
    });

    it("rejects an invalid or mismatched signed action before session or mutation", async () => {
        mocks.verifyPcWorkflowActionToken.mockRejectedValue(
            new Error("invalid token")
        );

        const response = await handlePcWorkflowActionPage(
            request("GET"),
            env(),
            "production-rec-1",
            "approve-production"
        );

        expect(response.status).toBe(500);
        expect(mocks.assertDashboardSession).not.toHaveBeenCalled();
        expect(mocks.refreshPcDerivedState).not.toHaveBeenCalled();
        expect(mocks.runPcWorkflowAction).not.toHaveBeenCalled();
    });

    it("redirects an unauthenticated operator to Lark and returns to the exact action URL", async () => {
        mocks.assertDashboardSession.mockRejectedValue(
            new AuthError(
                "AUTH_SESSION_MISSING",
                "Dashboard session is missing",
                401
            )
        );

        const response = await handlePcWorkflowActionPage(
            request("GET"),
            env(),
            "production-rec-1",
            "approve-production"
        );

        expect(response.status).toBe(302);
        const location = new URL(response.headers.get("Location") ?? "");
        expect(location.pathname).toBe("/auth/lark/login");
        expect(location.searchParams.get("return_to")).toBe(
            "/pc/actions/production-rec-1/approve-production?token=signed"
        );
        expect(mocks.refreshPcDerivedState).not.toHaveBeenCalled();
        expect(mocks.runPcWorkflowAction).not.toHaveBeenCalled();
    });

    it("renders a confirmation page on GET without mutating Production", async () => {
        const response = await handlePcWorkflowActionPage(
            request("GET"),
            env(),
            "production-rec-1",
            "approve-production"
        );
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain("อนุมัติผลิตสินค้า");
        expect(html).toContain("form.requestSubmit()");
        expect(mocks.refreshPcDerivedState).not.toHaveBeenCalled();
        expect(mocks.runPcWorkflowAction).not.toHaveBeenCalled();
    });

    it("rejects a viewer before mutation", async () => {
        mocks.assertDashboardSession.mockResolvedValue(session("viewer"));

        const response = await handlePcWorkflowActionPage(
            request("POST"),
            env(),
            "production-rec-1",
            "approve-production"
        );

        expect(response.status).toBe(403);
        expect(mocks.refreshPcDerivedState).not.toHaveBeenCalled();
        expect(mocks.runPcWorkflowAction).not.toHaveBeenCalled();
    });

    it("rejects a cross-origin POST", async () => {
        const response = await handlePcWorkflowActionPage(
            request("POST", { Origin: "https://evil.example.com" }),
            env(),
            "production-rec-1",
            "approve-production"
        );

        expect(response.status).toBe(403);
        expect(mocks.assertDashboardSession).not.toHaveBeenCalled();
        expect(mocks.refreshPcDerivedState).not.toHaveBeenCalled();
        expect(mocks.runPcWorkflowAction).not.toHaveBeenCalled();
    });

    it("rejects a POST without any verifiable same-origin browser signal", async () => {
        const response = await handlePcWorkflowActionPage(
            request("POST", {}),
            env(),
            "production-rec-1",
            "approve-production"
        );

        expect(response.status).toBe(403);
        expect(mocks.assertDashboardSession).not.toHaveBeenCalled();
        expect(mocks.refreshPcDerivedState).not.toHaveBeenCalled();
        expect(mocks.runPcWorkflowAction).not.toHaveBeenCalled();
    });

    it("accepts a same-origin browser form POST without Origin using Sec-Fetch-Site", async () => {
        const response = await handlePcWorkflowActionPage(
            request("POST", { "Sec-Fetch-Site": "same-origin" }),
            env(),
            "production-rec-1",
            "approve-production"
        );

        expect(response.status).toBe(200);
        expect(mocks.refreshPcDerivedState).toHaveBeenCalledTimes(1);
        expect(mocks.runPcWorkflowAction).toHaveBeenCalledTimes(1);
    });

    it("accepts a same-origin Referer fallback when Origin is omitted", async () => {
        const response = await handlePcWorkflowActionPage(
            request("POST", {
                Referer:
                    "https://worker.example.com/pc/actions/production-rec-1/approve-production?token=signed",
            }),
            env(),
            "production-rec-1",
            "approve-production"
        );

        expect(response.status).toBe(200);
        expect(mocks.refreshPcDerivedState).toHaveBeenCalledTimes(1);
        expect(mocks.runPcWorkflowAction).toHaveBeenCalledTimes(1);
    });

    it("reconciles all derived PC state before running an authorized approval action", async () => {
        const response = await handlePcWorkflowActionPage(
            request("POST"),
            env(),
            "production-rec-1",
            "approve-production"
        );
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(mocks.refreshPcDerivedState).toHaveBeenCalledWith(env());
        expect(
            mocks.refreshPcDerivedState.mock.invocationCallOrder[0]
        ).toBeLessThan(mocks.runPcWorkflowAction.mock.invocationCallOrder[0]);
        expect(mocks.runPcWorkflowAction).toHaveBeenCalledWith(env(), {
            action: "approve-production",
            production_record_id: "production-rec-1",
            actor_name: "Production Manager",
        });
        expect(html).toContain("อนุมัติและเริ่มผลิตสินค้าแล้ว");
        expect(html).toContain("IN_PROGRESS");
    });
});
