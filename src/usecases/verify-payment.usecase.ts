import type { Env } from "../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../core/lark-fields";
import {
    getCustomerByRecordId,
    updateCustomer,
    type LarkCustomerRecord,
} from "../modules/customers/customer.repository";
import {
    getOrderByRecordId,
    updateOrder,
    type LarkOrderRecord,
} from "../modules/orders/order.repository";
import {
    getPipelineByRecordId,
    updatePipeline,
    type LarkPipelineRecord,
} from "../modules/pipeline/pipeline.repository";
import {
    getFirstLinkedRecordId,
    getLarkBoolean,
    getLarkText,
} from "../utils/lark-field-value";

export type VerifyPaymentInput = {
    order_record_id: string;
};

export type VerifyPaymentResult =
    | {
        ok: true;
        already_verified: boolean;
        current_sale_closed: boolean;
        customer: LarkCustomerRecord;
        pipeline: LarkPipelineRecord;
        order: LarkOrderRecord;
    }
    | {
        ok: false;
        code:
        | "ORDER_RECORD_NOT_FOUND"
        | "ORDER_CUSTOMER_LINK_NOT_FOUND"
        | "ORDER_PIPELINE_LINK_NOT_FOUND"
        | "CUSTOMER_RECORD_NOT_FOUND"
        | "PIPELINE_RECORD_NOT_FOUND"
        | "PIPELINE_ALREADY_LOST"
        | "ORDER_ALREADY_CANCELLED";
        message: string;
    };

export async function verifyPayment(
    env: Env,
    input: VerifyPaymentInput
): Promise<VerifyPaymentResult> {
    const orderRecordId =
        input.order_record_id.trim();

    const order = await getOrderByRecordId(
        env,
        orderRecordId
    );

    if (!order) {
        return {
            ok: false,
            code: "ORDER_RECORD_NOT_FOUND",
            message: `ไม่พบ Order record: ${orderRecordId}`,
        };
    }

    const customerRecordId =
        getFirstLinkedRecordId(
            order.fields[ORDER_FIELDS.CUSTOMER]
        );

    if (!customerRecordId) {
        return {
            ok: false,
            code: "ORDER_CUSTOMER_LINK_NOT_FOUND",
            message:
                "Order ไม่มี Link ไปยัง Customer",
        };
    }

    const pipelineRecordId =
        getFirstLinkedRecordId(
            order.fields[ORDER_FIELDS.PIPELINE]
        );

    if (!pipelineRecordId) {
        return {
            ok: false,
            code: "ORDER_PIPELINE_LINK_NOT_FOUND",
            message:
                "Order ไม่มี Link ไปยัง Sales Pipeline",
        };
    }

    const customer = await getCustomerByRecordId(
        env,
        customerRecordId
    );

    if (!customer) {
        return {
            ok: false,
            code: "CUSTOMER_RECORD_NOT_FOUND",
            message: `ไม่พบ Customer record: ${customerRecordId}`,
        };
    }

    const pipeline = await getPipelineByRecordId(
        env,
        pipelineRecordId
    );

    if (!pipeline) {
        return {
            ok: false,
            code: "PIPELINE_RECORD_NOT_FOUND",
            message: `ไม่พบ Pipeline record: ${pipelineRecordId}`,
        };
    }

    const orderStatus = getLarkText(
        order.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    )
        .trim()
        .toLowerCase();

    const paymentStatus = getLarkText(
        order.fields[ORDER_FIELDS.PAYMENT_STATUS],
        ""
    )
        .trim()
        .toLowerCase();

    const paymentVerified = getLarkBoolean(
        order.fields[
        ORDER_FIELDS.PAYMENT_VERIFIED
        ],
        false
    );

    const pipelineStatus = getLarkText(
        pipeline.fields[PIPELINE_FIELDS.STATUS],
        ""
    )
        .trim()
        .toLowerCase();

    const pipelineStage = getLarkText(
        pipeline.fields[PIPELINE_FIELDS.STAGE],
        ""
    )
        .trim()
        .toLowerCase();

    if (orderStatus === "cancelled") {
        return {
            ok: false,
            code: "ORDER_ALREADY_CANCELLED",
            message:
                "ไม่สามารถยืนยันการชำระเงินได้ เพราะ Order ถูกยกเลิกแล้ว",
        };
    }

    if (pipelineStatus === "lost") {
        return {
            ok: false,
            code: "PIPELINE_ALREADY_LOST",
            message:
                "ไม่สามารถยืนยันการชำระเงินได้ เพราะ Pipeline เป็น Lost แล้ว",
        };
    }

    const alreadyVerified =
        paymentVerified &&
        paymentStatus === "paid" &&
        orderStatus === "completed" &&
        pipelineStatus === "won" &&
        pipelineStage === "won";

    if (alreadyVerified) {
        return {
            ok: true,
            already_verified: true,
            current_sale_closed: false,
            customer,
            pipeline,
            order,
        };
    }

    let verifiedOrder = order;

    if (
        !paymentVerified ||
        paymentStatus !== "paid" ||
        orderStatus !== "completed"
    ) {
        verifiedOrder = await updateOrder(
            env,
            orderRecordId,
            {
                payment_status: "Paid",
                payment_verified: true,
                order_status: "Completed",
            }
        );
    }

    let wonPipeline = pipeline;

    if (
        pipelineStatus !== "won" ||
        pipelineStage !== "won"
    ) {
        wonPipeline = await updatePipeline(
            env,
            pipelineRecordId,
            {
                stage: "Won",
                status: "won",
                lead_score: 100,
                ai_summary:
                    "Sales ยืนยันการชำระเงินแล้ว ปิดการขายสำเร็จ",
                closed_at: Date.now(),
            }
        );
    }

    const currentActiveOrderId = getLarkText(
        customer.fields[
        CUSTOMER_FIELDS.ACTIVE_ORDER_ID
        ],
        ""
    ).trim();

    const currentActivePipelineId = getLarkText(
        customer.fields[
        CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID
        ],
        ""
    ).trim();

    /*
     * ปิด Customer เฉพาะเมื่อ Active Pointer
     * ยังชี้มาที่ Order และ Pipeline ชุดนี้เท่านั้น
     *
     * ถ้าลูกค้ามีออเดอร์ใหม่แล้ว Callback เก่าถูกยิงซ้ำ
     * ห้ามล้าง Active Pointer ของออเดอร์ใหม่
     */
    const isCurrentSale =
        currentActiveOrderId === orderRecordId &&
        currentActivePipelineId ===
        pipelineRecordId;

    let updatedCustomer = customer;

    if (isCurrentSale) {
        updatedCustomer = await updateCustomer(
            env,
            customerRecordId,
            {
                current_stage: "Won",
                lead_score: 100,
                hot_lead: false,
                ai_summary:
                    "Sales ยืนยันการชำระเงินแล้ว ปิดการขายสำเร็จ",
                active_pipeline_id: "",
                active_order_id: "",
            }
        );
    }

    return {
        ok: true,
        already_verified: false,
        current_sale_closed: isCurrentSale,
        customer: updatedCustomer,
        pipeline: wonPipeline,
        order: verifiedOrder,
    };
}