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
import {
    applyManualPaymentVerification,
    getMissingDeliveryFields,
    resolveVerifiedTotalAmount,
} from "./payment.service";

vi.mock("../customers/customer.repository", () => ({
    getCustomerByRecordId: vi.fn(),
    updateCustomer: vi.fn(),
}));

vi.mock("../orders/order.repository", () => ({
    getOrderByRecordId: vi.fn(),
    updateOrder: vi.fn(),
}));

vi.mock("../pipeline/pipeline.repository", () => ({
    getPipelineByRecordId: vi.fn(),
    updatePipeline: vi.fn(),
}));

describe("CASE 19.3 delivery readiness", () => {
    it("requires both address and phone before sale completion", () => {
        expect(
            getMissingDeliveryFields(
                "99/1 ถนนสุขุมวิท กรุงเทพ 10110",
                "0812345678"
            )
        ).toEqual([]);
    });

    it("reports a missing phone", () => {
        expect(
            getMissingDeliveryFields(
                "99/1 ถนนสุขุมวิท กรุงเทพ 10110",
                ""
            )
        ).toEqual(["phone"]);
    });

    it("reports a missing address", () => {
        expect(
            getMissingDeliveryFields("", "+66 81 234 5678")
        ).toEqual(["address"]);
    });

    it("rejects an invalid phone even when text is present", () => {
        expect(
            getMissingDeliveryFields(
                "99/1 ถนนสุขุมวิท กรุงเทพ 10110",
                "10110"
            )
        ).toEqual(["phone"]);
    });
});

describe("verified slip amount to total_amount", () => {
    it("uses the verified slip amount when it is positive", () => {
        expect(resolveVerifiedTotalAmount(0, 1290)).toBe(1290);
        expect(resolveVerifiedTotalAmount(999, 1290)).toBe(1290);
    });

    it("does not overwrite an existing total with zero", () => {
        expect(resolveVerifiedTotalAmount(999, 0)).toBe(999);
        expect(resolveVerifiedTotalAmount(999, Number.NaN)).toBe(999);
    });
});

describe("verified sale stage invariant", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("normalizes a legacy Pipeline score above 100 back to exactly 100 when sale is Won", async () => {
        let order = {
            record_id: "order-001",
            fields: {
                [ORDER_FIELDS.PAYMENT_STATUS]: "Payment Review",
                [ORDER_FIELDS.ORDER_STATUS]: "Payment Review",
                [ORDER_FIELDS.PAYMENT_VERIFIED]: false,
                [ORDER_FIELDS.PAID_AT]: 0,
                [ORDER_FIELDS.TOTAL_AMOUNT]: 0,
                [ORDER_FIELDS.SLIP_AMOUNT]: 1000,
                [ORDER_FIELDS.ADDRESS]: "99/1 ถนนสุขุมวิท กรุงเทพ 10110",
                [ORDER_FIELDS.PHONE]: "0812345678",
            },
        };
        let pipeline = {
            record_id: "pipeline-001",
            fields: {
                [PIPELINE_FIELDS.STAGE]: "Closing",
                [PIPELINE_FIELDS.STATUS]: "open",
                [PIPELINE_FIELDS.LEAD_SCORE]: 140,
            },
        };
        let customer = {
            record_id: "customer-001",
            fields: {
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
                [CUSTOMER_FIELDS.LEAD_SCORE]: 95,
                [CUSTOMER_FIELDS.HOT_LEAD]: true,
                [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: order.record_id,
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: pipeline.record_id,
                [CUSTOMER_FIELDS.PRODUCT_NAME]: "สินค้า A",
                [CUSTOMER_FIELDS.PRODUCT_QTY]: 1,
            },
        };

        vi.mocked(orderRepository.updateOrder).mockImplementation(
            async (_env, _recordId, fields) => {
                order = { ...order, fields: { ...order.fields, ...fields } };
                return order;
            }
        );
        vi.mocked(pipelineRepository.updatePipeline).mockImplementation(
            async (_env, _recordId, fields) => {
                pipeline = { ...pipeline, fields: { ...pipeline.fields, ...fields } };
                return pipeline;
            }
        );
        vi.mocked(customerRepository.updateCustomer).mockImplementation(
            async (_env, _recordId, fields) => {
                customer = { ...customer, fields: { ...customer.fields, ...fields } };
                return customer;
            }
        );
        vi.mocked(orderRepository.getOrderByRecordId).mockImplementation(
            async () => order
        );
        vi.mocked(pipelineRepository.getPipelineByRecordId).mockImplementation(
            async () => pipeline
        );
        vi.mocked(customerRepository.getCustomerByRecordId).mockImplementation(
            async () => customer
        );

        const result = await applyManualPaymentVerification(
            {} as Env,
            order,
            customer,
            pipeline
        );

        expect(result?.sale_completed).toBe(true);
        expect(pipelineRepository.updatePipeline).toHaveBeenCalledWith(
            expect.anything(),
            pipeline.record_id,
            expect.objectContaining({
                stage: "Won",
                status: "won",
                lead_score: 100,
            })
        );
        expect(result?.new_state.pipeline_lead_score).toBe(100);
    });
});
