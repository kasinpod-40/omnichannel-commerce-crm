import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
} from "../../core/lark-fields";
import {
    getFirstLinkedRecordId,
    getLarkNumber,
    getLarkText,
    getLinkedRecordIds,
} from "../../utils/lark-field-value";
import { recordActivityOnce } from "../activities/activity.service";
import {
    createCustomer,
    findCustomerByChannelCustomerId,
    getCustomerByRecordId,
    updateCustomer,
} from "../customers/customer.repository";
import type {
    Customer,
    CustomerStage,
} from "../customers/customer.types";
import type { LarkCustomerRecord } from "../customers/customer.repository";
import { recordAndDispatchNotificationOnce } from "../notifications/notification.service";
import type { NotificationSnapshot } from "../notifications/notification.types";
import {
    createOrder,
    findOrdersByCustomer,
    findOrderByChannelAndExternalId,
    getOrdersByRecordIds,
    updateOrder,
} from "../orders/order.repository";
import type { Order } from "../orders/order.types";
import type { LarkOrderRecord } from "../orders/order.repository";
import {
    mapMarketplaceStatus,
} from "./marketplace-status";
import type {
    MarketplaceOrderInput,
    MarketplaceOrderUpsertResult,
    MarketplaceStatusMapping,
} from "./marketplace.types";

function toTimestamp(
    value: number | string | undefined,
    fallback: number
): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value < 10_000_000_000 ? value * 1_000 : value;
    }

    if (typeof value === "string" && value.trim()) {
        const numeric = Number(value);

        if (Number.isFinite(numeric)) {
            return numeric < 10_000_000_000
                ? numeric * 1_000
                : numeric;
        }

        const parsed = Date.parse(value);

        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return fallback;
}

function summarizeItems(input: MarketplaceOrderInput): {
    product_name: string;
    product_size: string;
    quantity: number;
    items_json: string;
} {
    const productName = input.items
        .map((item) => item.name)
        .join(" | ")
        .slice(0, 1000);
    const productSize = input.items
        .map((item) => item.variant ?? "")
        .filter(Boolean)
        .join(" | ")
        .slice(0, 500);
    const quantity = input.items.reduce(
        (sum, item) => sum + Math.max(1, item.quantity),
        0
    );

    return {
        product_name: productName,
        product_size: productSize,
        quantity,
        items_json: JSON.stringify(input.items),
    };
}

function customerStateForOrder(
    orderStatus: Order["order_status"]
): { stage: CustomerStage; lead_score: number } {
    if (orderStatus === "Cancelled" || orderStatus === "Returned") {
        return {
            stage: "Lost",
            lead_score: 0,
        };
    }

    if (orderStatus === "Completed") {
        return {
            stage: "Won",
            lead_score: 100,
        };
    }

    return {
        stage: "Closing",
        lead_score: 95,
    };
}

async function resolveMarketplaceCustomer(
    env: Env,
    input: MarketplaceOrderInput,
    orderStatus: Order["order_status"],
    linkedCustomerRecordId?: string
): Promise<LarkCustomerRecord> {
    const channelCustomerId = `${input.store_id}:${input.buyer.id}`;

    if (linkedCustomerRecordId) {
        const linkedCustomer = await getCustomerByRecordId(
            env,
            linkedCustomerRecordId
        );

        if (linkedCustomer) {
            return linkedCustomer;
        }
    }

    const existing = await findCustomerByChannelCustomerId(
        env,
        input.channel,
        channelCustomerId
    );
    const customerState = customerStateForOrder(orderStatus);

    if (existing) {
        return existing;
    }

    const summary = `${input.channel} order ${input.external_order_id} (${input.marketplace_status})`;
    const customer: Customer = {
        channel: input.channel,
        channel_customer_id: channelCustomerId,
        customer_name:
            input.buyer.name ?? `${input.channel} Buyer`,
        phone: input.buyer.phone ?? "",
        current_stage: customerState.stage,
        buyer_intent: "Ready To Buy",
        lead_score: customerState.lead_score,
        hot_lead: false,
        ai_summary: summary,
        last_message: summary,
        message_count: 0,
        product_name: input.items[0]?.name ?? "",
        product_size: input.items[0]?.variant ?? "",
        product_qty: input.items.reduce(
            (sum, item) => sum + item.quantity,
            0
        ),
        product_unit: "item",
        pending_payment: false,
        pending_slip_amount: 0,
        pending_slip_bank: "",
        pending_slip_image_url: "",
        pending_slip_attachment_tokens: [],
        sales_owner: "Unassigned",
    };

    return await createCustomer(env, customer);
}

const ACTIVE_ORDER_STATUSES = new Set<Order["order_status"]>([
    "Waiting Payment",
    "Payment Review",
    "Waiting Address",
    "Processing",
    "Ready to Ship",
    "Shipped",
]);

function aggregateCustomerState(
    orders: LarkOrderRecord[]
): { stage: CustomerStage; lead_score: number } {
    const statuses = orders.map((order) =>
        getLarkText(
            order.fields[ORDER_FIELDS.ORDER_STATUS],
            ""
        ) as Order["order_status"]
    );

    if (statuses.some((status) => ACTIVE_ORDER_STATUSES.has(status))) {
        return {
            stage: "Closing",
            lead_score: 95,
        };
    }

    if (statuses.includes("Completed")) {
        return {
            stage: "Won",
            lead_score: 100,
        };
    }

    return {
        stage: "Lost",
        lead_score: 0,
    };
}

function orderTimelineValue(order: LarkOrderRecord): number {
    return getLarkNumber(
        order.fields[ORDER_FIELDS.CREATED_AT],
        getLarkNumber(
            order.fields[ORDER_FIELDS.MARKETPLACE_UPDATED_AT],
            getLarkNumber(
                order.fields[ORDER_FIELDS.UPDATED_AT],
                0
            )
        )
    );
}

function latestCustomerOrder(
    orders: LarkOrderRecord[]
): LarkOrderRecord | null {
    if (orders.length === 0) {
        return null;
    }

    return [...orders].sort((left, right) => {
        const timelineDifference =
            orderTimelineValue(right) - orderTimelineValue(left);

        if (timelineDifference !== 0) {
            return timelineDifference;
        }

        return right.record_id.localeCompare(left.record_id);
    })[0];
}

async function relatedCustomerOrders(
    env: Env,
    customer: LarkCustomerRecord,
    currentOrder: LarkOrderRecord
): Promise<LarkOrderRecord[]> {
    const linkedOrderIds = getLinkedRecordIds(
        customer.fields[CUSTOMER_FIELDS.ORDERS_HISTORY]
    ).filter((recordId) => recordId !== currentOrder.record_id);

    let related = linkedOrderIds.length > 0
        ? await getOrdersByRecordIds(env, linkedOrderIds)
        : await findOrdersByCustomer(env, customer.record_id);

    related = related.filter(
        (order) => order.record_id !== currentOrder.record_id
    );

    return [...related, currentOrder];
}

async function reconcileMarketplaceCustomer(
    env: Env,
    customer: LarkCustomerRecord,
    input: MarketplaceOrderInput,
    currentOrder: LarkOrderRecord
): Promise<{ stage: CustomerStage; lead_score: number }> {
    const orders = await relatedCustomerOrders(
        env,
        customer,
        currentOrder
    );
    const aggregateState = aggregateCustomerState(orders);
    const latestOrder = latestCustomerOrder(orders) ?? currentOrder;
    const latestExternalOrderId = getLarkText(
        latestOrder.fields[ORDER_FIELDS.EXTERNAL_ORDER_ID],
        input.external_order_id
    );
    const latestMarketplaceStatus = getLarkText(
        latestOrder.fields[ORDER_FIELDS.MARKETPLACE_STATUS],
        input.marketplace_status
    );
    const latestChannel = getLarkText(
        latestOrder.fields[ORDER_FIELDS.CHANNEL],
        input.channel
    );
    const latestSummary = `${latestChannel} order ${latestExternalOrderId} (${latestMarketplaceStatus})`;

    await updateCustomer(env, customer.record_id, {
        customer_name:
            input.buyer.name ||
            getLarkText(
                customer.fields[CUSTOMER_FIELDS.CUSTOMER_NAME],
                `${input.channel} Buyer`
            ),
        phone:
            input.buyer.phone ||
            getLarkText(
                customer.fields[CUSTOMER_FIELDS.PHONE],
                ""
            ),
        current_stage: aggregateState.stage,
        buyer_intent: "Ready To Buy",
        lead_score: aggregateState.lead_score,
        hot_lead: false,
        ai_summary: latestSummary,
        last_message: latestSummary,
        product_name: getLarkText(
            latestOrder.fields[ORDER_FIELDS.PRODUCT_NAME],
            ""
        ),
        product_size: getLarkText(
            latestOrder.fields[ORDER_FIELDS.PRODUCT_SIZE],
            ""
        ),
        product_qty: getLarkNumber(
            latestOrder.fields[ORDER_FIELDS.QUANTITY],
            0
        ),
        product_unit: getLarkText(
            latestOrder.fields[ORDER_FIELDS.PRODUCT_UNIT],
            "item"
        ),
    });

    return aggregateState;
}

function createOrderNumber(
    channel: MarketplaceOrderInput["channel"],
    externalOrderId: string
): string {
    const prefix =
        channel === "Shopee"
            ? "SP"
            : channel === "Lazada"
              ? "LZ"
              : "TT";

    return `${prefix}-${externalOrderId}`;
}

function isCancelledOrReturned(
    status: Order["order_status"]
): boolean {
    return status === "Cancelled" || status === "Returned";
}

function createMarketplaceNotificationSnapshot(
    input: MarketplaceOrderInput,
    mapping: MarketplaceStatusMapping,
    summary: ReturnType<typeof summarizeItems>,
    aggregateCustomerState?: {
        stage: CustomerStage;
        lead_score: number;
    },
    notificationKind: "created" | "completed" | "cancelled" = "created"
): NotificationSnapshot {
    const customerState =
        aggregateCustomerState ??
        customerStateForOrder(mapping.order_status);

    return {
        version: 1,
        captured_at: Date.now(),
        customer_name:
            input.buyer.name ?? `${input.channel} Buyer`,
        channel: input.channel,
        phone: input.buyer.phone ?? "",
        current_stage: customerState.stage,
        lead_score: customerState.lead_score,
        last_message: `${input.channel} order ${input.external_order_id} (${input.marketplace_status})`,
        sales_owner: "Unassigned",
        order_number: createOrderNumber(
            input.channel,
            input.external_order_id
        ),
        product_name: summary.product_name,
        product_size: summary.product_size,
        quantity: summary.quantity,
        total_amount: input.total_amount,
        slip_amount: 0,
        payment_status: mapping.payment_status,
        order_status: mapping.order_status,
        marketplace_event_kind: notificationKind,
    };
}

async function dispatchMarketplaceNotification(
    env: Env,
    input: MarketplaceOrderInput,
    mapping: MarketplaceStatusMapping,
    summary: ReturnType<typeof summarizeItems>,
    customerRecordId: string,
    kind: "created" | "completed" | "cancelled",
    aggregateCustomerState?: {
        stage: CustomerStage;
        lead_score: number;
    }
): Promise<void> {
    const isCancelled = kind === "cancelled";
    const isCompleted = kind === "completed";
    const eventId = isCancelled
        ? `MARKETPLACE_ORDER_CANCELLED:${input.channel}:${input.external_order_id}`
        : isCompleted
          ? `MARKETPLACE_ORDER_COMPLETED:${input.channel}:${input.external_order_id}`
          : `MARKETPLACE_ORDER_CREATED:${input.channel}:${input.external_order_id}`;

    try {
        await recordAndDispatchNotificationOnce(env, {
            event_id: eventId,
            notification_type: isCancelled
                ? "SALE_LOST"
                : "SALE_WON",
            customer_record_id: customerRecordId,
            message: isCancelled
                ? `คำสั่งซื้อ ${input.channel} ${input.external_order_id} ถูกยกเลิกหรือคืนสินค้า`
                : isCompleted
                  ? `คำสั่งซื้อ ${input.channel} ${input.external_order_id} เสร็จสมบูรณ์`
                  : `มีคำสั่งซื้อใหม่จาก ${input.channel}: ${input.external_order_id}`,
            payload: createMarketplaceNotificationSnapshot(
                input,
                mapping,
                summary,
                aggregateCustomerState,
                kind
            ),
            status: "Pending",
        });
    } catch (error) {
        console.error("MARKETPLACE_ORDER_NOTIFICATION_FAILED", {
            channel: input.channel,
            external_order_id: input.external_order_id,
            kind,
            error:
                error instanceof Error
                    ? error.message.slice(0, 500)
                    : String(error).slice(0, 500),
        });
    }
}

async function resolveExistingOrderCustomer(
    env: Env,
    input: MarketplaceOrderInput,
    existingOrder: { fields: Record<string, unknown> },
    orderStatus: Order["order_status"]
): Promise<LarkCustomerRecord> {
    const linkedCustomerId = getFirstLinkedRecordId(
        existingOrder.fields[ORDER_FIELDS.CUSTOMER]
    );

    return await resolveMarketplaceCustomer(
        env,
        input,
        orderStatus,
        linkedCustomerId || undefined
    );
}

function createCurrentOrderRecord(
    recordId: string,
    input: MarketplaceOrderInput,
    mapping: MarketplaceStatusMapping,
    summary: ReturnType<typeof summarizeItems>,
    createdAt: number,
    marketplaceUpdatedAt: number,
    updatedAt: number
): LarkOrderRecord {
    return {
        record_id: recordId,
        fields: {
            [ORDER_FIELDS.CHANNEL]: input.channel,
            [ORDER_FIELDS.EXTERNAL_ORDER_ID]:
                input.external_order_id,
            [ORDER_FIELDS.PRODUCT_NAME]: summary.product_name,
            [ORDER_FIELDS.PRODUCT_SIZE]: summary.product_size,
            [ORDER_FIELDS.PRODUCT_UNIT]: "item",
            [ORDER_FIELDS.QUANTITY]: summary.quantity,
            [ORDER_FIELDS.ORDER_STATUS]: mapping.order_status,
            [ORDER_FIELDS.MARKETPLACE_STATUS]:
                input.marketplace_status,
            [ORDER_FIELDS.CREATED_AT]: createdAt,
            [ORDER_FIELDS.UPDATED_AT]: updatedAt,
            [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]:
                marketplaceUpdatedAt,
        },
    };
}

export async function upsertMarketplaceOrder(
    env: Env,
    input: MarketplaceOrderInput
): Promise<MarketplaceOrderUpsertResult> {
    const now = Date.now();
    const mapping = mapMarketplaceStatus(
        input.channel,
        input.marketplace_status,
        input.marketplace_payment_status
    );
    const summary = summarizeItems(input);
    const marketplaceUpdatedAt = toTimestamp(
        input.updated_at,
        now
    );
    const createdAt = toTimestamp(
        input.created_at,
        marketplaceUpdatedAt
    );
    const paidAt = mapping.payment_status === "Paid"
        ? toTimestamp(input.paid_at, marketplaceUpdatedAt)
        : undefined;
    const existing = await findOrderByChannelAndExternalId(
        env,
        input.channel,
        input.external_order_id
    );

    if (existing) {
        const previousEventId = getLarkText(
            existing.fields[ORDER_FIELDS.MARKETPLACE_EVENT_ID],
            ""
        );
        const previousUpdatedAt = getLarkNumber(
            existing.fields[ORDER_FIELDS.MARKETPLACE_UPDATED_AT],
            0
        );
        const customer = await resolveExistingOrderCustomer(
            env,
            input,
            existing,
            mapping.order_status
        );

        if (previousEventId === input.event_id) {
            return {
                action: "duplicate",
                customer_record_id: customer.record_id,
                order_record_id: existing.record_id,
                channel: input.channel,
                external_order_id: input.external_order_id,
                order_status: mapping.order_status,
                payment_status: mapping.payment_status,
            };
        }

        if (
            previousUpdatedAt > 0 &&
            marketplaceUpdatedAt < previousUpdatedAt
        ) {
            return {
                action: "stale",
                customer_record_id: customer.record_id,
                order_record_id: existing.record_id,
                channel: input.channel,
                external_order_id: input.external_order_id,
                order_status: getLarkText(
                    existing.fields[ORDER_FIELDS.ORDER_STATUS],
                    mapping.order_status
                ) as Order["order_status"],
                payment_status: getLarkText(
                    existing.fields[ORDER_FIELDS.PAYMENT_STATUS],
                    mapping.payment_status
                ) as Order["payment_status"],
            };
        }

        const oldStatus = getLarkText(
            existing.fields[ORDER_FIELDS.MARKETPLACE_STATUS],
            ""
        );
        const oldOrderStatus = getLarkText(
            existing.fields[ORDER_FIELDS.ORDER_STATUS],
            mapMarketplaceStatus(
                input.channel,
                oldStatus,
                getLarkText(
                    existing.fields[ORDER_FIELDS.PAYMENT_STATUS],
                    ""
                )
            ).order_status
        ) as Order["order_status"];

        await updateOrder(env, existing.record_id, {
            customer_name: input.buyer.name ?? "",
            phone: input.buyer.phone ?? "",
            address: input.buyer.address ?? "",
            product_name: summary.product_name,
            product_size: summary.product_size,
            product_unit: "item",
            quantity: summary.quantity,
            total_amount: input.total_amount,
            payment_status: mapping.payment_status,
            payment_verified: mapping.payment_verified,
            order_status: mapping.order_status,
            paid_at: paidAt,
            marketplace_store_id: input.store_id,
            marketplace_store_name: input.store_name ?? "",
            marketplace_status: input.marketplace_status,
            marketplace_items_json: summary.items_json,
            marketplace_event_id: input.event_id,
            marketplace_updated_at: marketplaceUpdatedAt,
            currency: input.currency ?? "THB",
            tracking_number: input.tracking_number ?? "",
            shipping_provider: input.shipping_provider ?? "",
            updated_at: now,
        });

        const aggregateCustomerState = await reconcileMarketplaceCustomer(
            env,
            customer,
            input,
            createCurrentOrderRecord(
                existing.record_id,
                input,
                mapping,
                summary,
                getLarkNumber(
                    existing.fields[ORDER_FIELDS.CREATED_AT],
                    createdAt
                ),
                marketplaceUpdatedAt,
                now
            )
        );

        await recordActivityOnce(env, {
            event_id: `marketplace:${input.channel}:${input.event_id}:updated`,
            customer_record_id: customer.record_id,
            action: "MARKETPLACE_ORDER_UPDATED",
            old_value: oldStatus,
            new_value: input.marketplace_status,
        });

        if (
            mapping.order_status === "Completed" &&
            oldOrderStatus !== "Completed"
        ) {
            await dispatchMarketplaceNotification(
                env,
                input,
                mapping,
                summary,
                customer.record_id,
                "completed",
                aggregateCustomerState
            );
        } else if (
            isCancelledOrReturned(mapping.order_status) &&
            !isCancelledOrReturned(oldOrderStatus)
        ) {
            await dispatchMarketplaceNotification(
                env,
                input,
                mapping,
                summary,
                customer.record_id,
                "cancelled",
                aggregateCustomerState
            );
        }

        return {
            action: "updated",
            customer_record_id: customer.record_id,
            order_record_id: existing.record_id,
            channel: input.channel,
            external_order_id: input.external_order_id,
            order_status: mapping.order_status,
            payment_status: mapping.payment_status,
        };
    }

    const customer = await resolveMarketplaceCustomer(
        env,
        input,
        mapping.order_status
    );
    const order: Order = {
        order_number: createOrderNumber(
            input.channel,
            input.external_order_id
        ),
        customer_record_id: customer.record_id,
        channel: input.channel,
        external_order_id: input.external_order_id,
        customer_name: input.buyer.name ?? "",
        phone: input.buyer.phone ?? "",
        address: input.buyer.address ?? "",
        product_name: summary.product_name,
        product_size: summary.product_size,
        product_unit: "item",
        quantity: summary.quantity,
        total_amount: input.total_amount,
        payment_status: mapping.payment_status,
        payment_verified: mapping.payment_verified,
        order_status: mapping.order_status,
        sales_owner: "Unassigned",
        created_at: createdAt,
        updated_at: now,
        paid_at: paidAt,
        marketplace_store_id: input.store_id,
        marketplace_store_name: input.store_name ?? "",
        marketplace_status: input.marketplace_status,
        marketplace_items_json: summary.items_json,
        marketplace_event_id: input.event_id,
        marketplace_updated_at: marketplaceUpdatedAt,
        currency: input.currency ?? "THB",
        tracking_number: input.tracking_number ?? "",
        shipping_provider: input.shipping_provider ?? "",
    };

    const created = await createOrder(env, order);

    const aggregateCustomerState = await reconcileMarketplaceCustomer(
        env,
        customer,
        input,
        createCurrentOrderRecord(
            created.record_id,
            input,
            mapping,
            summary,
            createdAt,
            marketplaceUpdatedAt,
            now
        )
    );

    await recordActivityOnce(env, {
        event_id: `marketplace:${input.channel}:${input.event_id}:created`,
        customer_record_id: customer.record_id,
        action: "MARKETPLACE_ORDER_CREATED",
        old_value: null,
        new_value: {
            external_order_id: input.external_order_id,
            marketplace_status: input.marketplace_status,
            total_amount: input.total_amount,
        },
    });

    await dispatchMarketplaceNotification(
        env,
        input,
        mapping,
        summary,
        customer.record_id,
        isCancelledOrReturned(mapping.order_status)
            ? "cancelled"
            : mapping.order_status === "Completed"
              ? "completed"
              : "created",
        aggregateCustomerState
    );

    return {
        action: "created",
        customer_record_id: customer.record_id,
        order_record_id: created.record_id,
        channel: input.channel,
        external_order_id: input.external_order_id,
        order_status: mapping.order_status,
        payment_status: mapping.payment_status,
    };
}
