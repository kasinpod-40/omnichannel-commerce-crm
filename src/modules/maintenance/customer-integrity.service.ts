import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import {
    getCustomerByRecordId,
    updateCustomer,
    type LarkCustomerRecord,
} from "../customers/customer.repository";
import {
    findOpenPipelinesByCustomer,
    getPipelineByRecordId,
} from "../pipeline/pipeline.repository";
import {
    findOpenOrdersByCustomer,
    getOrderByRecordId,
} from "../orders/order.repository";
import {
    getLinkedRecordIds,
    getLarkText,
} from "../../utils/lark-field-value";

export type CustomerIntegrityIssue = {
    code: string;
    severity: "warning" | "error";
    message: string;
    record_ids?: string[];
};

export type CustomerIntegrityResult = {
    ok: boolean;
    customer_record_id: string;
    active_pipeline_id: string;
    active_order_id: string;
    open_pipeline_ids: string[];
    open_order_ids: string[];
    issues: CustomerIntegrityIssue[];
    repair_requested: boolean;
    repaired: boolean;
    repairs: Array<{
        field: "active_pipeline_id" | "active_order_id";
        old_value: string;
        new_value: string;
    }>;
    customer: LarkCustomerRecord;
};

function belongsToCustomer(
    linkedValue: unknown,
    customerRecordId: string
): boolean {
    return getLinkedRecordIds(linkedValue).includes(
        customerRecordId
    );
}

export async function auditAndRepairCustomerIntegrity(
    env: Env,
    customerRecordId: string,
    repair = false
): Promise<CustomerIntegrityResult> {
    const customer = await getCustomerByRecordId(
        env,
        customerRecordId
    );

    if (!customer) {
        throw new Error(
            `CUSTOMER_RECORD_NOT_FOUND: ${customerRecordId}`
        );
    }

    const activePipelineId = getLarkText(
        customer.fields[
            CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID
        ],
        ""
    ).trim();
    const activeOrderId = getLarkText(
        customer.fields[
            CUSTOMER_FIELDS.ACTIVE_ORDER_ID
        ],
        ""
    ).trim();

    const [openPipelines, openOrders, activePipeline, activeOrder] =
        await Promise.all([
            findOpenPipelinesByCustomer(
                env,
                customerRecordId
            ),
            findOpenOrdersByCustomer(
                env,
                customerRecordId
            ),
            activePipelineId
                ? getPipelineByRecordId(
                      env,
                      activePipelineId
                  )
                : Promise.resolve(null),
            activeOrderId
                ? getOrderByRecordId(
                      env,
                      activeOrderId
                  )
                : Promise.resolve(null),
        ]);

    const openPipelineIds = openPipelines.map(
        (record) => record.record_id
    );
    const openOrderIds = openOrders.map(
        (record) => record.record_id
    );
    const issues: CustomerIntegrityIssue[] = [];

    if (openPipelineIds.length > 1) {
        issues.push({
            code: "MULTIPLE_OPEN_PIPELINES",
            severity: "error",
            message:
                "Customer มี Open Pipeline มากกว่าหนึ่งรายการ ต้องให้ Admin เลือกรอบที่ถูกต้อง",
            record_ids: openPipelineIds,
        });
    }

    if (openOrderIds.length > 1) {
        issues.push({
            code: "MULTIPLE_OPEN_ORDERS",
            severity: "error",
            message:
                "Customer มี Open Order มากกว่าหนึ่งรายการ ต้องให้ Admin เลือกรายการที่ถูกต้อง",
            record_ids: openOrderIds,
        });
    }

    const activePipelineIsValid = Boolean(
        activePipeline &&
            getLarkText(
                activePipeline.fields[
                    PIPELINE_FIELDS.STATUS
                ],
                ""
            )
                .trim()
                .toLowerCase() === "open" &&
            belongsToCustomer(
                activePipeline.fields[
                    PIPELINE_FIELDS.CUSTOMER
                ],
                customerRecordId
            )
    );

    const activeOrderStatus = activeOrder
        ? getLarkText(
              activeOrder.fields[
                  ORDER_FIELDS.ORDER_STATUS
              ],
              ""
          )
              .trim()
              .toLowerCase()
        : "";
    const activeOrderIsValid = Boolean(
        activeOrder &&
            activeOrderStatus !== "completed" &&
            activeOrderStatus !== "cancelled" &&
            belongsToCustomer(
                activeOrder.fields[ORDER_FIELDS.CUSTOMER],
                customerRecordId
            )
    );

    if (activePipelineId && !activePipelineIsValid) {
        issues.push({
            code: "STALE_ACTIVE_PIPELINE_ID",
            severity: "warning",
            message:
                "active_pipeline_id ชี้ Record ที่ไม่มี ไม่ใช่ open หรือไม่ใช่ของ Customer คนนี้",
            record_ids: [activePipelineId],
        });
    }

    if (activeOrderId && !activeOrderIsValid) {
        issues.push({
            code: "STALE_ACTIVE_ORDER_ID",
            severity: "warning",
            message:
                "active_order_id ชี้ Record ที่ไม่มี ปิดแล้ว หรือไม่ใช่ของ Customer คนนี้",
            record_ids: [activeOrderId],
        });
    }

    if (
        openPipelineIds.length === 1 &&
        activePipelineId !== openPipelineIds[0]
    ) {
        issues.push({
            code: "ACTIVE_PIPELINE_POINTER_MISMATCH",
            severity: "warning",
            message:
                "มี Open Pipeline เพียงรายการเดียว แต่ active_pipeline_id ไม่ตรง",
            record_ids: openPipelineIds,
        });
    }

    if (
        openOrderIds.length === 1 &&
        activeOrderId !== openOrderIds[0]
    ) {
        issues.push({
            code: "ACTIVE_ORDER_POINTER_MISMATCH",
            severity: "warning",
            message:
                "มี Open Order เพียงรายการเดียว แต่ active_order_id ไม่ตรง",
            record_ids: openOrderIds,
        });
    }

    const repairs: CustomerIntegrityResult["repairs"] = [];
    const update: {
        active_pipeline_id?: string;
        active_order_id?: string;
    } = {};

    if (repair && openPipelineIds.length <= 1) {
        const desired = openPipelineIds[0] ?? "";

        if (activePipelineId !== desired) {
            update.active_pipeline_id = desired;
            repairs.push({
                field: "active_pipeline_id",
                old_value: activePipelineId,
                new_value: desired,
            });
        }
    }

    if (repair && openOrderIds.length <= 1) {
        const desired = openOrderIds[0] ?? "";

        if (activeOrderId !== desired) {
            update.active_order_id = desired;
            repairs.push({
                field: "active_order_id",
                old_value: activeOrderId,
                new_value: desired,
            });
        }
    }

    const repairedCustomer = repairs.length > 0
        ? await updateCustomer(
              env,
              customerRecordId,
              update
          )
        : customer;

    return {
        ok: issues.every(
            (issue) => issue.severity !== "error"
        ),
        customer_record_id: customerRecordId,
        active_pipeline_id:
            update.active_pipeline_id ?? activePipelineId,
        active_order_id:
            update.active_order_id ?? activeOrderId,
        open_pipeline_ids: openPipelineIds,
        open_order_ids: openOrderIds,
        issues,
        repair_requested: repair,
        repaired: repairs.length > 0,
        repairs,
        customer: repairedCustomer,
    };
}
