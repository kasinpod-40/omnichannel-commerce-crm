import type { Env } from "../../config/env";
import { normalizeLeadScore } from "../../core/lead-score";
import { PIPELINE_FIELDS } from "../../core/lark-fields";
import { resolvePipelineStage, type SalesStage } from "../../core/sales-stage";
import { getLarkNumber, getLarkText } from "../../utils/lark-field-value";
import {
    buildCustomerLookup,
    getLinkedRecordId,
    readTimestamp,
    toIso,
    unknownCustomer,
} from "../dashboard-read/dashboard-read.shared";
import type { LarkPipelineRecord } from "./pipeline.repository";
import {
    getDashboardCustomers,
    getDashboardPipelines,
} from "../dashboard-read/dashboard-read.records";

export type PipelineStatusResponse = "open" | "won" | "lost";
export type PipelineStageResponse = SalesStage;

export type PipelineRecordResponse = {
    pipeline_id: string;
    status: PipelineStatusResponse;
    stage: PipelineStageResponse;
    lead_score: number;
    ai_summary: string | null;
    created_at: string;
    closed_at: string | null;
    customer: {
        customer_id: string;
        customer_name: string;
        channel: "LINE" | "Shopee" | "Lazada" | "TikTok Shop";
        phone: string | null;
        sales_owner: string | null;
        active_order_id: string | null;
    };
};

export type PipelineListResponse = {
    items: PipelineRecordResponse[];
    summary: {
        total_pipelines: number;
        open_pipelines: number;
        won_pipelines: number;
        lost_pipelines: number;
    };
    total: number;
    updated_at: string;
};

export type PipelineListQuery = {
    search: string;
    status: PipelineStatusResponse | null;
};

type PipelineReadData = {
    customers: Awaited<ReturnType<typeof getDashboardCustomers>>;
    pipelines: Awaited<ReturnType<typeof getDashboardPipelines>>;
};

async function loadPipelineReadData(env: Env): Promise<PipelineReadData> {
    const [customers, pipelines] = await Promise.all([
        getDashboardCustomers(env),
        getDashboardPipelines(env),
    ]);
    return { customers, pipelines };
}

function normalizeStatus(value: unknown): PipelineStatusResponse {
    const status = getLarkText(value, "open").trim().toLowerCase();
    if (status === "won") return "won";
    if (status === "lost") return "lost";
    return "open";
}

function mapPipeline(
    record: LarkPipelineRecord,
    customers: ReturnType<typeof buildCustomerLookup>
): PipelineRecordResponse {
    const fields = record.fields;
    const customerId = getLinkedRecordId(fields[PIPELINE_FIELDS.CUSTOMER]);
    const customer = customers.get(customerId ?? "") ?? unknownCustomer(customerId);
    const status = normalizeStatus(fields[PIPELINE_FIELDS.STATUS]);
    const createdAt = readTimestamp(fields[PIPELINE_FIELDS.CREATED_AT]);
    const closedAt = readTimestamp(fields[PIPELINE_FIELDS.CLOSED_AT]);
    const pipelineOwner = getLarkText(fields[PIPELINE_FIELDS.SALES_OWNER], "").trim();
    const linkedOrderId = getLinkedRecordId(fields[PIPELINE_FIELDS.ORDER]);

    return {
        pipeline_id: record.record_id,
        status,
        stage: resolvePipelineStage(
            status,
            getLarkText(fields[PIPELINE_FIELDS.STAGE], "").trim()
        ),
        lead_score: normalizeLeadScore(
            getLarkNumber(
                fields[PIPELINE_FIELDS.LEAD_SCORE],
                customer.lead_score
            )
        ),
        ai_summary: getLarkText(fields[PIPELINE_FIELDS.AI_SUMMARY], "").trim() || null,
        created_at: toIso(createdAt),
        closed_at: closedAt > 0 ? toIso(closedAt) : null,
        customer: {
            customer_id: customer.customer_id,
            customer_name: customer.customer_name,
            channel: customer.channel,
            phone: customer.phone,
            sales_owner: pipelineOwner || customer.sales_owner,
            active_order_id: linkedOrderId ?? customer.active_order_id,
        },
    };
}

function matchesQuery(item: PipelineRecordResponse, query: PipelineListQuery): boolean {
    const search = query.search.trim().toLocaleLowerCase("th-TH");
    const text = [
        item.pipeline_id,
        item.customer.customer_id,
        item.customer.customer_name,
        item.customer.phone ?? "",
        item.customer.sales_owner ?? "",
        item.ai_summary ?? "",
    ].join(" ").toLocaleLowerCase("th-TH");

    return (!search || text.includes(search)) && (!query.status || item.status === query.status);
}

export async function getPipelineList(
    env: Env,
    query: PipelineListQuery
): Promise<PipelineListResponse> {
    const data = await loadPipelineReadData(env);
    const customers = buildCustomerLookup(data.customers);
    const allItems = data.pipelines.map((record) => mapPipeline(record, customers))
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
    const items = allItems.filter((item) => matchesQuery(item, query));

    return {
        items,
        summary: {
            total_pipelines: allItems.length,
            open_pipelines: allItems.filter((item) => item.status === "open").length,
            won_pipelines: allItems.filter((item) => item.status === "won").length,
            lost_pipelines: allItems.filter((item) => item.status === "lost").length,
        },
        total: items.length,
        updated_at: new Date().toISOString(),
    };
}

export async function getPipelineDetail(
    env: Env,
    pipelineId: string
): Promise<PipelineRecordResponse | null> {
    const data = await loadPipelineReadData(env);
    const record = data.pipelines.find((item) => item.record_id === pipelineId);
    if (!record) return null;
    return mapPipeline(record, buildCustomerLookup(data.customers));
}
