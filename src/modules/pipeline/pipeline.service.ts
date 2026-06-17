import type { Env } from "../../config/env";
import { createPipeline } from "./pipeline.repository";

export async function createOpenPipelineForCustomer(
    env: Env,
    input: {
        customer_record_id: string;
        lead_score?: number;
        ai_summary?: string;
        sales_owner?: string;
    }
): Promise<unknown> {
    return await createPipeline(env, {
        customer_record_id: input.customer_record_id,
        stage: "Interested",
        status: "open",
        lead_score: input.lead_score ?? 0,
        ai_summary: input.ai_summary ?? "",
        sales_owner: input.sales_owner ?? "Unassigned",
    });
}