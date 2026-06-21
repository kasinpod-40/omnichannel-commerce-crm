import type { Env } from "../../config/env";
import { markCustomerLost } from "../customers/customer.service";
import type { LarkCustomerRecord } from "../customers/customer.repository";
import { cancelActiveOrder, type CancelOrderResult } from "../orders/order.service";
import {
    markActivePipelineLost,
    type MarkPipelineLostResult,
} from "../pipeline/pipeline.service";

export type LostSalePointerSnapshot = {
    active_pipeline_id?: string;
    active_order_id?: string;
};

export type FinalizeLostSaleResult = {
    pipeline: MarkPipelineLostResult | null;
    order: CancelOrderResult | null;
    customer: LarkCustomerRecord;
};

/**
 * Close child records before clearing Customer active pointers.
 *
 * The sequence is deliberately strict and retry-safe:
 * 1) Pipeline -> Lost
 * 2) Order -> Cancelled
 * 3) Customer -> Lost + clear active IDs
 *
 * If either expected child record cannot be resolved, the function throws and
 * Customer pointers remain intact for Queue retry / manual diagnosis.
 */
export async function finalizeLostSale(
    env: Env,
    customer: LarkCustomerRecord,
    pointers: LostSalePointerSnapshot = {}
): Promise<FinalizeLostSaleResult> {
    const pipeline = await markActivePipelineLost(
        env,
        customer,
        pointers.active_pipeline_id
    );

    if (pointers.active_pipeline_id && !pipeline) {
        throw new Error(
            `LOST_PIPELINE_NOT_FOUND: customer=${customer.record_id}, pipeline=${pointers.active_pipeline_id}`
        );
    }

    const order = await cancelActiveOrder(
        env,
        customer,
        pointers.active_order_id
    );

    if (pointers.active_order_id && !order) {
        throw new Error(
            `LOST_ORDER_NOT_FOUND: customer=${customer.record_id}, order=${pointers.active_order_id}`
        );
    }

    const lostCustomer = await markCustomerLost(
        env,
        customer
    );

    return {
        pipeline,
        order,
        customer: lostCustomer,
    };
}
