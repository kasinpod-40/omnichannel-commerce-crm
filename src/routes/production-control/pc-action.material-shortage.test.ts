import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { OperationalError } from "../../utils/errors";

const mocks = vi.hoisted(() => ({
    verifyPcWorkflowActionToken: vi.fn(),
    runPcWorkflowAction: vi.fn(),
    markPcProductionBlocked: vi.fn(),
    refreshPcDerivedState: vi.fn(),
    assertDashboardSession: vi.fn(),
}));

vi.mock("../../modules/production-control/pc.action-token", () => ({
    verifyPcWorkflowActionToken: mocks.verifyPcWorkflowActionToken,
}));

vi.mock("../../modules/production-control/pc.workflow.service", () => ({
    runPcWorkflowAction: mocks.runPcWorkflowAction,
}));

vi.mock("../../modules/production-control/pc.derived-state", () => ({
    refreshPcDerivedState: mocks.refreshPcDerivedState,
}));

vi.mock("../../modules/production-control/pc.service", () => ({
    markPcProductionBlocked: mocks.markPcProductionBlocked,
}));

vi.mock("../shared/dashboard-api", () => ({
    assertDashboardSession: mocks.assertDashboardSession,
}));

import { handlePcWorkflowActionPage } from "./pc-action.route";

function env(): Env {
    return {} as Env;
}

function completionRequest(): Request {
    return new Request(
        "https://worker.example.com/pc/actions/production-rec-1/complete-production?token=signed",
        {
            method: "POST",
            headers: { Origin: "https://worker.example.com" },
        }
    );
}

describe("Production completion material-shortage handling", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.verifyPcWorkflowActionToken.mockResolvedValue({
            version: 1,
            action: "complete-production",
            production_record_id: "production-rec-1",
            expires_at: Math.floor(Date.now() / 1000) + 60,
        });
        mocks.assertDashboardSession.mockResolvedValue({
            user: {
                user_id: "user-1",
                open_id: "ou-1",
                name: "Production Manager",
                role: "manager",
            },
        });
        mocks.refreshPcDerivedState.mockResolvedValue({
            materials_updated: 23,
            material_critical_count: 4,
            products_reconciled: 2,
            production_reconciled: 1,
        });
        mocks.markPcProductionBlocked.mockResolvedValue(undefined);
    });

    it("reconciles all PC state before blocking and sending the Lark shortage workflow", async () => {
        const shortage = new OperationalError(
            "PC_PRODUCTION_MATERIAL_INSUFFICIENT",
            "วัตถุดิบ FAB-TWEED-IVORY ไม่พอ ขาด 3.8 เมตร",
            { retryable: false, status: 409 }
        );
        mocks.runPcWorkflowAction.mockRejectedValue(shortage);

        const response = await handlePcWorkflowActionPage(
            completionRequest(),
            env(),
            "production-rec-1",
            "complete-production"
        );
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(mocks.refreshPcDerivedState).toHaveBeenCalledWith(env());
        expect(mocks.markPcProductionBlocked).toHaveBeenCalledWith(env(), {
            production_record_id: "production-rec-1",
            code: "PC_PRODUCTION_MATERIAL_INSUFFICIENT",
            message: "วัตถุดิบ FAB-TWEED-IVORY ไม่พอ ขาด 3.8 เมตร",
        });
        expect(
            mocks.refreshPcDerivedState.mock.invocationCallOrder[0]
        ).toBeLessThan(
            mocks.markPcProductionBlocked.mock.invocationCallOrder[0]
        );
        expect(html).toContain("ยังรับสินค้าเข้าสต็อกไม่ได้");
        expect(html).toContain("อัปเดต Dashboard");
        expect(html).toContain("Stock สินค้าสำเร็จรูปยังไม่เพิ่ม");
    });

    it("does not reconcile planning for unrelated completion errors", async () => {
        mocks.runPcWorkflowAction.mockRejectedValue(
            new OperationalError(
                "PC_PRODUCTION_STATUS_INVALID",
                "สถานะนี้ยังปิดงานผลิตไม่ได้",
                { retryable: false, status: 409 }
            )
        );

        const response = await handlePcWorkflowActionPage(
            completionRequest(),
            env(),
            "production-rec-1",
            "complete-production"
        );
        const html = await response.text();

        expect(response.status).toBe(409);
        expect(mocks.refreshPcDerivedState).not.toHaveBeenCalled();
        expect(mocks.markPcProductionBlocked).not.toHaveBeenCalled();
        expect(html).toContain("สถานะนี้ยังปิดงานผลิตไม่ได้");
    });
});
