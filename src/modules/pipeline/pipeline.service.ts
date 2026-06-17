import type { Env } from "../../config/env";
import { CUSTOMER_FIELDS } from "../../core/lark-fields";
import { updateCustomer, type LarkCustomerRecord } from "../customers/customer.repository";
import { createPipeline, type LarkPipelineRecord } from "./pipeline.repository";

function getFirstLinkedRecordId(value: unknown): string | null {
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }

    const first = value[0] as any;

    if (typeof first === "string") {
        return first;
    }

    return first?.record_id ?? first?.id ?? null;
}

export async function createOpenPipelineForCustomer(
    env: Env,
    input: {
        customer_record_id: string;
        lead_score?: number;
        ai_summary?: string;
        sales_owner?: string;
    }
): Promise<LarkPipelineRecord> {
    return await createPipeline(env, {
        customer_record_id: input.customer_record_id,
        stage: "Interested",
        status: "open",
        lead_score: input.lead_score ?? 0,
        ai_summary: input.ai_summary ?? "",
        sales_owner: input.sales_owner ?? "Unassigned",
    });
}

export async function createPipelineIfNeeded(
    env: Env,
    customer: LarkCustomerRecord,
    input: {
        lead_score: number;
        ai_summary: string;
        sales_owner?: string;
    }
): Promise<LarkPipelineRecord | null> {
    const activePipelineId = getFirstLinkedRecordId(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_PIPELINE]
    );

    if (activePipelineId) {
        return null;
    }

    const pipeline = await createOpenPipelineForCustomer(env, {
        customer_record_id: customer.record_id,
        lead_score: input.lead_score,
        ai_summary: input.ai_summary,
        sales_owner: input.sales_owner ?? "Unassigned",
    });

    await updateCustomer(env, customer.record_id, {
        active_pipeline: [pipeline.record_id],
    });

    return pipeline;
}