import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
} from "../../core/lark-fields";
import {
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import {
    updateCustomer,
    type LarkCustomerRecord,
} from "../customers/customer.repository";
import type { Channel } from "../customers/customer.types";
import type { LarkPipelineRecord } from "../pipeline/pipeline.repository";
import {
    createOrder,
    getOrderByRecordId,
    updateOrder,
    type LarkOrderRecord,
} from "./order.repository";

function generateOrderNumber(): string {
    const now = new Date();

    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");

    const random =
        Math.floor(Math.random() * 9000) + 1000;

    return `ORD-${yyyy}${mm}${dd}-${random}`;
}

function getCustomerChannel(
    customer: LarkCustomerRecord
): Channel {
    const channel = getLarkText(
        customer.fields[CUSTOMER_FIELDS.CHANNEL],
        "LINE"
    );

    if (
        channel === "LINE" ||
        channel === "Shopee" ||
        channel === "Lazada" ||
        channel === "TikTok"
    ) {
        return channel;
    }

    return "LINE";
}

function isAddQuantityMessage(
    message?: string
): boolean {
    if (!message) {
        return false;
    }

    const normalized = message
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    return /(?:เพิ่ม|อีก)\s*\d+/.test(normalized);
}

function isClosedOrder(
    order: LarkOrderRecord
): boolean {
    const status = getLarkText(
        order.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    ).toLowerCase();

    return (
        status === "completed" ||
        status === "cancelled"
    );
}

async function updateExistingOrderQuantity(
    env: Env,
    order: LarkOrderRecord,
    input: {
        quantity?: number;
        message?: string;
    }
): Promise<LarkOrderRecord> {
    if (
        input.quantity === undefined ||
        input.quantity <= 0
    ) {
        return order;
    }

    const currentQuantity = getLarkNumber(
        order.fields[ORDER_FIELDS.QUANTITY],
        0
    );

    const shouldAdd = isAddQuantityMessage(
        input.message
    );

    const nextQuantity = shouldAdd
        ? currentQuantity + input.quantity
        : input.quantity;

    if (nextQuantity === currentQuantity) {
        return order;
    }

    return await updateOrder(
        env,
        order.record_id,
        {
            quantity: nextQuantity,
        }
    );
}

export async function createTestOrderForCustomer(
    env: Env,
    input: {
        customer_record_id: string;
        pipeline_record_id?: string;
    }
): Promise<LarkOrderRecord> {
    return await createOrder(env, {
        order_number: generateOrderNumber(),
        customer_record_id: input.customer_record_id,
        pipeline_record_id: input.pipeline_record_id,
        channel: "LINE",
        external_order_id: "",
        customer_name: "LINE Test User",
        phone: "0800000000",
        address: "Test Address",
        product_name: "Test Product",
        quantity: 1,
        total_amount: 999,
        payment_status: "Waiting Payment",
        payment_verified: false,
        order_status: "Waiting Payment",
        sales_owner: "Unassigned",
    });
}

export async function createOrderIfReadyToBuy(
    env: Env,
    customer: LarkCustomerRecord,
    pipeline: LarkPipelineRecord | null,
    input: {
        product_name?: string;
        quantity?: number;
        total_amount?: number;
        message?: string;
    }
): Promise<LarkOrderRecord | null> {
    const activeOrderId = getLarkText(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID],
        ""
    ).trim();

    if (activeOrderId) {
        const existingOrder = await getOrderByRecordId(
            env,
            activeOrderId
        );

        if (
            existingOrder &&
            !isClosedOrder(existingOrder)
        ) {
            return await updateExistingOrderQuantity(
                env,
                existingOrder,
                {
                    quantity: input.quantity,
                    message: input.message,
                }
            );
        }
    }

    const customerName = getLarkText(
        customer.fields[CUSTOMER_FIELDS.CUSTOMER_NAME],
        "Unknown Customer"
    );

    const phone = getLarkText(
        customer.fields[CUSTOMER_FIELDS.PHONE],
        ""
    );

    const channel = getCustomerChannel(customer);

    const order = await createOrder(env, {
        order_number: generateOrderNumber(),
        customer_record_id: customer.record_id,
        pipeline_record_id: pipeline?.record_id,
        channel,
        external_order_id: "",
        customer_name: customerName,
        phone,
        address: "",
        product_name:
            input.product_name ??
            input.message ??
            "สินค้าในแชท",
        quantity: input.quantity ?? 1,
        total_amount: input.total_amount ?? 0,
        payment_status: "Waiting Payment",
        payment_verified: false,
        order_status: "Waiting Payment",
        sales_owner: "Unassigned",
    });

    await updateCustomer(
        env,
        customer.record_id,
        {
            active_order_id: order.record_id,
        }
    );

    return order;
}

export async function updateActiveOrderAddress(
    env: Env,
    customer: LarkCustomerRecord,
    address: string
): Promise<LarkOrderRecord | null> {
    const activeOrderId = getLarkText(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID],
        ""
    ).trim();

    if (!activeOrderId) {
        return null;
    }

    const existingOrder = await getOrderByRecordId(
        env,
        activeOrderId
    );

    if (
        !existingOrder ||
        isClosedOrder(existingOrder)
    ) {
        return null;
    }

    const normalizedAddress = address.trim();

    if (!normalizedAddress) {
        return existingOrder;
    }

    return await updateOrder(
        env,
        activeOrderId,
        {
            address: normalizedAddress,
        }
    );
}

export async function markActiveOrderPaymentReview(
    env: Env,
    customer: LarkCustomerRecord
): Promise<LarkOrderRecord | null> {
    const activeOrderId = getLarkText(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID],
        ""
    ).trim();

    if (!activeOrderId) {
        return null;
    }

    const existingOrder = await getOrderByRecordId(
        env,
        activeOrderId
    );

    if (
        !existingOrder ||
        isClosedOrder(existingOrder)
    ) {
        return null;
    }

    return await updateOrder(
        env,
        activeOrderId,
        {
            payment_status: "Waiting Payment",
            payment_verified: false,
            order_status: "Payment Review",
        }
    );
}

export async function cancelActiveOrder(
    env: Env,
    customer: LarkCustomerRecord
): Promise<LarkOrderRecord | null> {
    const activeOrderId = getLarkText(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID],
        ""
    ).trim();

    if (!activeOrderId) {
        return null;
    }

    return await updateOrder(
        env,
        activeOrderId,
        {
            order_status: "Cancelled",
        }
    );
}