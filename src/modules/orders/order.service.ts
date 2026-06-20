import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
} from "../../core/lark-fields";
import {
    getLarkBoolean,
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

export type EnsureOrderResult = {
    record: LarkOrderRecord;
    created: boolean;
    quantity_changed: boolean;
    old_quantity: number | null;
    new_quantity: number | null;
};

export type AddressUpdateResult = {
    record: LarkOrderRecord;
    changed: boolean;
    old_address: string;
    new_address: string;
};

export type PaymentReviewResult = {
    record: LarkOrderRecord;
    changed: boolean;
    old_payment_status: string;
    new_payment_status: string;
    old_order_status: string;
    new_order_status: string;
    old_payment_verified: boolean;
    new_payment_verified: boolean;
};

export type CancelOrderResult = {
    record: LarkOrderRecord;
    changed: boolean;
    old_order_status: string;
    new_order_status: string;
    payment_status: string;
    payment_verified: boolean;
};

type QuantityUpdateResult = {
    record: LarkOrderRecord;
    changed: boolean;
    old_quantity: number;
    new_quantity: number;
};

function generateOrderNumber(): string {
    const now = new Date();

    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const random = Math.floor(Math.random() * 9000) + 1000;

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
    )
        .trim()
        .toLowerCase();

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
): Promise<QuantityUpdateResult> {
    const currentQuantity = getLarkNumber(
        order.fields[ORDER_FIELDS.QUANTITY],
        0
    );

    if (
        input.quantity === undefined ||
        input.quantity <= 0
    ) {
        return {
            record: order,
            changed: false,
            old_quantity: currentQuantity,
            new_quantity: currentQuantity,
        };
    }

    const shouldAdd = isAddQuantityMessage(
        input.message
    );

    const nextQuantity = shouldAdd
        ? currentQuantity + input.quantity
        : input.quantity;

    if (nextQuantity === currentQuantity) {
        return {
            record: order,
            changed: false,
            old_quantity: currentQuantity,
            new_quantity: currentQuantity,
        };
    }

    const updatedOrder = await updateOrder(
        env,
        order.record_id,
        {
            quantity: nextQuantity,
        }
    );

    return {
        record: updatedOrder,
        changed: true,
        old_quantity: currentQuantity,
        new_quantity: nextQuantity,
    };
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
        customer_record_id:
            input.customer_record_id,
        pipeline_record_id:
            input.pipeline_record_id,
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
): Promise<EnsureOrderResult | null> {
    const activeOrderId = getLarkText(
        customer.fields[
        CUSTOMER_FIELDS.ACTIVE_ORDER_ID
        ],
        ""
    ).trim();

    if (activeOrderId) {
        const existingOrder =
            await getOrderByRecordId(
                env,
                activeOrderId
            );

        if (
            existingOrder &&
            !isClosedOrder(existingOrder)
        ) {
            const quantityResult =
                await updateExistingOrderQuantity(
                    env,
                    existingOrder,
                    {
                        quantity: input.quantity,
                        message: input.message,
                    }
                );

            return {
                record: quantityResult.record,
                created: false,
                quantity_changed:
                    quantityResult.changed,
                old_quantity:
                    quantityResult.old_quantity,
                new_quantity:
                    quantityResult.new_quantity,
            };
        }
    }

    const customerName = getLarkText(
        customer.fields[
        CUSTOMER_FIELDS.CUSTOMER_NAME
        ],
        "Unknown Customer"
    );

    const phone = getLarkText(
        customer.fields[CUSTOMER_FIELDS.PHONE],
        ""
    );

    const channel = getCustomerChannel(customer);
    const quantity = input.quantity ?? 1;

    const order = await createOrder(env, {
        order_number: generateOrderNumber(),
        customer_record_id:
            customer.record_id,
        pipeline_record_id:
            pipeline?.record_id,
        channel,
        external_order_id: "",
        customer_name: customerName,
        phone,
        address: "",
        product_name:
            input.product_name ??
            input.message ??
            "สินค้าในแชท",
        quantity,
        total_amount:
            input.total_amount ?? 0,
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

    return {
        record: order,
        created: true,
        quantity_changed: false,
        old_quantity: null,
        new_quantity: quantity,
    };
}

export async function updateActiveOrderAddress(
    env: Env,
    customer: LarkCustomerRecord,
    address: string
): Promise<AddressUpdateResult | null> {
    const activeOrderId = getLarkText(
        customer.fields[
        CUSTOMER_FIELDS.ACTIVE_ORDER_ID
        ],
        ""
    ).trim();

    if (!activeOrderId) {
        return null;
    }

    const existingOrder =
        await getOrderByRecordId(
            env,
            activeOrderId
        );

    if (
        !existingOrder ||
        isClosedOrder(existingOrder)
    ) {
        return null;
    }

    const oldAddress = getLarkText(
        existingOrder.fields[ORDER_FIELDS.ADDRESS],
        ""
    ).trim();

    const newAddress = address
        .trim()
        .replace(/\s+/g, " ");

    if (!newAddress) {
        return {
            record: existingOrder,
            changed: false,
            old_address: oldAddress,
            new_address: oldAddress,
        };
    }

    if (oldAddress === newAddress) {
        return {
            record: existingOrder,
            changed: false,
            old_address: oldAddress,
            new_address: newAddress,
        };
    }

    const updatedOrder = await updateOrder(
        env,
        activeOrderId,
        {
            address: newAddress,
        }
    );

    return {
        record: updatedOrder,
        changed: true,
        old_address: oldAddress,
        new_address: newAddress,
    };
}

export async function markActiveOrderPaymentReview(
    env: Env,
    customer: LarkCustomerRecord
): Promise<PaymentReviewResult | null> {
    const activeOrderId = getLarkText(
        customer.fields[
        CUSTOMER_FIELDS.ACTIVE_ORDER_ID
        ],
        ""
    ).trim();

    if (!activeOrderId) {
        return null;
    }

    const existingOrder =
        await getOrderByRecordId(
            env,
            activeOrderId
        );

    if (
        !existingOrder ||
        isClosedOrder(existingOrder)
    ) {
        return null;
    }

    const oldPaymentStatus = getLarkText(
        existingOrder.fields[
        ORDER_FIELDS.PAYMENT_STATUS
        ],
        ""
    ).trim();

    const oldOrderStatus = getLarkText(
        existingOrder.fields[
        ORDER_FIELDS.ORDER_STATUS
        ],
        ""
    ).trim();

    const oldPaymentVerified =
        getLarkBoolean(
            existingOrder.fields[
            ORDER_FIELDS.PAYMENT_VERIFIED
            ],
            false
        );

    const newPaymentStatus =
        "Waiting Payment";

    const newOrderStatus =
        "Payment Review";

    const newPaymentVerified = false;

    const changed =
        oldPaymentStatus !== newPaymentStatus ||
        oldOrderStatus !== newOrderStatus ||
        oldPaymentVerified !==
        newPaymentVerified;

    if (!changed) {
        return {
            record: existingOrder,
            changed: false,
            old_payment_status:
                oldPaymentStatus,
            new_payment_status:
                newPaymentStatus,
            old_order_status:
                oldOrderStatus,
            new_order_status:
                newOrderStatus,
            old_payment_verified:
                oldPaymentVerified,
            new_payment_verified:
                newPaymentVerified,
        };
    }

    const updatedOrder = await updateOrder(
        env,
        activeOrderId,
        {
            payment_status:
                newPaymentStatus,
            payment_verified:
                newPaymentVerified,
            order_status:
                newOrderStatus,
        }
    );

    return {
        record: updatedOrder,
        changed: true,
        old_payment_status:
            oldPaymentStatus,
        new_payment_status:
            newPaymentStatus,
        old_order_status:
            oldOrderStatus,
        new_order_status:
            newOrderStatus,
        old_payment_verified:
            oldPaymentVerified,
        new_payment_verified:
            newPaymentVerified,
    };
}

export async function cancelActiveOrder(
    env: Env,
    customer: LarkCustomerRecord
): Promise<CancelOrderResult | null> {
    const activeOrderId = getLarkText(
        customer.fields[
            CUSTOMER_FIELDS.ACTIVE_ORDER_ID
        ],
        ""
    ).trim();

    if (!activeOrderId) {
        return null;
    }

    const existingOrder =
        await getOrderByRecordId(
            env,
            activeOrderId
        );

    if (!existingOrder) {
        return null;
    }

    const oldOrderStatus = getLarkText(
        existingOrder.fields[
            ORDER_FIELDS.ORDER_STATUS
        ],
        ""
    ).trim();

    const paymentStatus = getLarkText(
        existingOrder.fields[
            ORDER_FIELDS.PAYMENT_STATUS
        ],
        ""
    ).trim();

    const paymentVerified = getLarkBoolean(
        existingOrder.fields[
            ORDER_FIELDS.PAYMENT_VERIFIED
        ],
        false
    );

    const normalizedOrderStatus =
        oldOrderStatus.toLowerCase();

    if (
        normalizedOrderStatus === "cancelled" ||
        normalizedOrderStatus === "completed"
    ) {
        return {
            record: existingOrder,
            changed: false,
            old_order_status: oldOrderStatus,
            new_order_status: oldOrderStatus,
            payment_status: paymentStatus,
            payment_verified: paymentVerified,
        };
    }

    const newOrderStatus = "Cancelled";

    const cancelledOrder = await updateOrder(
        env,
        activeOrderId,
        {
            order_status: newOrderStatus,
        }
    );

    return {
        record: cancelledOrder,
        changed: true,
        old_order_status: oldOrderStatus,
        new_order_status: newOrderStatus,
        payment_status: paymentStatus,
        payment_verified: paymentVerified,
    };
}
