import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import {
    getLarkText,
} from "../../utils/lark-field-value";
import { recordActivityOnce } from "../activities/activity.service";
import {
    getCustomerByRecordId,
    updateCustomer,
} from "../customers/customer.repository";
import {
    findOpenOrdersByCustomer,
    getOrderByRecordId,
    updateOrder,
    type LarkOrderRecord,
} from "../orders/order.repository";
import {
    findOpenPipelinesByCustomer,
    getPipelineByRecordId,
    updatePipeline,
    type LarkPipelineRecord,
} from "../pipeline/pipeline.repository";

export type AssignSalesOwnerInput = {
    customer_record_id: string;
    sales_owner: string;
    event_id?: string;
};

export type AssignSalesOwnerResult = {
    ok: true;
    customer_record_id: string;
    old_sales_owner: string;
    new_sales_owner: string;
    pipeline_record_id: string;
    order_record_id: string;
    customer_changed: boolean;
    pipeline_changed: boolean;
    order_changed: boolean;
};

function normalizeSalesOwner(value: string): string {
    return value.trim() || "Unassigned";
}

async function resolveOpenPipeline(
    env: Env,
    customerRecordId: string,
    cachedPipelineId: string
): Promise<LarkPipelineRecord | null> {
    if (cachedPipelineId) {
        const cached = await getPipelineByRecordId(
            env,
            cachedPipelineId
        );

        if (
            cached &&
            getLarkText(
                cached.fields[PIPELINE_FIELDS.STATUS],
                ""
            )
                .trim()
                .toLowerCase() === "open"
        ) {
            return cached;
        }
    }

    const open = await findOpenPipelinesByCustomer(
        env,
        customerRecordId
    );

    if (open.length > 1) {
        throw new Error(
            `PIPELINE_INVARIANT_MULTIPLE_OPEN: customer=${customerRecordId}, pipelines=${open
                .map((record) => record.record_id)
                .join(",")}`
        );
    }

    return open[0] ?? null;
}

async function resolveOpenOrder(
    env: Env,
    customerRecordId: string,
    cachedOrderId: string
): Promise<LarkOrderRecord | null> {
    if (cachedOrderId) {
        const cached = await getOrderByRecordId(
            env,
            cachedOrderId
        );

        if (cached) {
            const status = getLarkText(
                cached.fields[ORDER_FIELDS.ORDER_STATUS],
                ""
            )
                .trim()
                .toLowerCase();

            if (
                status !== "completed" &&
                status !== "cancelled"
            ) {
                return cached;
            }
        }
    }

    const open = await findOpenOrdersByCustomer(
        env,
        customerRecordId
    );

    if (open.length > 1) {
        throw new Error(
            `ORDER_INVARIANT_MULTIPLE_OPEN: customer=${customerRecordId}, orders=${open
                .map((record) => record.record_id)
                .join(",")}`
        );
    }

    return open[0] ?? null;
}

export async function assignSalesOwner(
    env: Env,
    input: AssignSalesOwnerInput
): Promise<AssignSalesOwnerResult> {
    const customerRecordId = input.customer_record_id.trim();

    if (!customerRecordId) {
        throw new Error("customer_record_id is required");
    }

    const customer = await getCustomerByRecordId(
        env,
        customerRecordId
    );

    if (!customer) {
        throw new Error(
            `CUSTOMER_RECORD_NOT_FOUND: ${customerRecordId}`
        );
    }

    const newSalesOwner = normalizeSalesOwner(
        input.sales_owner
    );
    const oldSalesOwner = normalizeSalesOwner(
        getLarkText(
            customer.fields[CUSTOMER_FIELDS.SALES_OWNER],
            "Unassigned"
        )
    );
    const cachedPipelineId = getLarkText(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID],
        ""
    ).trim();
    const cachedOrderId = getLarkText(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID],
        ""
    ).trim();

    const [pipeline, order] = await Promise.all([
        resolveOpenPipeline(
            env,
            customerRecordId,
            cachedPipelineId
        ),
        resolveOpenOrder(
            env,
            customerRecordId,
            cachedOrderId
        ),
    ]);

    const pipelineOwner = pipeline
        ? normalizeSalesOwner(
              getLarkText(
                  pipeline.fields[PIPELINE_FIELDS.SALES_OWNER],
                  "Unassigned"
              )
          )
        : "";
    const orderOwner = order
        ? normalizeSalesOwner(
              getLarkText(
                  order.fields[ORDER_FIELDS.SALES_OWNER],
                  "Unassigned"
              )
          )
        : "";

    const pipelineChanged = Boolean(
        pipeline && pipelineOwner !== newSalesOwner
    );
    const orderChanged = Boolean(
        order && orderOwner !== newSalesOwner
    );
    const customerChanged = oldSalesOwner !== newSalesOwner;

    // Update active business records first. Customer is the source of truth
    // and is updated last so a retry can safely converge after a partial fail.
    if (pipelineChanged && pipeline) {
        await updatePipeline(env, pipeline.record_id, {
            sales_owner: newSalesOwner,
        });
    }

    if (orderChanged && order) {
        await updateOrder(env, order.record_id, {
            sales_owner: newSalesOwner,
        });
    }

    if (
        customerChanged ||
        cachedPipelineId !== (pipeline?.record_id ?? "") ||
        cachedOrderId !== (order?.record_id ?? "")
    ) {
        await updateCustomer(env, customerRecordId, {
            sales_owner: newSalesOwner,
            active_pipeline_id: pipeline?.record_id ?? "",
            active_order_id: order?.record_id ?? "",
        });
    }

    if (customerChanged) {
        await recordActivityOnce(env, {
            event_id:
                input.event_id?.trim() ||
                `sales-assigned:${customerRecordId}:${oldSalesOwner}->${newSalesOwner}`,
            customer_record_id: customerRecordId,
            action: "SALES_ASSIGNED",
            old_value: oldSalesOwner,
            new_value: newSalesOwner,
        });
    }

    return {
        ok: true,
        customer_record_id: customerRecordId,
        old_sales_owner: oldSalesOwner,
        new_sales_owner: newSalesOwner,
        pipeline_record_id: pipeline?.record_id ?? "",
        order_record_id: order?.record_id ?? "",
        customer_changed: customerChanged,
        pipeline_changed: pipelineChanged,
        order_changed: orderChanged,
    };
}
