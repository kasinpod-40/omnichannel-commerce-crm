import type { Env } from "../../config/env";
import { PIPELINE_FIELDS } from "../../core/lark-fields";
import {
    createLarkRecord,
    updateLarkRecord,
} from "../../providers/lark/lark.provider";
import type { SalesPipeline } from "./pipeline.types";

export async function createPipeline(
    env: Env,
    pipeline: SalesPipeline
): Promise<unknown> {
    const fields: Record<string, unknown> = {
        [PIPELINE_FIELDS.STAGE]: pipeline.stage,
        [PIPELINE_FIELDS.STATUS]: pipeline.status,
        [PIPELINE_FIELDS.LEAD_SCORE]: pipeline.lead_score,
        [PIPELINE_FIELDS.AI_SUMMARY]: pipeline.ai_summary ?? "",
        [PIPELINE_FIELDS.SALES_OWNER]: pipeline.sales_owner ?? "Unassigned",
        [PIPELINE_FIELDS.CREATED_AT]: pipeline.created_at ?? Date.now(),
    };

    if (pipeline.customer_record_id) {
        fields[PIPELINE_FIELDS.CUSTOMER] = [
            pipeline.customer_record_id,
        ];
    }

    if (pipeline.closed_at) {
        fields[PIPELINE_FIELDS.CLOSED_AT] = pipeline.closed_at;
    }

    return await createLarkRecord(env, env.PIPELINE_TABLE_ID, fields);
}

export async function updatePipeline(
    env: Env,
    recordId: string,
    fields: Partial<{
        stage: string;
        status: string;
        lead_score: number;
        ai_summary: string;
        sales_owner: string;
        closed_at: number;
        order: string[];
    }>
): Promise<unknown> {
    return await updateLarkRecord(env, env.PIPELINE_TABLE_ID, recordId, {
        ...fields,
    });
}