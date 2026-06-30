import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import {
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import {
    buildCustomerLookup,
    getLinkedRecordId,
    normalizeChannel,
    nullableText,
    readTimestamp,
    toIso,
    unknownCustomer,
} from "../dashboard-read/dashboard-read.shared";
import {
    getDashboardActivities,
    getDashboardCustomers,
    getDashboardOrders,
} from "../dashboard-read/dashboard-read.records";
import type { LarkOrderRecord } from "./order.repository";
import { resolveOrderAmountEditPolicy, type OrderAmountEditBlockReason } from "./order-amount-policy";
import { resolveOrderPaymentDisplayState, type OrderPaymentDisplayState } from "./order-payment-state";
import {
    buildOrderActivityIndex,
    classifyOrderWorkQueue,
    type MissingDeliveryField,
    type OrderWorkQueue,
} from "./order-work-queue";

export type OrderStatusResponse = "Draft" | "Confirmed" | "Completed" | "Cancelled";
export type PaymentStatusResponse = "Pending" | "Paid" | "Overdue";
export type PaymentDisplayStatusResponse = OrderPaymentDisplayState;
export type OrderSyncStatusResponse = "synced" | "pending" | "failed";
export type OrderDateBasis = "created_at" | "paid_at" | "updated_at";

export type OrderRecordResponse = {
    order_id: string;
    external_order_id: string | null;
    pipeline_id: string | null;
    channel: "LINE" | "Shopee" | "Lazada" | "TikTok Shop";
    customer: {
        customer_id: string;
        customer_name: string;
        phone: string | null;
        sales_owner: string | null;
    };
    product_name: string | null;
    quantity: number;
    total_amount: number;
    order_status: OrderStatusResponse;
    payment_status: PaymentStatusResponse;
    payment_display_status: PaymentDisplayStatusResponse;
    address: string | null;
    tracking_number: string | null;
    payment_verified: boolean;
    payment_review_available: boolean;
    work_queue: OrderWorkQueue;
    missing_delivery_fields: MissingDeliveryField[];
    amount_edit_allowed: boolean;
    amount_edit_block_reason: OrderAmountEditBlockReason | null;
    sync_status: OrderSyncStatusResponse;
    sync_error: string | null;
    created_at: string;
    updated_at: string;
    paid_at: string | null;
    closed_at: string | null;
};

export type OrderListResponse = {
    items: OrderRecordResponse[];
    summary: {
        total_orders: number;
        pending_payment_orders: number;
        unpaid_orders: number;
        payment_review_orders: number;
        paid_orders: number;
        needs_attention_orders: number;
    };
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    updated_at: string;
    applied_filters: {
        work_queue: OrderWorkQueue | null;
        date_basis: OrderDateBasis | null;
        date_from: string | null;
        date_to: string | null;
    };
};

export type OrderListQuery = {
    search: string;
    channel: OrderRecordResponse["channel"] | null;
    order_status: OrderStatusResponse | null;
    payment_status: PaymentStatusResponse | null;
    payment_state?: PaymentDisplayStatusResponse | null;
    work_queue?: OrderWorkQueue | null;
    date_basis?: OrderDateBasis | null;
    date_from_ms?: number | null;
    date_to_ms?: number | null;
    sort: "updated_desc" | "amount_desc" | "created_desc";
    page: number;
    page_size: number;
};

type OrderReadData = {
    customers: Awaited<ReturnType<typeof getDashboardCustomers>>;
    orders: Awaited<ReturnType<typeof getDashboardOrders>>;
    activities: Awaited<ReturnType<typeof getDashboardActivities>>;
};

async function loadOrderReadData(env: Env): Promise<OrderReadData> {
    const [customers, orders, activities] = await Promise.all([
        getDashboardCustomers(env),
        getDashboardOrders(env),
        getDashboardActivities(env),
    ]);
    return { customers, orders, activities };
}

function normalizeOrderStatus(value: unknown): OrderStatusResponse {
    const status = getLarkText(value, "Draft").trim().toLowerCase();
    if (status === "completed" || status === "delivered") return "Completed";
    if (status === "cancelled" || status === "canceled" || status === "returned") return "Cancelled";
    if (["confirmed", "processing", "ready to ship", "shipped"].includes(status)) return "Confirmed";
    return "Draft";
}

function normalizePaymentStatus(value: unknown): PaymentStatusResponse {
    const status = getLarkText(value, "Pending").trim().toLowerCase();
    if (status === "paid") return "Paid";
    if (status === "overdue") return "Overdue";
    return "Pending";
}

function normalizeSyncStatus(
    fields: Record<string, unknown>,
    channel: OrderRecordResponse["channel"]
): OrderSyncStatusResponse {
    if (channel === "LINE") return "synced";
    const marketplaceUpdatedAt = readTimestamp(fields[ORDER_FIELDS.MARKETPLACE_UPDATED_AT]);
    const eventId = getLarkText(fields[ORDER_FIELDS.MARKETPLACE_EVENT_ID], "").trim();
    if (marketplaceUpdatedAt > 0 && eventId) return "synced";
    if (eventId || marketplaceUpdatedAt > 0) return "pending";
    return "pending";
}

function mapOrder(
    record: LarkOrderRecord,
    customers: ReturnType<typeof buildCustomerLookup>,
    customerRecordMap: ReadonlyMap<string, OrderReadData["customers"][number]>,
    activityIndex: ReturnType<typeof buildOrderActivityIndex>
): OrderRecordResponse {
    const fields = record.fields;
    const channel = normalizeChannel(fields[ORDER_FIELDS.CHANNEL]);
    const customerId = getLinkedRecordId(fields[ORDER_FIELDS.CUSTOMER]);
    const customer = customers.get(customerId ?? "") ?? unknownCustomer(customerId, channel);
    const classification = classifyOrderWorkQueue(
        record,
        customerRecordMap,
        activityIndex.get(record.record_id) ?? []
    );
    const createdAt = readTimestamp(fields[ORDER_FIELDS.CREATED_AT]);
    const updatedAt = readTimestamp(fields[ORDER_FIELDS.UPDATED_AT], createdAt);
    const paidAt = readTimestamp(fields[ORDER_FIELDS.PAID_AT]);
    const orderStatus = normalizeOrderStatus(fields[ORDER_FIELDS.ORDER_STATUS]);
    const orderCustomerName = getLarkText(fields[ORDER_FIELDS.CUSTOMER_NAME], "").trim();
    const orderPhone = nullableText(fields[ORDER_FIELDS.PHONE]);
    const orderOwner = nullableText(fields[ORDER_FIELDS.SALES_OWNER]);
    const syncStatus = normalizeSyncStatus(fields, channel);
    const paymentStatus = normalizePaymentStatus(fields[ORDER_FIELDS.PAYMENT_STATUS]);
    const paymentVerified = getLarkBoolean(fields[ORDER_FIELDS.PAYMENT_VERIFIED], false);
    const paymentDisplayStatus = resolveOrderPaymentDisplayState({
        paymentStatus,
        paymentVerified,
        workQueue: classification.work_queue,
    });
    const amountEditPolicy = resolveOrderAmountEditPolicy(record, classification);

    return {
        order_id: record.record_id,
        external_order_id: nullableText(fields[ORDER_FIELDS.EXTERNAL_ORDER_ID]),
        pipeline_id: getLinkedRecordId(fields[ORDER_FIELDS.PIPELINE]),
        channel,
        customer: {
            customer_id: customer.customer_id,
            customer_name: orderCustomerName || customer.customer_name,
            phone: orderPhone || customer.phone,
            sales_owner: orderOwner || customer.sales_owner,
        },
        product_name: nullableText(fields[ORDER_FIELDS.PRODUCT_NAME]),
        quantity: Math.max(0, getLarkNumber(fields[ORDER_FIELDS.QUANTITY], 0)),
        total_amount: Math.max(0, getLarkNumber(fields[ORDER_FIELDS.TOTAL_AMOUNT], 0)),
        order_status: orderStatus,
        payment_status: paymentStatus,
        payment_display_status: paymentDisplayStatus,
        address: nullableText(fields[ORDER_FIELDS.ADDRESS]),
        tracking_number: nullableText(fields[ORDER_FIELDS.TRACKING_NUMBER]),
        payment_verified: paymentVerified,
        payment_review_available: classification.work_queue === "payment_review",
        work_queue: classification.work_queue,
        missing_delivery_fields: classification.missing_delivery_fields,
        amount_edit_allowed: amountEditPolicy.allowed,
        amount_edit_block_reason: amountEditPolicy.reason,
        sync_status: syncStatus,
        sync_error: syncStatus === "failed" ? "MARKETPLACE_SYNC_FAILED" : null,
        created_at: toIso(createdAt),
        updated_at: toIso(updatedAt, createdAt),
        paid_at: paidAt > 0 ? toIso(paidAt) : null,
        closed_at: orderStatus === "Completed" || orderStatus === "Cancelled"
            ? toIso(updatedAt, createdAt)
            : null,
    };
}

function dateValue(item: OrderRecordResponse, basis: OrderDateBasis): number {
    if (basis === "paid_at") return item.paid_at ? Date.parse(item.paid_at) : 0;
    if (basis === "updated_at") return Date.parse(item.updated_at);
    return Date.parse(item.created_at);
}

function matchesQuery(item: OrderRecordResponse, query: OrderListQuery): boolean {
    const search = query.search.trim().toLocaleLowerCase("th-TH");
    const text = [
        item.order_id,
        item.external_order_id ?? "",
        item.customer.customer_name,
        item.customer.phone ?? "",
        item.product_name ?? "",
        item.tracking_number ?? "",
    ].join(" ").toLocaleLowerCase("th-TH");
    const dateBasis = query.date_basis ?? "created_at";
    const dateFrom = query.date_from_ms ?? null;
    const dateTo = query.date_to_ms ?? null;
    const eventAt = dateFrom !== null || dateTo !== null ? dateValue(item, dateBasis) : 0;
    const afterStart = dateFrom === null || (eventAt > 0 && eventAt >= dateFrom);
    const beforeEnd = dateTo === null || (eventAt > 0 && eventAt < dateTo);

    return (
        (!search || text.includes(search)) &&
        (!query.channel || item.channel === query.channel) &&
        (!query.order_status || item.order_status === query.order_status) &&
        (!query.payment_status || item.payment_status === query.payment_status) &&
        (!query.payment_state || item.payment_display_status === query.payment_state) &&
        (!query.work_queue || item.work_queue === query.work_queue) &&
        afterStart &&
        beforeEnd
    );
}

function sortOrders(items: OrderRecordResponse[], sort: OrderListQuery["sort"]): OrderRecordResponse[] {
    return [...items].sort((left, right) => {
        if (sort === "amount_desc") return right.total_amount - left.total_amount;
        if (sort === "created_desc") return Date.parse(right.created_at) - Date.parse(left.created_at);
        return Date.parse(right.updated_at) - Date.parse(left.updated_at);
    });
}

export async function getOrderList(
    env: Env,
    query: OrderListQuery
): Promise<OrderListResponse> {
    const data = await loadOrderReadData(env);
    const customers = buildCustomerLookup(data.customers);
    const activityIndex = buildOrderActivityIndex(data.activities);
    const customerRecordMap = new Map(
        data.customers.map((item) => [item.record_id, item] as const)
    );
    const allItems = data.orders.map((record) =>
        mapOrder(record, customers, customerRecordMap, activityIndex)
    );
    const prepared = sortOrders(allItems.filter((item) => matchesQuery(item, query)), query.sort);
    const totalPages = Math.max(1, Math.ceil(prepared.length / query.page_size));
    const safePage = Math.min(query.page, totalPages);
    const start = (safePage - 1) * query.page_size;

    return {
        items: prepared.slice(start, start + query.page_size),
        summary: {
            total_orders: allItems.length,
            pending_payment_orders: allItems.filter((item) =>
                item.payment_display_status === "unpaid" || item.payment_display_status === "payment_review"
            ).length,
            unpaid_orders: allItems.filter((item) => item.payment_display_status === "unpaid").length,
            payment_review_orders: allItems.filter((item) => item.payment_display_status === "payment_review").length,
            paid_orders: allItems.filter((item) => item.payment_status === "Paid").length,
            needs_attention_orders: allItems.filter((item) =>
                item.work_queue !== "none" || item.payment_status === "Overdue" || item.sync_status === "failed"
            ).length,
        },
        total: prepared.length,
        page: safePage,
        page_size: query.page_size,
        total_pages: totalPages,
        updated_at: new Date().toISOString(),
        applied_filters: {
            work_queue: query.work_queue ?? null,
            date_basis: query.date_basis ?? null,
            date_from: query.date_from_ms == null ? null : new Date(query.date_from_ms).toISOString(),
            date_to: query.date_to_ms == null ? null : new Date(query.date_to_ms).toISOString(),
        },
    };
}

export async function getOrderDetail(
    env: Env,
    orderId: string
): Promise<OrderRecordResponse | null> {
    const data = await loadOrderReadData(env);
    const record = data.orders.find((item) => item.record_id === orderId);
    if (!record) return null;
    return mapOrder(
        record,
        buildCustomerLookup(data.customers),
        new Map(data.customers.map((item) => [item.record_id, item] as const)),
        buildOrderActivityIndex(data.activities)
    );
}
