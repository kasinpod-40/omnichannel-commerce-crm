import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import { normalizeLeadScore } from "../../core/lead-score";
import {
    SALES_STAGE_RANK,
    normalizeOpenSalesStage,
    resolvePipelineStage,
    type OpenSalesStage,
} from "../../core/sales-stage";
import {
    getLarkNumber,
    getLarkText,
    getLinkedRecordIds,
} from "../../utils/lark-field-value";
import {
    updateCustomer,
    type LarkCustomerRecord,
} from "../customers/customer.repository";
import {
    createPipeline,
    findOpenPipelinesByCustomer,
    getPipelineByRecordId,
    getPipelinesByRecordIds,
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
    const status = normalizePipelineStatus(
        pipeline.fields[PIPELINE_FIELDS.STATUS]
    );
    const stage = resolvePipelineStage(
        status,
        getLarkText(
            pipeline.fields[PIPELINE_FIELDS.STAGE],
            ""
        ).trim()
    );

    return {
        stage,
        status,
        lead_score: normalizeLeadScore(
            getLarkNumber(
                pipeline.fields[PIPELINE_FIELDS.LEAD_SCORE],
                0
            )
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
    existingStage: OpenSalesStage,
    incomingStage: OpenSalesStage
): OpenSalesStage {
    if (
        SALES_STAGE_RANK[incomingStage] >=
        SALES_STAGE_RANK[existingStage]
    ) {
        return incomingStage;
    }

    return existingStage;
}

export async function createOpenPipelineForCustomer(
    env: Env,
    input: {
        customer_record_id: string;
        stage?: OpenSalesStage;
        lead_score?: number;
        ai_summary?: string;
        sales_owner?: string;
    }
): Promise<LarkPipelineRecord> {
    return await createPipeline(env, {
        customer_record_id: input.customer_record_id,
        stage: input.stage ?? "Interested",
        status: "open",
        lead_score: normalizeLeadScore(input.lead_score),
        ai_summary: input.ai_summary ?? "",
        sales_owner: input.sales_owner ?? "Unassigned",
    });
}

export async function createPipelineIfNeeded(
    env: Env,
    customer: LarkCustomerRecord,
    input: {
        stage: OpenSalesStage;
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

    let existingOpenPipeline: LarkPipelineRecord | null = null;
    let recoveredPipelinePointer = false;

    if (activePipelineId) {
        const activePipeline =
            await getPipelineByRecordId(
                env,
                activePipelineId
            );

        if (activePipeline) {
            const activeState =
                getPipelineAuditState(activePipeline);

            if (activeState.status === "open") {
                existingOpenPipeline = activePipeline;
            }
        }
    }

    /*
     * active_pipeline_id is only a text cache. Deleting a Pipeline record in
     * Lark does not clear this field automatically. Recover from the real
     * relationship history first, then fall back to a table search.
     */
    if (!existingOpenPipeline) {
        const historyPipelineIds = getLinkedRecordIds(
            customer.fields[
                CUSTOMER_FIELDS.PIPELINES_HISTORY
            ]
        );

        const historyPipelines =
            await getPipelinesByRecordIds(
                env,
                historyPipelineIds
            );

        const openHistoryPipelines = historyPipelines.filter(
            (pipeline) =>
                getPipelineAuditState(pipeline).status === "open"
        );

        if (openHistoryPipelines.length > 1) {
            throw new Error(
                `PIPELINE_INVARIANT_MULTIPLE_OPEN: customer=${customer.record_id}, pipelines=${openHistoryPipelines
                    .map((pipeline) => pipeline.record_id)
                    .join(",")}`
            );
        }

        existingOpenPipeline =
            openHistoryPipelines[0] ?? null;
        recoveredPipelinePointer = Boolean(
            existingOpenPipeline &&
                existingOpenPipeline.record_id !== activePipelineId
        );
    }

    if (!existingOpenPipeline) {
        const openPipelines =
            await findOpenPipelinesByCustomer(
                env,
                customer.record_id
            );

        if (openPipelines.length > 1) {
            throw new Error(
                `PIPELINE_INVARIANT_MULTIPLE_OPEN: customer=${customer.record_id}, pipelines=${openPipelines
                    .map((pipeline) => pipeline.record_id)
                    .join(",")}`
            );
        }

        existingOpenPipeline =
            openPipelines[0] ?? null;
        recoveredPipelinePointer = Boolean(
            existingOpenPipeline &&
                existingOpenPipeline.record_id !== activePipelineId
        );
    }

    if (existingOpenPipeline) {
        const oldState = getPipelineAuditState(
            existingOpenPipeline
        );

        const newState: PipelineAuditState = {
            stage: mergeOpenPipelineStage(
                normalizeOpenSalesStage(oldState.stage),
                input.stage
            ),
            status: "open",
            lead_score: normalizeLeadScore(
                Math.max(
                    oldState.lead_score,
                    input.lead_score
                )
            ),
        };

        const updatedPipeline =
            await updatePipeline(
                env,
                existingOpenPipeline.record_id,
                {
                    stage: newState.stage,
                    status: newState.status,
                    lead_score: newState.lead_score,
                    ai_summary: input.ai_summary,
                }
            );

        const persistedState =
            getPipelineAuditState(updatedPipeline);

        if (
            persistedState.stage !== newState.stage ||
            persistedState.status !== newState.status ||
            persistedState.lead_score !== newState.lead_score
        ) {
            throw new Error(
                `PIPELINE_UPDATE_NOT_PERSISTED: pipeline=${existingOpenPipeline.record_id}`
            );
        }

        if (recoveredPipelinePointer) {
            await updateCustomer(
                env,
                customer.record_id,
                {
                    active_pipeline_id:
                        updatedPipeline.record_id,
                }
            );
        }

        return {
            record: updatedPipeline,
            created: false,
            updated: hasPipelineStateChanged(
                oldState,
                newState
            ),
            old_state: oldState,
            new_state: newState,
        };
    }

    const newState: PipelineAuditState = {
        stage: input.stage,
        status: "open",
        lead_score: normalizeLeadScore(input.lead_score),
    };

    const pipeline =
        await createOpenPipelineForCustomer(
            env,
            {
                customer_record_id:
                    customer.record_id,
                stage: input.stage,
                lead_score: newState.lead_score,
                ai_summary: input.ai_summary,
                sales_owner:
                    input.sales_owner ?? "Unassigned",
            }
        );

    await updateCustomer(
        env,
        customer.record_id,
        {
            active_pipeline_id: pipeline.record_id,
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
    customer: LarkCustomerRecord,
    preferredPipelineId?: string
): Promise<MarkPipelineLostResult | null> {
    const cachedActivePipelineId = getLarkText(
        customer.fields[
            CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID
        ],
        ""
    ).trim();

    const activePipelineId =
        preferredPipelineId?.trim() ||
        cachedActivePipelineId;

    let existingPipeline: LarkPipelineRecord | null = null;

    if (activePipelineId) {
        existingPipeline =
            await getPipelineByRecordId(
                env,
                activePipelineId
            );

        if (existingPipeline) {
            const activeState =
                getPipelineAuditState(existingPipeline);

            if (activeState.status === "won") {
                throw new Error(
                    `LOST_PIPELINE_ALREADY_WON: customer=${customer.record_id}, pipeline=${existingPipeline.record_id}`
                );
            }
        }
    }

    /*
     * The text pointer can be blank/stale after a partial legacy flow. Recover
     * from the Customer relation history, then from the Pipeline table. Never
     * guess when more than one open Pipeline exists.
     */
    if (!existingPipeline) {
        const historyPipelineIds = getLinkedRecordIds(
            customer.fields[
                CUSTOMER_FIELDS.PIPELINES_HISTORY
            ]
        );

        const historyPipelines =
            await getPipelinesByRecordIds(
                env,
                historyPipelineIds
            );

        const openHistoryPipelines = historyPipelines.filter(
            (pipeline) =>
                getPipelineAuditState(pipeline).status === "open"
        );

        if (openHistoryPipelines.length > 1) {
            throw new Error(
                `PIPELINE_INVARIANT_MULTIPLE_OPEN: customer=${customer.record_id}, pipelines=${openHistoryPipelines
                    .map((pipeline) => pipeline.record_id)
                    .join(",")}`
            );
        }

        existingPipeline =
            openHistoryPipelines[0] ?? null;
    }

    if (!existingPipeline) {
        const openPipelines =
            await findOpenPipelinesByCustomer(
                env,
                customer.record_id
            );

        if (openPipelines.length > 1) {
            throw new Error(
                `PIPELINE_INVARIANT_MULTIPLE_OPEN: customer=${customer.record_id}, pipelines=${openPipelines
                    .map((pipeline) => pipeline.record_id)
                    .join(",")}`
            );
        }

        existingPipeline = openPipelines[0] ?? null;
    }

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
        existingPipeline.record_id,
        {
            stage: newState.stage,
            status: newState.status,
            closed_at: Date.now(),
        }
    );

    const persistedState =
        getPipelineAuditState(lostPipeline);

    if (
        persistedState.stage !== "Lost" ||
        persistedState.status !== "lost"
    ) {
        throw new Error(
            `PIPELINE_LOST_UPDATE_NOT_PERSISTED: pipeline=${existingPipeline.record_id}`
        );
    }

    return {
        record: lostPipeline,
        changed: true,
        old_state: oldState,
        new_state: newState,
    };
}
