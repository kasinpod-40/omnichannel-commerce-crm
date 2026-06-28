import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import {
    getLarkAttachmentTokens,
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
import type { LarkOrderRecord } from "./order.repository";
import {
    getDashboardCustomers,
    getDashboardOrders,
} from "../dashboard-read/dashboard-read.records";

export type OrderStatusResponse = "Draft" | "Confirmed" | "Completed" | "Cancelled";
export type PaymentStatusResponse = "Pending" | "Paid" | "Overdue";
export type OrderSyncStatusResponse = "synced" | "pending" | "failed";

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
    address: string | null;
    tracking_number: string | null;
    payment_verified: boolean;
    payment_review_available: boolean;
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
        paid_orders: number;
        needs_attention_orders: number;
    };
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    updated_at: string;
};

export type OrderListQuery = {
    search: string;
    channel: OrderRecordResponse["channel"] | null;
    order_status: OrderStatusResponse | null;
    payment_status: PaymentStatusResponse | null;
    sort: "updated_desc" | "amount_desc" | "created_desc";
    page: number;
    page_size: number;
};

type OrderReadData = {
    customers: Awaited<ReturnType<typeof getDashboardCustomers>>;
    orders: Awaited<ReturnType<typeof getDashboardOrders>>;
};

async function loadOrderReadData(env: Env): Promise<OrderReadData> {
    const [customers, orders] = await Promise.all([
        getDashboardCustomers(env),
        getDashboardOrders(env),
    ]);
    return { customers, orders };
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
    customers: ReturnType<typeof buildCustomerLookup>
): OrderRecordResponse {
    const fields = record.fields;
    const channel = normalizeChannel(fields[ORDER_FIELDS.CHANNEL]);
    const customerId = getLinkedRecordId(fields[ORDER_FIELDS.CUSTOMER]);
    const customer = customers.get(customerId ?? "") ?? unknownCustomer(customerId, channel);
    const createdAt = readTimestamp(fields[ORDER_FIELDS.CREATED_AT]);
    const updatedAt = readTimestamp(fields[ORDER_FIELDS.UPDATED_AT], createdAt);
    const paidAt = readTimestamp(fields[ORDER_FIELDS.PAID_AT]);
    const orderStatus = normalizeOrderStatus(fields[ORDER_FIELDS.ORDER_STATUS]);
    const orderCustomerName = getLarkText(fields[ORDER_FIELDS.CUSTOMER_NAME], "").trim();
    const orderPhone = nullableText(fields[ORDER_FIELDS.PHONE]);
    const orderOwner = nullableText(fields[ORDER_FIELDS.SALES_OWNER]);
    const syncStatus = normalizeSyncStatus(fields, channel);
    const paymentReviewAvailable =
        !getLarkBoolean(fields[ORDER_FIELDS.PAYMENT_VERIFIED], false) &&
        (
            getLarkAttachmentTokens(fields[ORDER_FIELDS.SLIP_ATTACHMENT]).length > 0 ||
            Boolean(getLarkText(fields[ORDER_FIELDS.SLIP_IMAGE_URL], "").trim()) ||
            getLarkNumber(fields[ORDER_FIELDS.SLIP_AMOUNT], 0) > 0 ||
            Boolean(getLarkText(fields[ORDER_FIELDS.SLIP_BANK], "").trim())
        );

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
        payment_status: normalizePaymentStatus(fields[ORDER_FIELDS.PAYMENT_STATUS]),
        address: nullableText(fields[ORDER_FIELDS.ADDRESS]),
        tracking_number: nullableText(fields[ORDER_FIELDS.TRACKING_NUMBER]),
        payment_verified: getLarkBoolean(fields[ORDER_FIELDS.PAYMENT_VERIFIED], false),
        payment_review_available: paymentReviewAvailable,
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

    return (
        (!search || text.includes(search)) &&
        (!query.channel || item.channel === query.channel) &&
        (!query.order_status || item.order_status === query.order_status) &&
        (!query.payment_status || item.payment_status === query.payment_status)
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
    const allItems = data.orders.map((record) => mapOrder(record, customers));
    const prepared = sortOrders(allItems.filter((item) => matchesQuery(item, query)), query.sort);
    const totalPages = Math.max(1, Math.ceil(prepared.length / query.page_size));
    const safePage = Math.min(query.page, totalPages);
    const start = (safePage - 1) * query.page_size;

    return {
        items: prepared.slice(start, start + query.page_size),
        summary: {
            total_orders: allItems.length,
            pending_payment_orders: allItems.filter((item) => item.payment_status === "Pending").length,
            paid_orders: allItems.filter((item) => item.payment_status === "Paid").length,
            needs_attention_orders: allItems.filter((item) =>
                item.payment_status === "Overdue" || item.sync_status === "failed"
            ).length,
        },
        total: prepared.length,
        page: safePage,
        page_size: query.page_size,
        total_pages: totalPages,
        updated_at: new Date().toISOString(),
    };
}

export async function getOrderDetail(
    env: Env,
    orderId: string
): Promise<OrderRecordResponse | null> {
    const data = await loadOrderReadData(env);
    const record = data.orders.find((item) => item.record_id === orderId);
    if (!record) return null;
    return mapOrder(record, buildCustomerLookup(data.customers));
}
