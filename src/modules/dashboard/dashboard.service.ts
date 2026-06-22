import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import {
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { listCustomers } from "../customers/customer.repository";
import { listOrders } from "../orders/order.repository";
import { listPipelines } from "../pipeline/pipeline.repository";

export type SalesPerformanceRow = {
    sales_owner: string;
    assigned_customers: number;
    open_pipelines: number;
    won_pipelines: number;
    lost_pipelines: number;
    paid_orders: number;
    revenue: number;
};

export type DashboardSummary = {
    generated_at: number;
    leads: {
        total: number;
        by_stage: Record<string, number>;
        unassigned: number;
        hot_leads: number;
    };
    pipeline: {
        total: number;
        open: number;
        won: number;
        lost: number;
        by_stage: Record<string, number>;
        close_rate_pct: number;
    };
    orders: {
        total: number;
        waiting_payment: number;
        payment_review: number;
        overdue: number;
        completed: number;
        cancelled: number;
        paid: number;
        revenue: number;
    };
    sales_performance: SalesPerformanceRow[];
};

function increment(
    target: Record<string, number>,
    key: string
): void {
    const normalized = key.trim() || "Unknown";
    target[normalized] = (target[normalized] ?? 0) + 1;
}

function normalizeOwner(value: unknown): string {
    const owner = getLarkText(value, "Unassigned").trim();
    return owner || "Unassigned";
}

function ensureSalesRow(
    map: Map<string, SalesPerformanceRow>,
    owner: string
): SalesPerformanceRow {
    const existing = map.get(owner);

    if (existing) {
        return existing;
    }

    const row: SalesPerformanceRow = {
        sales_owner: owner,
        assigned_customers: 0,
        open_pipelines: 0,
        won_pipelines: 0,
        lost_pipelines: 0,
        paid_orders: 0,
        revenue: 0,
    };

    map.set(owner, row);
    return row;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export async function buildDashboardSummary(
    env: Env
): Promise<DashboardSummary> {
    const [customers, pipelines, orders] = await Promise.all([
        listCustomers(env),
        listPipelines(env),
        listOrders(env),
    ]);

    const leadStages: Record<string, number> = {};
    const pipelineStages: Record<string, number> = {};
    const sales = new Map<string, SalesPerformanceRow>();
    let unassigned = 0;
    let hotLeads = 0;

    for (const customer of customers) {
        const stage = getLarkText(
            customer.fields[CUSTOMER_FIELDS.CURRENT_STAGE],
            "New Lead"
        );
        const owner = normalizeOwner(
            customer.fields[CUSTOMER_FIELDS.SALES_OWNER]
        );

        increment(leadStages, stage);
        ensureSalesRow(sales, owner).assigned_customers += 1;

        if (owner === "Unassigned") {
            unassigned += 1;
        }

        const hotLead =
            customer.fields[CUSTOMER_FIELDS.HOT_LEAD] === true ||
            getLarkText(
                customer.fields[CUSTOMER_FIELDS.HOT_LEAD],
                ""
            ).toLowerCase() === "true";

        if (hotLead) {
            hotLeads += 1;
        }
    }

    let pipelineOpen = 0;
    let pipelineWon = 0;
    let pipelineLost = 0;

    for (const pipeline of pipelines) {
        const stage = getLarkText(
            pipeline.fields[PIPELINE_FIELDS.STAGE],
            "Interested"
        );
        const status = getLarkText(
            pipeline.fields[PIPELINE_FIELDS.STATUS],
            "open"
        )
            .trim()
            .toLowerCase();
        const owner = normalizeOwner(
            pipeline.fields[PIPELINE_FIELDS.SALES_OWNER]
        );
        const row = ensureSalesRow(sales, owner);

        increment(pipelineStages, stage);

        if (status === "won") {
            pipelineWon += 1;
            row.won_pipelines += 1;
        } else if (status === "lost") {
            pipelineLost += 1;
            row.lost_pipelines += 1;
        } else {
            pipelineOpen += 1;
            row.open_pipelines += 1;
        }
    }

    let waitingPayment = 0;
    let paymentReview = 0;
    let overdue = 0;
    let completed = 0;
    let cancelled = 0;
    let paid = 0;
    let revenue = 0;

    for (const order of orders) {
        const paymentStatus = getLarkText(
            order.fields[ORDER_FIELDS.PAYMENT_STATUS],
            ""
        )
            .trim()
            .toLowerCase();
        const orderStatus = getLarkText(
            order.fields[ORDER_FIELDS.ORDER_STATUS],
            ""
        )
            .trim()
            .toLowerCase();
        const owner = normalizeOwner(
            order.fields[ORDER_FIELDS.SALES_OWNER]
        );
        const amount = Math.max(
            0,
            getLarkNumber(
                order.fields[ORDER_FIELDS.TOTAL_AMOUNT],
                0
            )
        );

        if (paymentStatus === "waiting payment") {
            waitingPayment += 1;
        } else if (paymentStatus === "payment review") {
            paymentReview += 1;
        } else if (paymentStatus === "overdue") {
            overdue += 1;
        } else if (paymentStatus === "paid") {
            paid += 1;
            revenue += amount;
            const row = ensureSalesRow(sales, owner);
            row.paid_orders += 1;
            row.revenue += amount;
        }

        if (orderStatus === "completed") {
            completed += 1;
        } else if (orderStatus === "cancelled") {
            cancelled += 1;
        }
    }

    const closedPipelines = pipelineWon + pipelineLost;
    const closeRate =
        closedPipelines > 0
            ? (pipelineWon / closedPipelines) * 100
            : 0;

    return {
        generated_at: Date.now(),
        leads: {
            total: customers.length,
            by_stage: leadStages,
            unassigned,
            hot_leads: hotLeads,
        },
        pipeline: {
            total: pipelines.length,
            open: pipelineOpen,
            won: pipelineWon,
            lost: pipelineLost,
            by_stage: pipelineStages,
            close_rate_pct: round2(closeRate),
        },
        orders: {
            total: orders.length,
            waiting_payment: waitingPayment,
            payment_review: paymentReview,
            overdue,
            completed,
            cancelled,
            paid,
            revenue: round2(revenue),
        },
        sales_performance: [...sales.values()]
            .map((row) => ({
                ...row,
                revenue: round2(row.revenue),
            }))
            .sort((left, right) => {
                if (right.revenue !== left.revenue) {
                    return right.revenue - left.revenue;
                }

                return left.sales_owner.localeCompare(
                    right.sales_owner
                );
            }),
    };
}
