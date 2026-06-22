import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";

const {
    getCustomerByRecordId,
    updateCustomer,
    getPipelineByRecordId,
    findOpenPipelinesByCustomer,
    updatePipeline,
    getOrderByRecordId,
    findOpenOrdersByCustomer,
    updateOrder,
    recordActivityOnce,
} = vi.hoisted(() => ({
    getCustomerByRecordId: vi.fn(),
    updateCustomer: vi.fn(),
    getPipelineByRecordId: vi.fn(),
    findOpenPipelinesByCustomer: vi.fn(),
    updatePipeline: vi.fn(),
    getOrderByRecordId: vi.fn(),
    findOpenOrdersByCustomer: vi.fn(),
    updateOrder: vi.fn(),
    recordActivityOnce: vi.fn(),
}));

vi.mock("../customers/customer.repository", () => ({
    getCustomerByRecordId,
    updateCustomer,
}));

vi.mock("../pipeline/pipeline.repository", () => ({
    getPipelineByRecordId,
    findOpenPipelinesByCustomer,
    updatePipeline,
}));

vi.mock("../orders/order.repository", () => ({
    getOrderByRecordId,
    findOpenOrdersByCustomer,
    updateOrder,
}));

vi.mock("../activities/activity.service", () => ({
    recordActivityOnce,
}));

import { assignSalesOwner } from "./sales-assignment.service";

const env = {} as any;

describe("manual sales assignment", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        findOpenPipelinesByCustomer.mockResolvedValue([]);
        findOpenOrdersByCustomer.mockResolvedValue([]);
        updatePipeline.mockImplementation(
            async (_env, id, fields) => ({
                record_id: id,
                fields,
            })
        );
        updateOrder.mockImplementation(
            async (_env, id, fields) => ({
                record_id: id,
                fields,
            })
        );
        updateCustomer.mockImplementation(
            async (_env, id, fields) => ({
                record_id: id,
                fields,
            })
        );
        recordActivityOnce.mockResolvedValue({
            duplicate: false,
            record: { record_id: "activity1", fields: {} },
        });
    });

    it("syncs owner to customer and active pipeline/order", async () => {
        getCustomerByRecordId.mockResolvedValue({
            record_id: "cus1",
            fields: {
                [CUSTOMER_FIELDS.SALES_OWNER]: "Unassigned",
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "pipe1",
                [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "order1",
            },
        });
        getPipelineByRecordId.mockResolvedValue({
            record_id: "pipe1",
            fields: {
                [PIPELINE_FIELDS.STATUS]: "open",
                [PIPELINE_FIELDS.SALES_OWNER]: "Unassigned",
            },
        });
        getOrderByRecordId.mockResolvedValue({
            record_id: "order1",
            fields: {
                [ORDER_FIELDS.ORDER_STATUS]: "Waiting Payment",
                [ORDER_FIELDS.SALES_OWNER]: "Unassigned",
            },
        });

        const result = await assignSalesOwner(env, {
            customer_record_id: "cus1",
            sales_owner: "Sales A",
        });

        expect(result.new_sales_owner).toBe("Sales A");
        expect(updatePipeline).toHaveBeenCalledWith(
            env,
            "pipe1",
            { sales_owner: "Sales A" }
        );
        expect(updateOrder).toHaveBeenCalledWith(
            env,
            "order1",
            { sales_owner: "Sales A" }
        );
        expect(updateCustomer).toHaveBeenCalledWith(
            env,
            "cus1",
            {
                sales_owner: "Sales A",
                active_pipeline_id: "pipe1",
                active_order_id: "order1",
            }
        );
        expect(recordActivityOnce).toHaveBeenCalledWith(
            env,
            expect.objectContaining({
                action: "SALES_ASSIGNED",
                old_value: "Unassigned",
                new_value: "Sales A",
            })
        );
    });

    it("is idempotent when owner is already synchronized", async () => {
        getCustomerByRecordId.mockResolvedValue({
            record_id: "cus1",
            fields: {
                [CUSTOMER_FIELDS.SALES_OWNER]: "Sales A",
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "pipe1",
                [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "order1",
            },
        });
        getPipelineByRecordId.mockResolvedValue({
            record_id: "pipe1",
            fields: {
                [PIPELINE_FIELDS.STATUS]: "open",
                [PIPELINE_FIELDS.SALES_OWNER]: "Sales A",
            },
        });
        getOrderByRecordId.mockResolvedValue({
            record_id: "order1",
            fields: {
                [ORDER_FIELDS.ORDER_STATUS]: "Waiting Payment",
                [ORDER_FIELDS.SALES_OWNER]: "Sales A",
            },
        });

        const result = await assignSalesOwner(env, {
            customer_record_id: "cus1",
            sales_owner: "Sales A",
        });

        expect(result.customer_changed).toBe(false);
        expect(result.pipeline_changed).toBe(false);
        expect(result.order_changed).toBe(false);
        expect(updatePipeline).not.toHaveBeenCalled();
        expect(updateOrder).not.toHaveBeenCalled();
        expect(updateCustomer).not.toHaveBeenCalled();
        expect(recordActivityOnce).not.toHaveBeenCalled();
    });
});
