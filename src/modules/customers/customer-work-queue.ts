import { CUSTOMER_FIELDS, PIPELINE_FIELDS } from "../../core/lark-fields";
import { isSalesStage } from "../../core/sales-stage";
import {
    getFirstLinkedRecordId,
    getLarkBoolean,
    getLarkText,
} from "../../utils/lark-field-value";
import type { LarkPipelineRecord } from "../pipeline/pipeline.repository";
import type { LarkCustomerRecord } from "./customer.repository";

export type CustomerWorkQueue = "hot_lead" | "none";

function normalize(value: unknown): string {
    return getLarkText(value, "").trim().toLowerCase();
}

function hasOpenPipeline(
    customer: LarkCustomerRecord,
    pipelines: readonly LarkPipelineRecord[]
): boolean {
    const pointer = getLarkText(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID],
        ""
    ).trim();

    return pipelines.some((pipeline) => {
        const linkedCustomerId = getFirstLinkedRecordId(
            pipeline.fields[PIPELINE_FIELDS.CUSTOMER]
        );
        const status = normalize(pipeline.fields[PIPELINE_FIELDS.STATUS]);
        const stage = getLarkText(pipeline.fields[PIPELINE_FIELDS.STAGE], "").trim();
        const pointerMatches = !pointer || pipeline.record_id === pointer;
        return (
            pointerMatches &&
            linkedCustomerId === customer.record_id &&
            status === "open" &&
            isSalesStage(stage) &&
            stage !== "Won" &&
            stage !== "Lost"
        );
    });
}

export function classifyCustomerWorkQueue(
    customer: LarkCustomerRecord,
    pipelines: readonly LarkPipelineRecord[]
): CustomerWorkQueue {
    const stage = getLarkText(
        customer.fields[CUSTOMER_FIELDS.CURRENT_STAGE],
        "New Lead"
    ).trim();

    if (
        !getLarkBoolean(customer.fields[CUSTOMER_FIELDS.HOT_LEAD], false) ||
        stage === "Won" ||
        stage === "Lost" ||
        !hasOpenPipeline(customer, pipelines)
    ) {
        return "none";
    }

    return "hot_lead";
}
