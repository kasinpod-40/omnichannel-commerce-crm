import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import * as customerRepository from "../customers/customer.repository";
import * as orderRepository from "../orders/order.repository";
import * as pipelineRepository from "../pipeline/pipeline.repository";
import { resolveLineInboundSalesContext } from "./inbound-sales-context.service";

vi.mock("../customers/customer.repository", () => ({
    updateCustomer: vi.fn(),
}));

vi.mock("../orders/order.repository", () => ({
    findOpenOrdersByCustomer: vi.fn(),
    getOrderByRecordId: vi.fn(),
    getOrdersByRecordIds: vi.fn(),
}));

vi.mock("../pipeline/pipeline.repository", () => ({
    findOpenPipelinesByCustomer: vi.fn(),
    getPipelineByRecordId: vi.fn(),
    getPipelinesByRecordIds: vi.fn(),
}));

const env = {} as Env;

const customer = {
    record_id: "reccustomer001",
    fields: {
        [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "recstalepipeline",
        [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "recstaleorder",
        [CUSTOMER_FIELDS.PIPELINES_HISTORY]: [],
        [CUSTOMER_FIELDS.ORDERS_HISTORY]: [],
        [CUSTOMER_FIELDS.PENDING_PAYMENT]: false,
    },
};

function openPipeline(
    recordId: string,
    stage = "Interested",
    leadScore = 55,
    customerRecordId = customer.record_id
) {
    return {
        record_id: recordId,
        fields: {
            [PIPELINE_FIELDS.STATUS]: "open",
            [PIPELINE_FIELDS.STAGE]: stage,
            [PIPELINE_FIELDS.LEAD_SCORE]: leadScore,
            [PIPELINE_FIELDS.CUSTOMER]: [customerRecordId],
        },
    };
}

function activeOrder(
    recordId: string,
    status = "Waiting Payment",
    customerRecordId = customer.record_id
) {
    return {
        record_id: recordId,
        fields: {
            [ORDER_FIELDS.ORDER_STATUS]: status,
            [ORDER_FIELDS.CUSTOMER]: [customerRecordId],
        },
    };
}

describe("LINE inbound sales context", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(
            pipelineRepository.getPipelineByRecordId
        ).mockResolvedValue(null);
        vi.mocked(
            pipelineRepository.getPipelinesByRecordIds
        ).mockResolvedValue([]);
        vi.mocked(
            pipelineRepository.findOpenPipelinesByCustomer
        ).mockResolvedValue([]);
        vi.mocked(
            orderRepository.getOrderByRecordId
        ).mockResolvedValue(null);
        vi.mocked(
            orderRepository.getOrdersByRecordIds
        ).mockResolvedValue([]);
        vi.mocked(
            orderRepository.findOpenOrdersByCustomer
        ).mockResolvedValue([]);
        vi.mocked(
            customerRepository.updateCustomer
        ).mockResolvedValue(customer);
    });

    it("does not run table-wide recovery searches when cache and history are both empty", async () => {
        const result = await resolveLineInboundSalesContext(
            env,
            {
                ...customer,
                fields: {
                    ...customer.fields,
                    [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "",
                    [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "",
                },
            }
        );

        expect(result.has_active_context).toBe(false);
        expect(
            pipelineRepository.findOpenPipelinesByCustomer
        ).not.toHaveBeenCalled();
        expect(
            orderRepository.findOpenOrdersByCustomer
        ).not.toHaveBeenCalled();
    });

    it("clears stale text pointers when no real active records exist", async () => {
        const result = await resolveLineInboundSalesContext(
            env,
            customer
        );

        expect(result).toMatchObject({
            active_pipeline_id: "",
            active_order_id: "",
            has_active_context: false,
            supports_closing_state: false,
        });
        expect(
            customerRepository.updateCustomer
        ).toHaveBeenCalledWith(
            env,
            customer.record_id,
            {
                active_pipeline_id: "",
                active_order_id: "",
            }
        );
    });

    it("keeps an Interested pipeline as active context but not as Closing evidence", async () => {
        const pipeline = openPipeline(
            "recpipelineinterested"
        );
        vi.mocked(
            pipelineRepository.findOpenPipelinesByCustomer
        ).mockResolvedValue([pipeline]);

        const result = await resolveLineInboundSalesContext(
            env,
            customer
        );

        expect(result).toMatchObject({
            active_pipeline_id: pipeline.record_id,
            has_open_pipeline: true,
            has_active_context: true,
            supports_closing_state: false,
            pipeline_stage: "Interested",
            pipeline_lead_score: 55,
        });
    });

    it("accepts a linked Closing pipeline as real Closing evidence", async () => {
        const pipeline = openPipeline(
            "recpipelineclosing",
            "Closing",
            90
        );
        vi.mocked(
            pipelineRepository.getPipelineByRecordId
        ).mockResolvedValue(pipeline);

        const result = await resolveLineInboundSalesContext(
            env,
            {
                ...customer,
                fields: {
                    ...customer.fields,
                    [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]:
                        pipeline.record_id,
                    [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "",
                },
            }
        );

        expect(result).toMatchObject({
            has_open_pipeline: true,
            has_active_context: true,
            supports_closing_state: true,
            pipeline_stage: "Closing",
            pipeline_lead_score: 90,
        });
    });

    it("accepts a linked non-terminal LINE order as Closing evidence", async () => {
        const order = activeOrder("recorder001");
        vi.mocked(
            orderRepository.getOrderByRecordId
        ).mockResolvedValue(order);

        const result = await resolveLineInboundSalesContext(
            env,
            {
                ...customer,
                fields: {
                    ...customer.fields,
                    [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "",
                    [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]:
                        order.record_id,
                },
            }
        );

        expect(result).toMatchObject({
            has_active_order: true,
            has_active_context: true,
            supports_closing_state: true,
            active_order_id: order.record_id,
        });
    });

    it("rejects a cached open record linked to another customer", async () => {
        vi.mocked(
            pipelineRepository.getPipelineByRecordId
        ).mockResolvedValue(
            openPipeline(
                "recforeignpipeline",
                "Closing",
                100,
                "recanothercustomer"
            )
        );
        vi.mocked(
            orderRepository.getOrderByRecordId
        ).mockResolvedValue(
            activeOrder(
                "recforeignorder",
                "Payment Review",
                "recanothercustomer"
            )
        );

        const result = await resolveLineInboundSalesContext(
            env,
            customer
        );

        expect(result.has_active_context).toBe(false);
        expect(result.supports_closing_state).toBe(false);
    });
});
