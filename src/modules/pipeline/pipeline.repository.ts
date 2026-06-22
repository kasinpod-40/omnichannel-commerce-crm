import type { Env } from "../../config/env";
import { PIPELINE_FIELDS } from "../../core/lark-fields";
import {
    createLarkRecord,
    getLarkRecord,
    searchLarkRecords,
    listLarkRecords,
    updateLarkRecord,
} from "../../providers/lark/lark.provider";
import {
    getLarkNumber,
    getLarkText,
    getLinkedRecordIds,
} from "../../utils/lark-field-value";
import type { SalesPipeline } from "./pipeline.types";

export type LarkPipelineRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

function normalizePipelineRecord(result: unknown): LarkPipelineRecord {
    const data = result as any;

    if (data?.record?.record_id) {
        return data.record as LarkPipelineRecord;
    }

    if (data?.record_id) {
        return data as LarkPipelineRecord;
    }

    throw new Error(`Invalid Lark pipeline record: ${JSON.stringify(result)}`);
}


export async function findOpenPipelinesByCustomer(
    env: Env,
    customerRecordId: string
): Promise<LarkPipelineRecord[]> {
    const records = await searchLarkRecords(
        env,
        env.PIPELINE_TABLE_ID,
        {
            conjunction: "and",
            conditions: [
                {
                    field_name: PIPELINE_FIELDS.STATUS,
                    operator: "is",
                    value: ["open"],
                },
            ],
        }
    );

    return records
        .map(normalizePipelineRecord)
        .filter((pipeline) =>
            getLinkedRecordIds(
                pipeline.fields[PIPELINE_FIELDS.CUSTOMER]
            ).includes(customerRecordId)
        )
        .filter(
            (pipeline) =>
                getLarkText(
                    pipeline.fields[PIPELINE_FIELDS.STATUS],
                    ""
                )
                    .trim()
                    .toLowerCase() === "open"
        )
        .sort((left, right) => {
            const leftCreatedAt = getLarkNumber(
                left.fields[PIPELINE_FIELDS.CREATED_AT],
                Number.MAX_SAFE_INTEGER
            );
            const rightCreatedAt = getLarkNumber(
                right.fields[PIPELINE_FIELDS.CREATED_AT],
                Number.MAX_SAFE_INTEGER
            );

            if (leftCreatedAt !== rightCreatedAt) {
                return leftCreatedAt - rightCreatedAt;
            }

            return left.record_id.localeCompare(right.record_id);
        });
}

export async function getPipelinesByRecordIds(
    env: Env,
    recordIds: string[]
): Promise<LarkPipelineRecord[]> {
    const uniqueRecordIds = [...new Set(recordIds.filter(Boolean))];
    const records: LarkPipelineRecord[] = [];

    for (const recordId of uniqueRecordIds) {
        const record = await getPipelineByRecordId(env, recordId);

        if (record) {
            records.push(record);
        }
    }

    return records;
}

export async function createPipeline(
    env: Env,
    pipeline: SalesPipeline
): Promise<LarkPipelineRecord> {
    const fields: Record<string, unknown> = {
        [PIPELINE_FIELDS.STAGE]: pipeline.stage,
        [PIPELINE_FIELDS.STATUS]: pipeline.status,
        [PIPELINE_FIELDS.LEAD_SCORE]: pipeline.lead_score,
        [PIPELINE_FIELDS.AI_SUMMARY]: pipeline.ai_summary ?? "",
        [PIPELINE_FIELDS.SALES_OWNER]: pipeline.sales_owner ?? "Unassigned",
        [PIPELINE_FIELDS.CREATED_AT]: pipeline.created_at ?? Date.now(),
    };

    if (pipeline.customer_record_id) {
        fields[PIPELINE_FIELDS.CUSTOMER] = [pipeline.customer_record_id];
    }

    if (pipeline.closed_at) {
        fields[PIPELINE_FIELDS.CLOSED_AT] = pipeline.closed_at;
    }

    const result = await createLarkRecord(env, env.PIPELINE_TABLE_ID, fields);

    return normalizePipelineRecord(result);
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
): Promise<LarkPipelineRecord> {
    const result = await updateLarkRecord(env, env.PIPELINE_TABLE_ID, recordId, {
        ...fields,
    });

    return normalizePipelineRecord(result);
}

export async function getPipelineByRecordId(
    env: Env,
    recordId: string
): Promise<LarkPipelineRecord | null> {
    const result = await getLarkRecord(env, env.PIPELINE_TABLE_ID, recordId);

    if (!result) {
        return null;
    }

    return result as LarkPipelineRecord;
}
export async function listPipelines(
    env: Env
): Promise<LarkPipelineRecord[]> {
    const records = await listLarkRecords(
        env,
        env.PIPELINE_TABLE_ID
    );

    return records.map(normalizePipelineRecord);
}
