import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import * as customerRepository from "../customers/customer.repository";
import * as pipelineRepository from "./pipeline.repository";
import {
    createPipelineIfNeeded,
    markActivePipelineLost,
} from "./pipeline.service";

vi.mock("../customers/customer.repository", () => ({
    updateCustomer: vi.fn(),
}));

vi.mock("./pipeline.repository", () => ({
    createPipeline: vi.fn(),
    findOpenPipelinesByCustomer: vi.fn(),
    getPipelineByRecordId: vi.fn(),
    getPipelinesByRecordIds: vi.fn(),
    updatePipeline: vi.fn(),
}));

const customer = {
    record_id: "rec_customer_001",
    fields: {
        [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "",
    },
};

const negotiatingPipeline = {
    record_id: "rec_pipeline_negotiating",
    fields: {
        [PIPELINE_FIELDS.STAGE]: "Negotiating",
        [PIPELINE_FIELDS.STATUS]: "open",
        [PIPELINE_FIELDS.LEAD_SCORE]: 70,
        [PIPELINE_FIELDS.CREATED_AT]: 1000,
        [PIPELINE_FIELDS.CUSTOMER]: [
            { record_id: "rec_customer_001" },
        ],
    },
};

describe("active Pipeline reuse regression", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(customerRepository.updateCustomer).mockResolvedValue(
            customer
        );
        vi.mocked(
            pipelineRepository.getPipelinesByRecordIds
        ).mockResolvedValue([]);
        vi.mocked(
            pipelineRepository.findOpenPipelinesByCustomer
        ).mockResolvedValue([]);
        vi.mocked(pipelineRepository.updatePipeline).mockImplementation(
            async (_env, recordId, fields) => ({
                record_id: recordId,
                fields: {
                    ...negotiatingPipeline.fields,
                    [PIPELINE_FIELDS.STAGE]: fields.stage,
                    [PIPELINE_FIELDS.STATUS]: fields.status,
                    [PIPELINE_FIELDS.LEAD_SCORE]: fields.lead_score,
                },
            })
        );
    });

    it("updates the active open Pipeline instead of creating a new one", async () => {
        const customerWithActivePipeline = {
            ...customer,
            fields: {
                ...customer.fields,
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]:
                    negotiatingPipeline.record_id,
            },
        };

        vi.mocked(
            pipelineRepository.getPipelineByRecordId
        ).mockResolvedValue(negotiatingPipeline);

        const result = await createPipelineIfNeeded(
            {} as Env,
            customerWithActivePipeline,
            {
                stage: "Closing",
                lead_score: 90,
                ai_summary: "ลูกค้าสั่งซื้อสินค้า",
            }
        );

        expect(result.created).toBe(false);
        expect(result.updated).toBe(true);
        expect(result.record.record_id).toBe(
            negotiatingPipeline.record_id
        );
        expect(pipelineRepository.updatePipeline).toHaveBeenCalledWith(
            expect.anything(),
            negotiatingPipeline.record_id,
            expect.objectContaining({
                stage: "Closing",
                status: "open",
                lead_score: 90,
            })
        );
        expect(
            pipelineRepository.findOpenPipelinesByCustomer
        ).not.toHaveBeenCalled();
        expect(pipelineRepository.createPipeline).not.toHaveBeenCalled();
    });

    it("recovers the existing open Pipeline when active_pipeline_id is empty", async () => {
        vi.mocked(
            pipelineRepository.findOpenPipelinesByCustomer
        ).mockResolvedValue([negotiatingPipeline]);

        const result = await createPipelineIfNeeded(
            {} as Env,
            customer,
            {
                stage: "Closing",
                lead_score: 90,
                ai_summary: "ลูกค้าสั่งซื้อสินค้า",
            }
        );

        expect(result.created).toBe(false);
        expect(result.record.record_id).toBe(
            negotiatingPipeline.record_id
        );
        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            customer.record_id,
            {
                active_pipeline_id:
                    negotiatingPipeline.record_id,
            }
        );
        expect(pipelineRepository.updatePipeline).toHaveBeenCalledWith(
            expect.anything(),
            negotiatingPipeline.record_id,
            expect.objectContaining({
                stage: "Closing",
                status: "open",
                lead_score: 90,
            })
        );
        expect(pipelineRepository.createPipeline).not.toHaveBeenCalled();
    });

    it("recovers an open Pipeline from pipelines_history when active_pipeline_id points to a deleted record", async () => {
        const customerWithStalePointer = {
            ...customer,
            fields: {
                ...customer.fields,
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]:
                    "rec_pipeline_deleted",
                [CUSTOMER_FIELDS.PIPELINES_HISTORY]: [
                    {
                        record_ids: [
                            negotiatingPipeline.record_id,
                        ],
                    },
                ],
            },
        };

        vi.mocked(
            pipelineRepository.getPipelineByRecordId
        ).mockResolvedValue(null);
        vi.mocked(
            pipelineRepository.getPipelinesByRecordIds
        ).mockResolvedValue([negotiatingPipeline]);

        const result = await createPipelineIfNeeded(
            {} as Env,
            customerWithStalePointer,
            {
                stage: "Closing",
                lead_score: 90,
                ai_summary: "ลูกค้าสั่งซื้อสินค้า",
            }
        );

        expect(result.created).toBe(false);
        expect(result.record.record_id).toBe(
            negotiatingPipeline.record_id
        );
        expect(pipelineRepository.createPipeline).not.toHaveBeenCalled();
        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            customer.record_id,
            {
                active_pipeline_id:
                    negotiatingPipeline.record_id,
            }
        );
    });

    it("stops instead of creating another Pipeline when more than one open Pipeline exists", async () => {
        const duplicatePipeline = {
            ...negotiatingPipeline,
            record_id: "rec_pipeline_duplicate",
        };

        vi.mocked(
            pipelineRepository.getPipelinesByRecordIds
        ).mockResolvedValue([
            negotiatingPipeline,
            duplicatePipeline,
        ]);

        const customerWithHistory = {
            ...customer,
            fields: {
                ...customer.fields,
                [CUSTOMER_FIELDS.PIPELINES_HISTORY]: [
                    negotiatingPipeline.record_id,
                    duplicatePipeline.record_id,
                ],
            },
        };

        await expect(
            createPipelineIfNeeded(
                {} as Env,
                customerWithHistory,
                {
                    stage: "Closing",
                    lead_score: 90,
                    ai_summary: "ลูกค้าสั่งซื้อสินค้า",
                }
            )
        ).rejects.toThrow(
            "PIPELINE_INVARIANT_MULTIPLE_OPEN"
        );

        expect(pipelineRepository.createPipeline).not.toHaveBeenCalled();
        expect(pipelineRepository.updatePipeline).not.toHaveBeenCalled();
    });

    it("preserves the real New Lead snapshot before advancing an open Pipeline", async () => {
        const newLeadPipeline = {
            ...negotiatingPipeline,
            record_id: "rec_pipeline_new_lead",
            fields: {
                ...negotiatingPipeline.fields,
                [PIPELINE_FIELDS.STAGE]: "New Lead",
                [PIPELINE_FIELDS.LEAD_SCORE]: 5,
            },
        };
        const customerWithActivePipeline = {
            ...customer,
            fields: {
                ...customer.fields,
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]:
                    newLeadPipeline.record_id,
            },
        };

        vi.mocked(
            pipelineRepository.getPipelineByRecordId
        ).mockResolvedValue(newLeadPipeline);
        vi.mocked(pipelineRepository.updatePipeline).mockImplementation(
            async (_env, recordId, fields) => ({
                record_id: recordId,
                fields: {
                    ...newLeadPipeline.fields,
                    [PIPELINE_FIELDS.STAGE]: fields.stage,
                    [PIPELINE_FIELDS.STATUS]: fields.status,
                    [PIPELINE_FIELDS.LEAD_SCORE]: fields.lead_score,
                },
            })
        );

        const result = await createPipelineIfNeeded(
            {} as Env,
            customerWithActivePipeline,
            {
                stage: "Interested",
                lead_score: 35,
                ai_summary: "ลูกค้าเริ่มสนใจสินค้า",
            }
        );

        expect(result.old_state).toEqual({
            stage: "New Lead",
            status: "open",
            lead_score: 5,
        });
        expect(result.new_state).toEqual({
            stage: "Interested",
            status: "open",
            lead_score: 35,
        });
    });

    it("never moves an open Pipeline backward when a weaker intent arrives", async () => {
        const customerWithActivePipeline = {
            ...customer,
            fields: {
                ...customer.fields,
                [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]:
                    negotiatingPipeline.record_id,
            },
        };

        vi.mocked(
            pipelineRepository.getPipelineByRecordId
        ).mockResolvedValue({
            ...negotiatingPipeline,
            fields: {
                ...negotiatingPipeline.fields,
                [PIPELINE_FIELDS.STAGE]: "Closing",
                [PIPELINE_FIELDS.LEAD_SCORE]: 90,
            },
        });
        vi.mocked(pipelineRepository.updatePipeline).mockImplementation(
            async (_env, recordId, fields) => ({
                record_id: recordId,
                fields: {
                    ...negotiatingPipeline.fields,
                    [PIPELINE_FIELDS.STAGE]: fields.stage,
                    [PIPELINE_FIELDS.STATUS]: fields.status,
                    [PIPELINE_FIELDS.LEAD_SCORE]: fields.lead_score,
                },
            })
        );

        const result = await createPipelineIfNeeded(
            {} as Env,
            customerWithActivePipeline,
            {
                stage: "Interested",
                lead_score: 35,
                ai_summary: "ข้อความสอบถามทั่วไป",
            }
        );

        expect(result.old_state?.stage).toBe("Closing");
        expect(result.new_state.stage).toBe("Closing");
        expect(result.new_state.lead_score).toBe(90);
        expect(pipelineRepository.updatePipeline).toHaveBeenCalledWith(
            expect.anything(),
            negotiatingPipeline.record_id,
            expect.objectContaining({
                stage: "Closing",
                lead_score: 90,
            })
        );
    });

    it("creates a Pipeline only when no active or recoverable open Pipeline exists", async () => {
        vi.mocked(
            pipelineRepository.findOpenPipelinesByCustomer
        ).mockResolvedValue([]);
        vi.mocked(pipelineRepository.createPipeline).mockResolvedValue({
            record_id: "rec_pipeline_new",
            fields: {
                [PIPELINE_FIELDS.STAGE]: "Negotiating",
                [PIPELINE_FIELDS.STATUS]: "open",
                [PIPELINE_FIELDS.LEAD_SCORE]: 70,
            },
        });

        const result = await createPipelineIfNeeded(
            {} as Env,
            customer,
            {
                stage: "Negotiating",
                lead_score: 70,
                ai_summary: "ลูกค้าขอส่วนลด",
            }
        );

        expect(result.created).toBe(true);
        expect(result.record.record_id).toBe("rec_pipeline_new");
        expect(pipelineRepository.createPipeline).toHaveBeenCalledTimes(1);
        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            customer.record_id,
            {
                active_pipeline_id: "rec_pipeline_new",
            }
        );
    });
    it("uses the pre-upsert pipeline snapshot when the returned Customer record has no active pointer", async () => {
        vi.mocked(
            pipelineRepository.getPipelineByRecordId
        ).mockResolvedValue(negotiatingPipeline);

        const result = await markActivePipelineLost(
            {} as Env,
            customer,
            negotiatingPipeline.record_id
        );

        expect(result?.changed).toBe(true);
        expect(result?.record.record_id).toBe(
            negotiatingPipeline.record_id
        );
        expect(
            pipelineRepository.updatePipeline
        ).toHaveBeenCalledWith(
            expect.anything(),
            negotiatingPipeline.record_id,
            expect.objectContaining({
                stage: "Lost",
                status: "lost",
            })
        );
    });

    it("recovers and closes the only open Pipeline when the active pointer is blank", async () => {
        vi.mocked(
            pipelineRepository.findOpenPipelinesByCustomer
        ).mockResolvedValue([negotiatingPipeline]);

        const result = await markActivePipelineLost(
            {} as Env,
            customer
        );

        expect(result?.changed).toBe(true);
        expect(result?.record.record_id).toBe(
            negotiatingPipeline.record_id
        );
        expect(
            pipelineRepository.createPipeline
        ).not.toHaveBeenCalled();
    });

});
