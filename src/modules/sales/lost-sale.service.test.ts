import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import * as customerService from "../customers/customer.service";
import * as orderService from "../orders/order.service";
import * as pipelineService from "../pipeline/pipeline.service";
import { finalizeLostSale } from "./lost-sale.service";

vi.mock("../customers/customer.service", () => ({
    markCustomerLost: vi.fn(),
}));

vi.mock("../orders/order.service", () => ({
    cancelActiveOrder: vi.fn(),
}));

vi.mock("../pipeline/pipeline.service", () => ({
    markActivePipelineLost: vi.fn(),
}));

const customer = {
    record_id: "rec_customer_001",
    fields: {},
};

describe("Lost sale ordering regression", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.mocked(
            pipelineService.markActivePipelineLost
        ).mockResolvedValue({
            record: {
                record_id: "rec_pipeline_001",
                fields: {},
            },
            changed: true,
            old_state: {
                stage: "Closing",
                status: "open",
                lead_score: 90,
            },
            new_state: {
                stage: "Lost",
                status: "lost",
                lead_score: 90,
            },
        });

        vi.mocked(
            orderService.cancelActiveOrder
        ).mockResolvedValue({
            record: {
                record_id: "rec_order_001",
                fields: {},
            },
            changed: true,
            old_order_status: "Waiting Payment",
            new_order_status: "Cancelled",
            payment_status: "Waiting Payment",
            payment_verified: false,
        });

        vi.mocked(
            customerService.markCustomerLost
        ).mockResolvedValue(customer);
    });

    it("closes Pipeline and Order before clearing Customer pointers", async () => {
        await finalizeLostSale(
            {} as Env,
            customer,
            {
                active_pipeline_id:
                    "rec_pipeline_001",
                active_order_id: "rec_order_001",
            }
        );

        const pipelineOrder = vi.mocked(
            pipelineService.markActivePipelineLost
        ).mock.invocationCallOrder[0];
        const orderOrder = vi.mocked(
            orderService.cancelActiveOrder
        ).mock.invocationCallOrder[0];
        const customerOrder = vi.mocked(
            customerService.markCustomerLost
        ).mock.invocationCallOrder[0];

        expect(pipelineOrder).toBeLessThan(orderOrder);
        expect(orderOrder).toBeLessThan(customerOrder);
    });

    it("does not clear Customer pointers when Order cancellation fails", async () => {
        vi.mocked(
            orderService.cancelActiveOrder
        ).mockRejectedValue(new Error("Lark update failed"));

        await expect(
            finalizeLostSale(
                {} as Env,
                customer,
                {
                    active_pipeline_id:
                        "rec_pipeline_001",
                    active_order_id:
                        "rec_order_001",
                }
            )
        ).rejects.toThrow("Lark update failed");

        expect(
            customerService.markCustomerLost
        ).not.toHaveBeenCalled();
    });
});
