import type { SalesStage } from "../../core/sales-stage";
import type { Channel } from "../customers/customer.types";

export type PipelineStage = SalesStage;

export type PipelineStatus =
    | "open"
    | "won"
    | "lost";

export interface SalesPipeline {
    customer_record_id?: string;

    stage: PipelineStage;

    status: PipelineStatus;

    lead_score: number;

    ai_summary?: string;

    sales_owner?: string;

    created_at?: number;

    closed_at?: number;

    channel?: Channel;
}