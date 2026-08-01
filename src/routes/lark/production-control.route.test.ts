import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import { handlePcProductionCompleteWorkflow } from "./production-control.route";

function env(): Env {
    return {
        LARK_WORKFLOW_TOKEN: "workflow-test-token",
        PC_INVENTORY_ENABLED: "false",
    } as unknown as Env;
}

describe("Lark PC workflow feature flag", () => {
    it("rejects stock-changing workflow calls while PC is disabled", async () => {
        const response = await handlePcProductionCompleteWorkflow(
            new Request(
                "https://api.example.com/webhooks/lark/pc/production-complete",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Workflow-Token": "workflow-test-token",
                    },
                    body: JSON.stringify({
                        production_record_id: "rec-production-1",
                        actual_qty: 10,
                    }),
                }
            ),
            env()
        );

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toMatchObject({
            ok: false,
            code: "PC_INVENTORY_DISABLED",
        });
    });
});
