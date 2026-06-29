import { describe, expect, it } from "vitest";
import { CUSTOMER_FIELDS, PIPELINE_FIELDS } from "../../core/lark-fields";
import type { LarkPipelineRecord } from "../pipeline/pipeline.repository";
import type { LarkCustomerRecord } from "./customer.repository";
import { classifyCustomerWorkQueue } from "./customer-work-queue";

const customer: LarkCustomerRecord = {
    record_id: "rec-customer",
    fields: {
        [CUSTOMER_FIELDS.CURRENT_STAGE]: "Closing",
        [CUSTOMER_FIELDS.HOT_LEAD]: true,
        [CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]: "rec-pipeline",
    },
};
const pipeline: LarkPipelineRecord = {
    record_id: "rec-pipeline",
    fields: {
        [PIPELINE_FIELDS.CUSTOMER]: [{ record_id: "rec-customer" }],
        [PIPELINE_FIELDS.STATUS]: "open",
        [PIPELINE_FIELDS.STAGE]: "Closing",
    },
};

describe("classifyCustomerWorkQueue", () => {
    it("requires a real linked open pipeline", () => {
        expect(classifyCustomerWorkQueue(customer, [pipeline])).toBe("hot_lead");
        expect(classifyCustomerWorkQueue(customer, [])).toBe("none");
    });

    it("excludes won and lost stale hot leads", () => {
        expect(classifyCustomerWorkQueue({
            ...customer,
            fields: { ...customer.fields, [CUSTOMER_FIELDS.CURRENT_STAGE]: "Won" },
        }, [pipeline])).toBe("none");
    });
});
