import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import {
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
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
import type {
    PipelineStage,
    PipelineStatus,
} from "./pipeline.types";

export type PipelineAuditState = {
    stage: PipelineStage;
    status: PipelineStatus;
    lead_score: number;
};

export type EnsurePipelineResult = {
    record: LarkPipelineRecord;
    created: boolean;
    updated: boolean;
    old_state: PipelineAuditState | null;
    new_state: PipelineAuditState;
};

export type MarkPipelineLostResult = {
    record: LarkPipelineRecord;
    changed: boolean;
    old_state: PipelineAuditState;
    new_state: PipelineAuditState;
};

const PIPELINE_STAGE_RANK: Record<
    PipelineStage,
    number
> = {
    Interested: 0,
    Negotiating: 1,
    Closing: 2,
    Won: 3,
    Lost: 3,
};

function normalizePipelineStage(
    value: unknown
): PipelineStage {
    const stage = getLarkText(value, "").trim();

    if (
        stage === "Interested" ||
        stage === "Negotiating" ||
        stage === "Closing" ||
        stage === "Won" ||
        stage === "Lost"
    ) {
        return stage;
    }

    return "Interested";
}

function normalizePipelineStatus(
    value: unknown
): PipelineStatus {
    const status = getLarkText(value, "")
        .trim()
        .toLowerCase();

    if (
        status === "open" ||
        status === "won" ||
        status === "lost"
    ) {
        return status;
    }

    return "open";
}

function getPipelineAuditState(
    pipeline: LarkPipelineRecord
): PipelineAuditState {
    return {
        stage: normalizePipelineStage(
            pipeline.fields[PIPELINE_FIELDS.STAGE]
        ),
        status: normalizePipelineStatus(
            pipeline.fields[PIPELINE_FIELDS.STATUS]
        ),
        lead_score: getLarkNumber(
            pipeline.fields[PIPELINE_FIELDS.LEAD_SCORE],
            0
        ),
    };
}

function hasPipelineStateChanged(
    oldState: PipelineAuditState,
    newState: PipelineAuditState
): boolean {
    return (
        oldState.stage !== newState.stage ||
        oldState.status !== newState.status ||
        oldState.lead_score !== newState.lead_score
    );
}

function mergeOpenPipelineStage(
    existingStage: PipelineStage,
    incomingStage: PipelineStage
): PipelineStage {
    if (
        PIPELINE_STAGE_RANK[incomingStage] >=
        PIPELINE_STAGE_RANK[existingStage]
    ) {
        return incomingStage;
    }

    return existingStage;
}

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
        customer_record_id: input.customer_record_id,
        stage: input.stage ?? "Interested",
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
        stage: PipelineStage;
        lead_score: number;
        ai_summary: string;
        sales_owner?: string;
    }
): Promise<EnsurePipelineResult> {
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
            const oldState = getPipelineAuditState(
                existingPipeline
            );

            const isClosed =
                oldState.status === "won" ||
                oldState.status === "lost";

            if (!isClosed) {
                const newState: PipelineAuditState = {
                    stage: mergeOpenPipelineStage(
                        oldState.stage,
                        input.stage
                    ),
                    status: "open",
                    lead_score: Math.max(
                        oldState.lead_score,
                        input.lead_score
                    ),
                };

                const updatedPipeline =
                    await updatePipeline(
                        env,
                        activePipelineId,
                        {
                            stage: newState.stage,
                            status: newState.status,
                            lead_score:
                                newState.lead_score,
                            ai_summary:
                                input.ai_summary,
                        }
                    );

                return {
                    record: updatedPipeline,
                    created: false,
                    updated:
                        hasPipelineStateChanged(
                            oldState,
                            newState
                        ),
                    old_state: oldState,
                    new_state: newState,
                };
            }
        }
    }

    const newState: PipelineAuditState = {
        stage: input.stage,
        status: "open",
        lead_score: input.lead_score,
    };

    const pipeline =
        await createOpenPipelineForCustomer(
            env,
            {
                customer_record_id:
                    customer.record_id,
                stage: newState.stage,
                lead_score:
                    newState.lead_score,
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

    return {
        record: pipeline,
        created: true,
        updated: false,
        old_state: null,
        new_state: newState,
    };
}

export async function markActivePipelineLost(
    env: Env,
    customer: LarkCustomerRecord
): Promise<MarkPipelineLostResult | null> {
    const activePipelineId = getLarkText(
        customer.fields[
            CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID
        ],
        ""
    ).trim();

    if (!activePipelineId) {
        return null;
    }

    const existingPipeline =
        await getPipelineByRecordId(
            env,
            activePipelineId
        );

    if (!existingPipeline) {
        return null;
    }

    const oldState = getPipelineAuditState(
        existingPipeline
    );

    const newState: PipelineAuditState = {
        stage: "Lost",
        status: "lost",
        lead_score: oldState.lead_score,
    };

    const changed = hasPipelineStateChanged(
        oldState,
        newState
    );

    if (!changed) {
        return {
            record: existingPipeline,
            changed: false,
            old_state: oldState,
            new_state: newState,
        };
    }

    const lostPipeline = await updatePipeline(
        env,
        activePipelineId,
        {
            stage: newState.stage,
            status: newState.status,
            closed_at: Date.now(),
        }
    );

    return {
        record: lostPipeline,
        changed: true,
        old_state: oldState,
        new_state: newState,
    };
}
