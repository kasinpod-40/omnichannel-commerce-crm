import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";

const { listCustomers, listPipelines, listOrders } = vi.hoisted(
    () => ({
        listCustomers: vi.fn(),
        listPipelines: vi.fn(),
        listOrders: vi.fn(),
    })
);

vi.mock("../customers/customer.repository", () => ({
    listCustomers,
}));

vi.mock("../pipeline/pipeline.repository", () => ({
    listPipelines,
}));

vi.mock("../orders/order.repository", () => ({
    listOrders,
}));

import { buildDashboardSummary } from "./dashboard.service";

const env = {} as any;

describe("dashboard summary", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        listCustomers.mockResolvedValue([
            {
                record_id: "c1",
                fields: {
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
                    [CUSTOMER_FIELDS.SALES_OWNER]: "Sales A",
                    [CUSTOMER_FIELDS.HOT_LEAD]: true,
                },
            },
            {
                record_id: "c2",
                fields: {
                    [CUSTOMER_FIELDS.CURRENT_STAGE]: "Won",
                    [CUSTOMER_FIELDS.SALES_OWNER]: "Unassigned",
                    [CUSTOMER_FIELDS.HOT_LEAD]: false,
                },
            },
        ]);
        listPipelines.mockResolvedValue([
            {
                record_id: "p1",
                fields: {
                    [PIPELINE_FIELDS.STAGE]: "Closing",
                    [PIPELINE_FIELDS.STATUS]: "open",
                    [PIPELINE_FIELDS.SALES_OWNER]: "Sales A",
                },
            },
            {
                record_id: "p2",
                fields: {
                    [PIPELINE_FIELDS.STAGE]: "Won",
                    [PIPELINE_FIELDS.STATUS]: "won",
                    [PIPELINE_FIELDS.SALES_OWNER]: "Sales A",
                },
            },
            {
                record_id: "p3",
                fields: {
                    [PIPELINE_FIELDS.STAGE]: "Lost",
                    [PIPELINE_FIELDS.STATUS]: "lost",
                    [PIPELINE_FIELDS.SALES_OWNER]: "Sales B",
                },
            },
        ]);
        listOrders.mockResolvedValue([
            {
                record_id: "o1",
                fields: {
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 888,
                    [ORDER_FIELDS.SALES_OWNER]: "Sales A",
                },
            },
            {
                record_id: "o2",
                fields: {
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Overdue",
                    [ORDER_FIELDS.ORDER_STATUS]: "Waiting Payment",
                    [ORDER_FIELDS.TOTAL_AMOUNT]: 0,
                    [ORDER_FIELDS.SALES_OWNER]: "Sales B",
                },
            },
        ]);
    });

    it("calculates lead, close rate, revenue and sales performance", async () => {
        const result = await buildDashboardSummary(env);

        expect(result.leads.total).toBe(2);
        expect(result.leads.hot_leads).toBe(1);
        expect(result.leads.unassigned).toBe(1);
        expect(result.pipeline.close_rate_pct).toBe(50);
        expect(result.orders.revenue).toBe(888);
        expect(result.orders.overdue).toBe(1);
        expect(result.sales_performance).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sales_owner: "Sales A",
                    won_pipelines: 1,
                    revenue: 888,
                }),
            ])
        );
    });
});
