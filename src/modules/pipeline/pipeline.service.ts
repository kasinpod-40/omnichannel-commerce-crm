import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import { getLarkText } from "../../utils/lark-field-value";
import {
    updateCustomer,
    type LarkCustomerRecord,
} from "../customers/customer.repository";
import {
    createPipeline,
    getPipelineByRecordId,
    updatePipeline,
    type LarkPipelineRecord,
} from "./pipeline.repository";
import type { PipelineStage } from "./pipeline.types";

export async function createOpenPipelineForCustomer(
    env: Env,
    input: {
        customer_record_id: string;
        stage?: PipelineStage;
        lead_score?: number;
        ai_summary?: string;
        sales_owner?: string;
    }
): Promise<LarkPipelineRecord> {
    return await createPipeline(env, {
        customer_record_id:
            input.customer_record_id,
        stage: input.stage ?? "Interested",
        status: "open",
        lead_score: input.lead_score ?? 0,
        ai_summary: input.ai_summary ?? "",
        sales_owner:
            input.sales_owner ?? "Unassigned",
    });
}

export async function createPipelineIfNeeded(
    env: Env,
    customer: LarkCustomerRecord,
    input: {
        stage: PipelineStage;
        lead_score: number;
        ai_summary: string;
        sales_owner?: string;
    }
): Promise<LarkPipelineRecord> {
    const activePipelineId = getLarkText(
        customer.fields[
        CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID
        ],
        ""
    ).trim();

    if (activePipelineId) {
        const existingPipeline =
            await getPipelineByRecordId(
                env,
                activePipelineId
            );

        if (existingPipeline) {
            const existingStatus = getLarkText(
                existingPipeline.fields[
                PIPELINE_FIELDS.STATUS
                ],
                ""
            ).toLowerCase();

            const isClosed =
                existingStatus === "won" ||
                existingStatus === "lost";

            if (!isClosed) {
                return await updatePipeline(
                    env,
                    activePipelineId,
                    {
                        stage: input.stage,
                        status: "open",
                        lead_score: input.lead_score,
                        ai_summary: input.ai_summary,
                    }
                );
            }
        }
    }

    const pipeline =
        await createOpenPipelineForCustomer(
            env,
            {
                customer_record_id:
                    customer.record_id,
                stage: input.stage,
                lead_score: input.lead_score,
                ai_summary: input.ai_summary,
                sales_owner:
                    input.sales_owner ?? "Unassigned",
            }
        );

    await updateCustomer(
        env,
        customer.record_id,
        {
            active_pipeline_id:
                pipeline.record_id,
        }
    );

    return pipeline;
}

export async function markActivePipelineLost(
    env: Env,
    customer: LarkCustomerRecord
): Promise<LarkPipelineRecord | null> {
    const activePipelineId = getLarkText(
        customer.fields[
        CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID
        ],
        ""
    ).trim();

    if (!activePipelineId) {
        return null;
    }

    return await updatePipeline(
        env,
        activePipelineId,
        {
            stage: "Lost",
            status: "lost",
            closed_at: Date.now(),
        }
    );
}