import { beforeEach, describe, expect, it, vi } from "vitest";
import { CUSTOMER_FIELDS, PIPELINE_FIELDS } from "../../core/lark-fields";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";

const { listCustomers, listPipelines } = vi.hoisted(() => ({
    listCustomers: vi.fn(),
    listPipelines: vi.fn(),
}));
vi.mock("../customers/customer.repository", () => ({ listCustomers }));
vi.mock("./pipeline.repository", () => ({ listPipelines }));

import { getPipelineDetail, getPipelineList } from "./pipeline-dashboard.service";

const env = {
    LARK_APP_TOKEN: "app",
    CUSTOMERS_TABLE_ID: "customers",
    PIPELINE_TABLE_ID: "pipelines",
} as any;

beforeEach(() => {
    vi.clearAllMocks();
    clearDashboardReadCache();
    listCustomers.mockResolvedValue([{
        record_id: "rec_customer_1",
        fields: {
            [CUSTOMER_FIELDS.CUSTOMER_NAME]: "คุณมินท์",
            [CUSTOMER_FIELDS.CHANNEL]: "LINE",
            [CUSTOMER_FIELDS.PHONE]: "0891234567",
            [CUSTOMER_FIELDS.SALES_OWNER]: "Sales A",
            [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "rec_order_1",
        },
    }]);
    listPipelines.mockResolvedValue([{
        record_id: "rec_pipeline_1",
        fields: {
            [PIPELINE_FIELDS.CUSTOMER]: ["rec_customer_1"],
            [PIPELINE_FIELDS.STATUS]: "open",
            [PIPELINE_FIELDS.STAGE]: "Closing",
            [PIPELINE_FIELDS.LEAD_SCORE]: 94,
            [PIPELINE_FIELDS.AI_SUMMARY]: "รอตรวจสลิป",
            [PIPELINE_FIELDS.CREATED_AT]: 1_780_000_000_000,
        },
    }]);
});

describe("pipeline dashboard service", () => {
    it("map Pipeline พร้อม Customer โดยไม่ยิง lookup ทีละ record", async () => {
        const result = await getPipelineList(env, { search: "", status: null });
        expect(result.items[0]).toMatchObject({
            pipeline_id: "rec_pipeline_1",
            status: "open",
            stage: "Closing",
            customer: {
                customer_id: "rec_customer_1",
                customer_name: "คุณมินท์",
                active_order_id: "rec_order_1",
            },
        });
        expect(listCustomers).toHaveBeenCalledTimes(1);
        expect(listPipelines).toHaveBeenCalledTimes(1);
    });

    it("คืน Detail จาก cache ชุดเดียวกับ List", async () => {
        await getPipelineList(env, { search: "", status: null });
        const detail = await getPipelineDetail(env, "rec_pipeline_1");
        expect(detail?.lead_score).toBe(94);
        expect(listPipelines).toHaveBeenCalledTimes(1);
    });
    it("uses the Pipeline-linked Order after Customer active pointers are cleared", async () => {
        listCustomers.mockResolvedValue([{
            record_id: "rec_customer_1",
            fields: {
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "คุณมินท์",
                [CUSTOMER_FIELDS.CHANNEL]: "LINE",
                [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "",
            },
        }]);
        listPipelines.mockResolvedValue([{
            record_id: "rec_pipeline_won",
            fields: {
                [PIPELINE_FIELDS.CUSTOMER]: ["rec_customer_1"],
                [PIPELINE_FIELDS.ORDER]: ["rec_order_closed"],
                [PIPELINE_FIELDS.STATUS]: "won",
                [PIPELINE_FIELDS.STAGE]: "Won",
                [PIPELINE_FIELDS.LEAD_SCORE]: 100,
                [PIPELINE_FIELDS.CREATED_AT]: 1_780_000_000_000,
            },
        }]);

        const result = await getPipelineList(env, {
            search: "",
            status: null,
        });

        expect(result.items[0]?.customer.active_order_id).toBe(
            "rec_order_closed"
        );
    });

});
