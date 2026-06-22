import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_FIELDS, ORDER_FIELDS, PIPELINE_FIELDS } from "../../core/lark-fields";

const {
    getCustomerByRecordId,
    updateCustomer,
    findOpenPipelinesByCustomer,
    getPipelineByRecordId,
    findOpenOrdersByCustomer,
    getOrderByRecordId,
} = vi.hoisted(() => ({
    getCustomerByRecordId: vi.fn(),
    updateCustomer: vi.fn(),
    findOpenPipelinesByCustomer: vi.fn(),
    getPipelineByRecordId: vi.fn(),
    findOpenOrdersByCustomer: vi.fn(),
    getOrderByRecordId: vi.fn(),
}));

vi.mock("../customers/customer.repository", () => ({
    getCustomerByRecordId,
    updateCustomer,
}));

vi.mock("../pipeline/pipeline.repository", () => ({
    findOpenPipelinesByCustomer,
    getPipelineByRecordId,
}));

vi.mock("../orders/order.repository", () => ({
    findOpenOrdersByCustomer,
    getOrderByRecordId,
}));

import { auditAndRepairCustomerIntegrity } from "./customer-integrity.service";

const env = {} as any;

function customer(activePipeline = "", activeOrder = "") {
    return {
        record_id: "cus1",
        fields: {
            [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: activePipeline,
            [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: activeOrder,
        },
    };
}

function pipeline(id: string) {
    return {
        record_id: id,
        fields: {
            [PIPELINE_FIELDS.STATUS]: "open",
            [PIPELINE_FIELDS.CUSTOMER]: ["cus1"],
        },
    };
}

function order(id: string) {
    return {
        record_id: id,
        fields: {
            [ORDER_FIELDS.ORDER_STATUS]: "Waiting Payment",
            [ORDER_FIELDS.CUSTOMER]: ["cus1"],
        },
    };
}

describe("customer integrity audit/repair", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        updateCustomer.mockImplementation(
            async (_env, _id, fields) => ({
                ...customer(
                    fields.active_pipeline_id ?? "",
                    fields.active_order_id ?? ""
                ),
            })
        );
    });

    it("repairs stale pointers when there is exactly one open record", async () => {
        getCustomerByRecordId.mockResolvedValue(
            customer("deleted-pipeline", "deleted-order")
        );
        findOpenPipelinesByCustomer.mockResolvedValue([
            pipeline("pipe1"),
        ]);
        findOpenOrdersByCustomer.mockResolvedValue([
            order("order1"),
        ]);
        getPipelineByRecordId.mockResolvedValue(null);
        getOrderByRecordId.mockResolvedValue(null);

        const result = await auditAndRepairCustomerIntegrity(
            env,
            "cus1",
            true
        );

        expect(result.repaired).toBe(true);
        expect(result.active_pipeline_id).toBe("pipe1");
        expect(result.active_order_id).toBe("order1");
        expect(updateCustomer).toHaveBeenCalledWith(
            env,
            "cus1",
            {
                active_pipeline_id: "pipe1",
                active_order_id: "order1",
            }
        );
    });

    it("does not guess when multiple open pipelines exist", async () => {
        getCustomerByRecordId.mockResolvedValue(customer());
        findOpenPipelinesByCustomer.mockResolvedValue([
            pipeline("pipe1"),
            pipeline("pipe2"),
        ]);
        findOpenOrdersByCustomer.mockResolvedValue([]);
        getPipelineByRecordId.mockResolvedValue(null);
        getOrderByRecordId.mockResolvedValue(null);

        const result = await auditAndRepairCustomerIntegrity(
            env,
            "cus1",
            true
        );

        expect(result.ok).toBe(false);
        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "MULTIPLE_OPEN_PIPELINES",
                }),
            ])
        );
        expect(updateCustomer).not.toHaveBeenCalled();
    });
});
