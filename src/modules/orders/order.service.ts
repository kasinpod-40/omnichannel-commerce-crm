import type { QuantityAction } from "../../ai/ai.types";
import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
} from "../../core/lark-fields";
import {
    getFirstLinkedRecordId,
    getLinkedRecordIds,
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { normalizePhoneNumber } from "../../utils/phone";
import {
    updateCustomer,
    type LarkCustomerRecord,
} from "../customers/customer.repository";
import type { Channel } from "../customers/customer.types";
import type { LarkPipelineRecord } from "../pipeline/pipeline.repository";
import {
    createOrder,
    findOpenOrdersByCustomer,
    getOrderByRecordId,
    getOrdersByRecordIds,
    updateOrder,
    type LarkOrderRecord,
} from "./order.repository";

export type OrderQualificationReason =
    | "product_order"
    | "delivery_address"
    | "payment_slip";

export type OrderStateSnapshot = {
    pipeline_record_id: string;
    customer_name: string;
    phone: string;
    address: string;
    product_name: string;
    product_unit: string;
    quantity: number;
    total_amount: number;
    sales_owner: string;
};

export type EnsureOrderResult = {
    record: LarkOrderRecord;
    created: boolean;
    changed: boolean;
    qualification_reason: OrderQualificationReason;
    old_state: OrderStateSnapshot | null;
    new_state: OrderStateSnapshot;
};

export type AddressUpdateResult = {
    record: LarkOrderRecord;
    changed: boolean;
    old_address: string;
    new_address: string;
};

export type PhoneUpdateResult = {
    record: LarkOrderRecord;
    changed: boolean;
    old_phone: string;
    new_phone: string;
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

const UNKNOWN_PRODUCT_NAME = "ยังไม่ระบุสินค้า";

function generateOrderNumber(): string {
    const now = new Date();

    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const suffix = crypto
        .randomUUID()
        .replace(/-/g, "")
        .slice(0, 6)
        .toUpperCase();

    return `ORD-${yyyy}${mm}${dd}-${hh}${mi}${ss}-${suffix}`;
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

function normalizeText(value: string | undefined): string {
    return (value ?? "").trim().replace(/\s+/g, " ");
}

function isMeaningfulProductName(value: string): boolean {
    const normalized = normalizeText(value).toLowerCase();

    if (!normalized) {
        return false;
    }

    return ![
        UNKNOWN_PRODUCT_NAME,
        "สินค้าในแชท",
        "สินค้า",
        "ตัวนี้",
        "อันนี้",
        "ชิ้นนี้",
        "สินค้านี้",
        "รุ่นนี้",
        "แบบนี้",
    ].includes(normalized);
}

function resolveQuantityAction(
    quantityAction: QuantityAction | undefined,
    message?: string
): QuantityAction {
    if (quantityAction) {
        return quantityAction;
    }

    if (!message) {
        return "set";
    }

    const normalized = message
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");

    if (/(?:เพิ่ม|อีก)\s*\d+/.test(normalized)) {
        return "add";
    }

    return "set";
}

function isClosedOrder(order: LarkOrderRecord): boolean {
    const status = getLarkText(
        order.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    )
        .trim()
        .toLowerCase();

    return status === "completed" || status === "cancelled";
}

function getOrderState(order: LarkOrderRecord): OrderStateSnapshot {
    return {
        pipeline_record_id:
            getFirstLinkedRecordId(
                order.fields[ORDER_FIELDS.PIPELINE]
            ) ?? "",
        customer_name: getLarkText(
            order.fields[ORDER_FIELDS.CUSTOMER_NAME],
            ""
        ),
        phone: getLarkText(
            order.fields[ORDER_FIELDS.PHONE],
            ""
        ),
        address: getLarkText(
            order.fields[ORDER_FIELDS.ADDRESS],
            ""
        ),
        product_name: getLarkText(
            order.fields[ORDER_FIELDS.PRODUCT_NAME],
            ""
        ),
        product_unit: getLarkText(
            order.fields[ORDER_FIELDS.PRODUCT_UNIT],
            ""
        ),
        quantity: getLarkNumber(
            order.fields[ORDER_FIELDS.QUANTITY],
            0
        ),
        total_amount: getLarkNumber(
            order.fields[ORDER_FIELDS.TOTAL_AMOUNT],
            0
        ),
        sales_owner: getLarkText(
            order.fields[ORDER_FIELDS.SALES_OWNER],
            "Unassigned"
        ),
    };
}

function resolveOrderInput(
    customer: LarkCustomerRecord,
    pipeline: LarkPipelineRecord | null,
    input: {
        product_name?: string;
        product_unit?: string;
        quantity?: number;
        quantity_action?: QuantityAction;
        total_amount?: number;
        address?: string;
        message?: string;
        qualification_reason: OrderQualificationReason;
        allow_customer_sales_context_fallback?: boolean;
    }
): OrderStateSnapshot {
    const allowCustomerSalesContextFallback =
        input.allow_customer_sales_context_fallback !== false;

    const storedProductName = allowCustomerSalesContextFallback
        ? getLarkText(
              customer.fields[CUSTOMER_FIELDS.PRODUCT_NAME],
              ""
          )
        : "";

    const storedProductUnit = allowCustomerSalesContextFallback
        ? getLarkText(
              customer.fields[CUSTOMER_FIELDS.PRODUCT_UNIT],
              ""
          )
        : "";

    const storedQuantity = allowCustomerSalesContextFallback
        ? getLarkNumber(
              customer.fields[CUSTOMER_FIELDS.PRODUCT_QTY],
              0
          )
        : 0;

    const customerName = getLarkText(
        customer.fields[CUSTOMER_FIELDS.CUSTOMER_NAME],
        "Unknown Customer"
    );

    const phone =
        normalizePhoneNumber(
            getLarkText(
                customer.fields[CUSTOMER_FIELDS.PHONE],
                ""
            )
        ) ?? "";

    const salesOwner = getLarkText(
        customer.fields[CUSTOMER_FIELDS.SALES_OWNER],
        "Unassigned"
    );

    const resolvedProductName = normalizeText(
        input.product_name
    ) || normalizeText(storedProductName);

    const resolvedProductUnit = normalizeText(
        input.product_unit
    ) || normalizeText(storedProductUnit);

    const resolvedQuantity =
        input.quantity !== undefined && input.quantity > 0
            ? input.quantity
            : storedQuantity;

    return {
        pipeline_record_id: pipeline?.record_id ?? "",
        customer_name: customerName,
        phone,
        address: normalizeText(input.address),
        product_name:
            resolvedProductName || UNKNOWN_PRODUCT_NAME,
        product_unit: resolvedProductUnit,
        quantity: Math.max(0, resolvedQuantity),
        total_amount: Math.max(0, input.total_amount ?? 0),
        sales_owner: salesOwner || "Unassigned",
    };
}

function isQualifiedProductOrder(
    state: OrderStateSnapshot
): boolean {
    return (
        isMeaningfulProductName(state.product_name) &&
        state.quantity > 0
    );
}

function shouldCreateOrder(
    reason: OrderQualificationReason,
    state: OrderStateSnapshot
): boolean {
    if (reason === "product_order") {
        return isQualifiedProductOrder(state);
    }

    if (reason === "payment_slip") {
        /*
         * ถ้ารู้ชื่อสินค้าแล้ว ให้สร้าง Order shell ได้แม้จำนวนยังเป็น 0
         * เพื่อให้ Sales เห็นสลิปใน Order Center และเติมจำนวนภายหลัง
         * แต่ถ้ายังไม่รู้สินค้าเลย ให้พักสลิปไว้ที่ Customer ก่อน
         */
        return isMeaningfulProductName(state.product_name);
    }

    // ที่อยู่เป็นหลักฐานว่ากำลังเกิดคำสั่งซื้อจริง
    // จึงอนุญาตให้สร้าง Order shell แล้วเติมสินค้าในภายหลัง
    return true;
}

function statesEqual(
    left: OrderStateSnapshot,
    right: OrderStateSnapshot
): boolean {
    return (
        left.pipeline_record_id === right.pipeline_record_id &&
        left.customer_name === right.customer_name &&
        left.phone === right.phone &&
        left.address === right.address &&
        left.product_name === right.product_name &&
        left.product_unit === right.product_unit &&
        left.quantity === right.quantity &&
        left.total_amount === right.total_amount &&
        left.sales_owner === right.sales_owner
    );
}

function buildNextExistingOrderState(
    existing: OrderStateSnapshot,
    resolved: OrderStateSnapshot,
    input: {
        quantity?: number;
        quantity_action?: QuantityAction;
        message?: string;
        address?: string;
    }
): OrderStateSnapshot {
    let nextQuantity = existing.quantity;

    if (input.quantity !== undefined && input.quantity > 0) {
        const quantityAction = resolveQuantityAction(
            input.quantity_action,
            input.message
        );

        if (quantityAction === "add") {
            nextQuantity = existing.quantity + input.quantity;
        } else if (quantityAction === "subtract") {
            // Order ที่ยัง Active ต้องมีอย่างน้อย 1 ชิ้น
            // หากต้องการยกเลิกทั้งหมด ให้ใช้ Lost/Cancel Flow
            nextQuantity = Math.max(
                1,
                existing.quantity - input.quantity
            );
        } else {
            nextQuantity = input.quantity;
        }
    } else if (existing.quantity <= 0 && resolved.quantity > 0) {
        nextQuantity = resolved.quantity;
    }

    const nextProductName = isMeaningfulProductName(
        resolved.product_name
    )
        ? resolved.product_name
        : existing.product_name;

    const nextAddress = normalizeText(input.address)
        ? normalizeText(input.address)
        : existing.address;

    return {
        pipeline_record_id:
            resolved.pipeline_record_id ||
            existing.pipeline_record_id,
        customer_name:
            resolved.customer_name || existing.customer_name,
        phone: resolved.phone || existing.phone,
        address: nextAddress,
        product_name:
            nextProductName || UNKNOWN_PRODUCT_NAME,
        product_unit:
            resolved.product_unit || existing.product_unit,
        quantity: nextQuantity,
        total_amount:
            resolved.total_amount > 0
                ? resolved.total_amount
                : existing.total_amount,
        sales_owner:
            resolved.sales_owner || existing.sales_owner,
    };
}

async function updateExistingQualifiedOrder(
    env: Env,
    customer: LarkCustomerRecord,
    order: LarkOrderRecord,
    resolved: OrderStateSnapshot,
    input: {
        quantity?: number;
        quantity_action?: QuantityAction;
        message?: string;
        address?: string;
    },
    reason: OrderQualificationReason
): Promise<EnsureOrderResult> {
    const oldState = getOrderState(order);
    const newState = buildNextExistingOrderState(
        oldState,
        resolved,
        input
    );

    if (statesEqual(oldState, newState)) {
        return {
            record: order,
            created: false,
            changed: false,
            qualification_reason: reason,
            old_state: oldState,
            new_state: newState,
        };
    }

    const updatedOrder = await updateOrder(
        env,
        order.record_id,
        {
            pipeline_record_id:
                newState.pipeline_record_id,
            customer_name: newState.customer_name,
            phone: newState.phone,
            address: newState.address,
            product_name: newState.product_name,
            product_unit: newState.product_unit,
            quantity: newState.quantity,
            total_amount: newState.total_amount,
            sales_owner: newState.sales_owner,
        }
    );

    await updateCustomer(env, customer.record_id, {
        product_name: newState.product_name,
        product_qty: newState.quantity,
        product_unit: newState.product_unit,
    });

    return {
        record: updatedOrder,
        created: false,
        changed: true,
        qualification_reason: reason,
        old_state: oldState,
        new_state: newState,
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
        customer_record_id: input.customer_record_id,
        pipeline_record_id: input.pipeline_record_id,
        channel: "LINE",
        external_order_id: "",
        customer_name: "LINE Test User",
        phone: "0800000000",
        address: "Test Address",
        product_name: "Test Product",
        product_unit: "ชิ้น",
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
        qualification_reason: OrderQualificationReason;
        product_name?: string;
        product_unit?: string;
        quantity?: number;
        quantity_action?: QuantityAction;
        total_amount?: number;
        address?: string;
        message?: string;
        allow_customer_sales_context_fallback?: boolean;
    }
): Promise<EnsureOrderResult | null> {
    const resolved = resolveOrderInput(
        customer,
        pipeline,
        input
    );

    const activeOrderId = getLarkText(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID],
        ""
    ).trim();

    if (activeOrderId) {
        const existingOrder = await getOrderByRecordId(
            env,
            activeOrderId
        );

        if (existingOrder && !isClosedOrder(existingOrder)) {
            return await updateExistingQualifiedOrder(
                env,
                customer,
                existingOrder,
                resolved,
                {
                    quantity: input.quantity,
                    quantity_action:
                        input.quantity_action,
                    message: input.message,
                    address: input.address,
                },
                input.qualification_reason
            );
        }
    }

    // "เพิ่มอีก" และ "ลดออก" ต้องอ้างอิง Active Order เดิม
    // ห้ามใช้ข้อความแก้จำนวนเพื่อสร้าง Order ใหม่โดยไม่มี Order ต้นทาง
    if (
        input.quantity_action === "add" ||
        input.quantity_action === "subtract"
    ) {
        return null;
    }

    if (
        !shouldCreateOrder(
            input.qualification_reason,
            resolved
        )
    ) {
        return null;
    }

    const order = await createOrder(env, {
        order_number: generateOrderNumber(),
        customer_record_id: customer.record_id,
        pipeline_record_id:
            resolved.pipeline_record_id || undefined,
        channel: getCustomerChannel(customer),
        external_order_id: "",
        customer_name: resolved.customer_name,
        phone: resolved.phone,
        address: resolved.address,
        product_name: resolved.product_name,
        product_unit: resolved.product_unit,
        quantity: resolved.quantity,
        total_amount: resolved.total_amount,
        payment_status: "Waiting Payment",
        payment_verified: false,
        order_status: "Waiting Payment",
        sales_owner: resolved.sales_owner,
    });

    await updateCustomer(env, customer.record_id, {
        active_order_id: order.record_id,
        product_name: resolved.product_name,
        product_qty: resolved.quantity,
        product_unit: resolved.product_unit,
    });

    return {
        record: order,
        created: true,
        changed: true,
        qualification_reason:
            input.qualification_reason,
        old_state: null,
        new_state: resolved,
    };
}

export async function updateActiveOrderAddress(
    env: Env,
    customer: LarkCustomerRecord,
    address: string
): Promise<AddressUpdateResult | null> {
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

    if (!existingOrder || isClosedOrder(existingOrder)) {
        return null;
    }

    const oldAddress = getLarkText(
        existingOrder.fields[ORDER_FIELDS.ADDRESS],
        ""
    ).trim();

    const newAddress = normalizeText(address);

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

export async function updateActiveOrderPhone(
    env: Env,
    customer: LarkCustomerRecord,
    phone: string
): Promise<PhoneUpdateResult | null> {
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

    if (!existingOrder || isClosedOrder(existingOrder)) {
        return null;
    }

    const oldPhone =
        normalizePhoneNumber(
            getLarkText(
                existingOrder.fields[ORDER_FIELDS.PHONE],
                ""
            )
        ) ?? "";
    const newPhone = normalizePhoneNumber(phone);

    if (!newPhone) {
        return {
            record: existingOrder,
            changed: false,
            old_phone: oldPhone,
            new_phone: oldPhone,
        };
    }

    if (oldPhone === newPhone) {
        return {
            record: existingOrder,
            changed: false,
            old_phone: oldPhone,
            new_phone: newPhone,
        };
    }

    const updatedOrder = await updateOrder(
        env,
        activeOrderId,
        {
            phone: newPhone,
        }
    );

    return {
        record: updatedOrder,
        changed: true,
        old_phone: oldPhone,
        new_phone: newPhone,
    };
}

export async function markActiveOrderPaymentReview(
    env: Env,
    customer: LarkCustomerRecord
): Promise<PaymentReviewResult | null> {
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

    if (!existingOrder || isClosedOrder(existingOrder)) {
        return null;
    }

    const oldPaymentStatus = getLarkText(
        existingOrder.fields[ORDER_FIELDS.PAYMENT_STATUS],
        ""
    ).trim();

    const oldOrderStatus = getLarkText(
        existingOrder.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    ).trim();

    const oldPaymentVerified = getLarkBoolean(
        existingOrder.fields[ORDER_FIELDS.PAYMENT_VERIFIED],
        false
    );

    const newPaymentStatus = "Payment Review";
    const newOrderStatus = "Payment Review";
    const newPaymentVerified = false;

    const changed =
        oldPaymentStatus !== newPaymentStatus ||
        oldOrderStatus !== newOrderStatus ||
        oldPaymentVerified !== newPaymentVerified;

    if (!changed) {
        return {
            record: existingOrder,
            changed: false,
            old_payment_status: oldPaymentStatus,
            new_payment_status: newPaymentStatus,
            old_order_status: oldOrderStatus,
            new_order_status: newOrderStatus,
            old_payment_verified: oldPaymentVerified,
            new_payment_verified: newPaymentVerified,
        };
    }

    const updatedOrder = await updateOrder(
        env,
        activeOrderId,
        {
            payment_status: newPaymentStatus,
            payment_verified: newPaymentVerified,
            order_status: newOrderStatus,
        }
    );

    return {
        record: updatedOrder,
        changed: true,
        old_payment_status: oldPaymentStatus,
        new_payment_status: newPaymentStatus,
        old_order_status: oldOrderStatus,
        new_order_status: newOrderStatus,
        old_payment_verified: oldPaymentVerified,
        new_payment_verified: newPaymentVerified,
    };
}

export async function cancelActiveOrder(
    env: Env,
    customer: LarkCustomerRecord,
    preferredOrderId?: string
): Promise<CancelOrderResult | null> {
    const cachedActiveOrderId = getLarkText(
        customer.fields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID],
        ""
    ).trim();

    const activeOrderId =
        preferredOrderId?.trim() ||
        cachedActiveOrderId;

    let existingOrder: LarkOrderRecord | null = null;

    if (activeOrderId) {
        existingOrder = await getOrderByRecordId(
            env,
            activeOrderId
        );
    }

    /*
     * Recover from relation history / table search when the text pointer is
     * blank or stale. More than one open Order is an invariant violation and
     * must stop the flow instead of cancelling an arbitrary record.
     */
    if (!existingOrder) {
        const historyOrderIds = getLinkedRecordIds(
            customer.fields[CUSTOMER_FIELDS.ORDERS_HISTORY]
        );

        const historyOrders = await getOrdersByRecordIds(
            env,
            historyOrderIds
        );

        const openHistoryOrders = historyOrders.filter(
            (order) => !isClosedOrder(order)
        );

        if (openHistoryOrders.length > 1) {
            throw new Error(
                `ORDER_INVARIANT_MULTIPLE_OPEN: customer=${customer.record_id}, orders=${openHistoryOrders
                    .map((order) => order.record_id)
                    .join(",")}`
            );
        }

        existingOrder = openHistoryOrders[0] ?? null;
    }

    if (!existingOrder) {
        const openOrders = await findOpenOrdersByCustomer(
            env,
            customer.record_id
        );

        if (openOrders.length > 1) {
            throw new Error(
                `ORDER_INVARIANT_MULTIPLE_OPEN: customer=${customer.record_id}, orders=${openOrders
                    .map((order) => order.record_id)
                    .join(",")}`
            );
        }

        existingOrder = openOrders[0] ?? null;
    }

    if (!existingOrder) {
        return null;
    }

    const oldOrderStatus = getLarkText(
        existingOrder.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    ).trim();

    const paymentStatus = getLarkText(
        existingOrder.fields[ORDER_FIELDS.PAYMENT_STATUS],
        ""
    ).trim();

    const paymentVerified = getLarkBoolean(
        existingOrder.fields[ORDER_FIELDS.PAYMENT_VERIFIED],
        false
    );

    const normalizedOrderStatus =
        oldOrderStatus.toLowerCase();

    if (normalizedOrderStatus === "completed") {
        throw new Error(
            `LOST_ORDER_ALREADY_COMPLETED: customer=${customer.record_id}, order=${existingOrder.record_id}`
        );
    }

    if (normalizedOrderStatus === "cancelled") {
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
        existingOrder.record_id,
        {
            order_status: newOrderStatus,
        }
    );

    const persistedOrderStatus = getLarkText(
        cancelledOrder.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    )
        .trim()
        .toLowerCase();

    if (persistedOrderStatus !== "cancelled") {
        throw new Error(
            `ORDER_CANCEL_UPDATE_NOT_PERSISTED: order=${existingOrder.record_id}`
        );
    }

    return {
        record: cancelledOrder,
        changed: true,
        old_order_status: oldOrderStatus,
        new_order_status: newOrderStatus,
        payment_status: paymentStatus,
        payment_verified: paymentVerified,
    };
}
