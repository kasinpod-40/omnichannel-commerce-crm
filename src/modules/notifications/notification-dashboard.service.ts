import type { Env } from "../../config/env";
import { NOTIFICATION_FIELDS } from "../../core/lark-fields";
import {
    getFirstLinkedRecordId,
    getLarkText,
} from "../../utils/lark-field-value";
import {
    buildCustomerLookup,
    normalizeChannel,
    readTimestamp,
    toIso,
    unknownCustomer,
} from "../dashboard-read/dashboard-read.shared";
import { getDashboardCustomers } from "../dashboard-read/dashboard-read.records";
import {
    getNotificationByRecordId,
    listNotifications,
    type LarkNotificationRecord,
} from "./notification.repository";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";
import { getDashboardNotifications } from "../dashboard-read/dashboard-read.records";
import {
    getLastEventPart,
    isNotificationType,
    markNotificationDashboardRead,
    markPaymentReviewNotificationResolved,
    parseNotificationSnapshot,
} from "./notification.service";
import type {
    NotificationStatus,
    NotificationType,
} from "./notification.types";

export type NotificationReadFilter = "all" | "unread" | "read";

export type NotificationListQuery = {
    search: string;
    type: NotificationType | null;
    read: NotificationReadFilter;
    page: number;
    page_size: number;
};

export type NotificationListItemResponse = {
    notification_id: string;
    event_id: string;
    notification_type: NotificationType;
    status: NotificationStatus;
    is_read: boolean;
    message: string;
    customer: {
        customer_id: string;
        customer_name: string;
        channel: string;
    };
    order_record_id: string | null;
    order_number: string | null;
    amount: number;
    slip_amount: number;
    payment_status: string | null;
    order_status: string | null;
    created_at: string;
    sent_at: string | null;
    error_message: string | null;
};

export type NotificationListResponse = {
    items: NotificationListItemResponse[];
    summary: {
        total: number;
        unread: number;
        payment_review: number;
        failed: number;
    };
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    updated_at: string;
};

function normalizeStatus(value: unknown): NotificationStatus {
    const normalized = getLarkText(value, "Pending").trim();
    if (normalized === "Sent" || normalized === "Read" || normalized === "Failed") {
        return normalized;
    }
    return "Pending";
}

function fallbackType(value: unknown): NotificationType {
    const normalized = getLarkText(value, "").trim();
    return isNotificationType(normalized) ? normalized : "NEW_LEAD";
}

/** Dashboard Notification Center แสดงเฉพาะงานตรวจสอบการชำระเงินตามขอบเขต UX ปัจจุบัน */
function isPaymentReviewRecord(record: LarkNotificationRecord): boolean {
    return fallbackType(
        record.fields[NOTIFICATION_FIELDS.NOTIFICATION_TYPE]
    ) === "PAYMENT_REVIEW";
}

function isDashboardRead(record: LarkNotificationRecord): boolean {
    const status = normalizeStatus(record.fields[NOTIFICATION_FIELDS.STATUS]);
    const snapshot = parseNotificationSnapshot(record);
    return status === "Read" || Boolean(snapshot?.dashboard_read_at);
}

function resolveOrderRecordId(
    record: LarkNotificationRecord,
    type: NotificationType
): string | null {
    if (type !== "PAYMENT_REVIEW" && type !== "PAYMENT_VERIFIED") {
        return null;
    }

    const snapshot = parseNotificationSnapshot(record);
    if (!snapshot || snapshot.captured_at <= 0 || !snapshot.order_number) {
        return null;
    }

    const eventId = getLarkText(
        record.fields[NOTIFICATION_FIELDS.EVENT_ID],
        ""
    ).trim();
    return getLastEventPart(eventId) || null;
}

function mapNotification(
    record: LarkNotificationRecord,
    customers: ReturnType<typeof buildCustomerLookup>
): NotificationListItemResponse {
    const fields = record.fields;
    const type = fallbackType(fields[NOTIFICATION_FIELDS.NOTIFICATION_TYPE]);
    const status = normalizeStatus(fields[NOTIFICATION_FIELDS.STATUS]);
    const parsedSnapshot = parseNotificationSnapshot(record);
    const snapshot = parsedSnapshot && parsedSnapshot.captured_at > 0
        ? parsedSnapshot
        : null;
    const customerId = getFirstLinkedRecordId(fields[NOTIFICATION_FIELDS.CUSTOMER]) ?? "";
    const customer = customers.get(customerId) ?? unknownCustomer(customerId, "LINE");
    const createdAt = readTimestamp(fields[NOTIFICATION_FIELDS.CREATED_AT]);
    const sentAt = readTimestamp(fields[NOTIFICATION_FIELDS.SENT_AT]);

    return {
        notification_id: record.record_id,
        event_id: getLarkText(fields[NOTIFICATION_FIELDS.EVENT_ID], "").trim(),
        notification_type: type,
        status,
        is_read: isDashboardRead(record),
        message: getLarkText(fields[NOTIFICATION_FIELDS.MESSAGE], "").trim(),
        customer: {
            customer_id: customer.customer_id,
            customer_name:
                snapshot?.customer_name?.trim() ||
                customer.customer_name ||
                "ไม่ทราบชื่อลูกค้า",
            channel: normalizeChannel(
                snapshot?.channel || customer.channel
            ),
        },
        order_record_id: resolveOrderRecordId(record, type),
        order_number: snapshot?.order_number?.trim() || null,
        amount: Math.max(0, snapshot?.total_amount ?? 0),
        slip_amount: Math.max(0, snapshot?.slip_amount ?? 0),
        payment_status: snapshot?.payment_status?.trim() || null,
        order_status: snapshot?.order_status?.trim() || null,
        created_at: toIso(createdAt),
        sent_at: sentAt > 0 ? toIso(sentAt) : null,
        error_message: status === "Failed" ? "NOTIFICATION_DELIVERY_FAILED" : null,
    };
}

function matchesQuery(
    item: NotificationListItemResponse,
    query: NotificationListQuery
): boolean {
    const search = query.search.trim().toLocaleLowerCase("th-TH");
    const haystack = [
        item.notification_id,
        item.event_id,
        item.message,
        item.customer.customer_name,
        item.customer.channel,
        item.order_record_id ?? "",
        item.order_number ?? "",
    ]
        .join(" ")
        .toLocaleLowerCase("th-TH");

    return (
        (!search || haystack.includes(search)) &&
        (!query.type || item.notification_type === query.type) &&
        (query.read === "all" ||
            (query.read === "read" ? item.is_read : !item.is_read))
    );
}

export async function getNotificationList(
    env: Env,
    query: NotificationListQuery
): Promise<NotificationListResponse> {
    const [records, customerRecords] = await Promise.all([
        getDashboardNotifications(env),
        getDashboardCustomers(env),
    ]);
    const customers = buildCustomerLookup(customerRecords);
    const allItems = records
        .filter(isPaymentReviewRecord)
        .map((record) => mapNotification(record, customers))
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
    const filtered = allItems.filter((item) => matchesQuery(item, query));
    const totalPages = Math.max(1, Math.ceil(filtered.length / query.page_size));
    const safePage = Math.min(query.page, totalPages);
    const start = (safePage - 1) * query.page_size;

    return {
        items: filtered.slice(start, start + query.page_size),
        summary: {
            total: allItems.length,
            unread: allItems.filter((item) => !item.is_read).length,
            payment_review: allItems.filter(
                (item) => item.notification_type === "PAYMENT_REVIEW" && !item.is_read
            ).length,
            failed: allItems.filter((item) => item.status === "Failed").length,
        },
        total: filtered.length,
        page: safePage,
        page_size: query.page_size,
        total_pages: totalPages,
        updated_at: new Date().toISOString(),
    };
}

export async function getNotificationUnreadCount(env: Env): Promise<number> {
    const records = await getDashboardNotifications(env);
    return records.filter(
        (record) => isPaymentReviewRecord(record) && !isDashboardRead(record)
    ).length;
}

export async function markNotificationRead(
    env: Env,
    notificationId: string
): Promise<{ notification_id: string; is_read: true }> {
    const normalizedId = notificationId.trim();
    if (!normalizedId) {
        throw new Error("notification_id is required");
    }
    const record = await getNotificationByRecordId(env, normalizedId);
    if (!record) {
        throw new Error(`Notification not found: ${normalizedId}`);
    }
    if (!isPaymentReviewRecord(record)) {
        throw new Error(`Notification is not a payment review: ${normalizedId}`);
    }
    await markNotificationDashboardRead(env, record);
    clearDashboardReadCache("dashboard-records:notifications");
    return { notification_id: normalizedId, is_read: true };
}

export async function markAllNotificationsRead(
    env: Env
): Promise<{ updated: number }> {
    const records = await listNotifications(env);
    const unread = records.filter(
        (record) => isPaymentReviewRecord(record) && !isDashboardRead(record)
    );

    let updated = 0;
    for (const record of unread) {
        await markNotificationDashboardRead(env, record);
        updated += 1;
    }

    clearDashboardReadCache("dashboard-records:notifications");
    return { updated };
}

/** ปิด Notification PAYMENT_REVIEW ของ Order เดียวกันหลัง Approve/Reject */
export async function markPaymentReviewNotificationsRead(
    env: Env,
    orderRecordId: string
): Promise<number> {
    const records = await listNotifications(env);
    let updated = 0;

    for (const record of records) {
        const type = fallbackType(record.fields[NOTIFICATION_FIELDS.NOTIFICATION_TYPE]);
        if (type !== "PAYMENT_REVIEW") continue;
        if (resolveOrderRecordId(record, type) !== orderRecordId) continue;
        if (normalizeStatus(record.fields[NOTIFICATION_FIELDS.STATUS]) === "Read") continue;
        await markPaymentReviewNotificationResolved(env, record);
        updated += 1;
    }

    clearDashboardReadCache("dashboard-records:notifications");
    return updated;
}
