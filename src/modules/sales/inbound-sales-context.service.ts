import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import {
    normalizeOpenSalesStage,
    type OpenSalesStage,
} from "../../core/sales-stage";
import {
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
    getLinkedRecordIds,
} from "../../utils/lark-field-value";
import {
    updateCustomer,
    type LarkCustomerRecord,
} from "../customers/customer.repository";
import {
    findOpenOrdersByCustomer,
    getOrderByRecordId,
    getOrdersByRecordIds,
    type LarkOrderRecord,
} from "../orders/order.repository";
import {
    findOpenPipelinesByCustomer,
    getPipelineByRecordId,
    getPipelinesByRecordIds,
    type LarkPipelineRecord,
} from "../pipeline/pipeline.repository";

export type InboundSalesContext = {
    active_order_id: string;
    active_pipeline_id: string;
    has_active_order: boolean;
    has_open_pipeline: boolean;
    has_pending_payment: boolean;
    has_active_context: boolean;
    supports_closing_state: boolean;
    pipeline_stage: OpenSalesStage | null;
    pipeline_lead_score: number;
};

const TERMINAL_ORDER_STATUSES = new Set([
    "completed",
    "cancelled",
    "canceled",
    "returned",
    "refunded",
]);

function belongsToCustomer(
    linkedValue: unknown,
    customerRecordId: string
): boolean {
    return getLinkedRecordIds(linkedValue).includes(
        customerRecordId
    );
}

function isOpenPipelineForCustomer(
    pipeline: LarkPipelineRecord,
    customerRecordId: string
): boolean {
    return (
        getLarkText(
            pipeline.fields[PIPELINE_FIELDS.STATUS],
            ""
        )
            .trim()
            .toLowerCase() === "open" &&
        belongsToCustomer(
            pipeline.fields[PIPELINE_FIELDS.CUSTOMER],
            customerRecordId
        )
    );
}

function isActiveOrderForCustomer(
    order: LarkOrderRecord,
    customerRecordId: string
): boolean {
    const status = getLarkText(
        order.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    )
        .trim()
        .toLowerCase();

    return (
        !TERMINAL_ORDER_STATUSES.has(status) &&
        belongsToCustomer(
            order.fields[ORDER_FIELDS.CUSTOMER],
            customerRecordId
        )
    );
}

function assertSingleRecord(
    kind: "PIPELINE" | "ORDER",
    customerRecordId: string,
    records: Array<{ record_id: string }>
): void {
    if (records.length <= 1) {
        return;
    }

    throw new Error(
        `${kind}_INVARIANT_MULTIPLE_OPEN: customer=${customerRecordId}, ${kind.toLowerCase()}s=${records
            .map((record) => record.record_id)
            .join(",")}`
    );
}

async function resolveOpenPipeline(
    env: Env,
    customer: LarkCustomerRecord,
    cachedPipelineId: string
): Promise<LarkPipelineRecord | null> {
    if (cachedPipelineId) {
        const cachedPipeline = await getPipelineByRecordId(
            env,
            cachedPipelineId
        );

        if (
            cachedPipeline &&
            isOpenPipelineForCustomer(
                cachedPipeline,
                customer.record_id
            )
        ) {
            return cachedPipeline;
        }
    }

    const historyPipelineIds = getLinkedRecordIds(
        customer.fields[CUSTOMER_FIELDS.PIPELINES_HISTORY]
    );
    const historyPipelines = await getPipelinesByRecordIds(
        env,
        historyPipelineIds
    );
    const openHistoryPipelines = historyPipelines.filter(
        (pipeline) =>
            isOpenPipelineForCustomer(
                pipeline,
                customer.record_id
            )
    );

    assertSingleRecord(
        "PIPELINE",
        customer.record_id,
        openHistoryPipelines
    );

    if (openHistoryPipelines[0]) {
        return openHistoryPipelines[0];
    }

    /*
     * ไม่มีทั้ง cache และ relation history หมายถึงไม่มีหลักฐานให้กู้ pointer
     * จึงไม่ยิง table-wide search ทุกครั้งที่ลูกค้า Closing ส่งข้อความใหม่
     */
    if (!cachedPipelineId && historyPipelineIds.length === 0) {
        return null;
    }

    const openPipelines = (
        await findOpenPipelinesByCustomer(
            env,
            customer.record_id
        )
    ).filter((pipeline) =>
        isOpenPipelineForCustomer(
            pipeline,
            customer.record_id
        )
    );

    assertSingleRecord(
        "PIPELINE",
        customer.record_id,
        openPipelines
    );

    return openPipelines[0] ?? null;
}

async function resolveActiveOrder(
    env: Env,
    customer: LarkCustomerRecord,
    cachedOrderId: string
): Promise<LarkOrderRecord | null> {
    if (cachedOrderId) {
        const cachedOrder = await getOrderByRecordId(
            env,
            cachedOrderId
        );

        if (
            cachedOrder &&
            isActiveOrderForCustomer(
                cachedOrder,
                customer.record_id
            )
        ) {
            return cachedOrder;
        }
    }

    const historyOrderIds = getLinkedRecordIds(
        customer.fields[CUSTOMER_FIELDS.ORDERS_HISTORY]
    );
    const historyOrders = await getOrdersByRecordIds(
        env,
        historyOrderIds
    );
    const activeHistoryOrders = historyOrders.filter(
        (order) =>
            isActiveOrderForCustomer(
                order,
                customer.record_id
            )
    );

    assertSingleRecord(
        "ORDER",
        customer.record_id,
        activeHistoryOrders
    );

    if (activeHistoryOrders[0]) {
        return activeHistoryOrders[0];
    }

    if (!cachedOrderId && historyOrderIds.length === 0) {
        return null;
    }

    const openOrders = (
        await findOpenOrdersByCustomer(
            env,
            customer.record_id
        )
    ).filter((order) =>
        isActiveOrderForCustomer(
            order,
            customer.record_id
        )
    );

    assertSingleRecord(
        "ORDER",
        customer.record_id,
        openOrders
    );

    return openOrders[0] ?? null;
}

/**
 * ตรวจ Active Sales Context สำหรับข้อความแชท LINE เท่านั้น
 *
 * active_*_id เป็น text cache และอาจค้างหลัง Record ถูกปิด/ลบใน Lark ได้
 * ฟังก์ชันนี้จึงยืนยันกับ Record จริง ตรวจ ownership และกู้ pointer จาก
 * relation history/table search ก่อนตัดสินว่า Closing เดิมยังมีหลักฐานรองรับ
 */
export async function resolveLineInboundSalesContext(
    env: Env,
    customer: LarkCustomerRecord
): Promise<InboundSalesContext> {
    const cachedPipelineId = getLarkText(
        customer.fields[
            CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID
        ],
        ""
    ).trim();
    const cachedOrderId = getLarkText(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID],
        ""
    ).trim();

    const [pipeline, order] = await Promise.all([
        resolveOpenPipeline(
            env,
            customer,
            cachedPipelineId
        ),
        resolveActiveOrder(env, customer, cachedOrderId),
    ]);

    const activePipelineId = pipeline?.record_id ?? "";
    const activeOrderId = order?.record_id ?? "";

    if (
        activePipelineId !== cachedPipelineId ||
        activeOrderId !== cachedOrderId
    ) {
        await updateCustomer(
            env,
            customer.record_id,
            {
                active_pipeline_id: activePipelineId,
                active_order_id: activeOrderId,
            }
        );
    }

    const pipelineStage = pipeline
        ? normalizeOpenSalesStage(
              getLarkText(
                  pipeline.fields[PIPELINE_FIELDS.STAGE],
                  "New Lead"
              )
          )
        : null;
    const pipelineLeadScore = pipeline
        ? getLarkNumber(
              pipeline.fields[PIPELINE_FIELDS.LEAD_SCORE],
              0
          )
        : 0;
    const hasPendingPayment = getLarkBoolean(
        customer.fields[CUSTOMER_FIELDS.PENDING_PAYMENT],
        false
    );
    const hasActiveOrder = Boolean(order);
    const hasOpenPipeline = Boolean(pipeline);

    return {
        active_order_id: activeOrderId,
        active_pipeline_id: activePipelineId,
        has_active_order: hasActiveOrder,
        has_open_pipeline: hasOpenPipeline,
        has_pending_payment: hasPendingPayment,
        has_active_context:
            hasActiveOrder ||
            hasOpenPipeline ||
            hasPendingPayment,
        supports_closing_state:
            hasActiveOrder ||
            hasPendingPayment ||
            pipelineStage === "Closing",
        pipeline_stage: pipelineStage,
        pipeline_lead_score: pipelineLeadScore,
    };
}
