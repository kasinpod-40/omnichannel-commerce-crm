import type { Env } from "../../config/env";
import type { SalesStage } from "../../core/sales-stage";
import { normalizeLeadScore } from "../../core/lead-score";
import {
    ACTIVITY_FIELDS,
    CONVERSATION_FIELDS,
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
} from "../../core/lark-fields";
import {
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
    getLinkedRecordIds,
} from "../../utils/lark-field-value";
import {
    normalizeChannel,
    normalizeCustomerStage,
    nullableText,
    readTimestamp,
    toIso,
} from "../dashboard-read/dashboard-read.shared";
import type { DashboardChannel } from "../dashboard-read/dashboard-read.types";
import { listActivities } from "../activities/activity.repository";
import { listConversations } from "../conversations/conversation.repository";
import { findOrdersByCustomer } from "../orders/order.repository";
import {
    getCustomerByRecordId,
    listCustomers,
    type LarkCustomerRecord,
} from "./customer.repository";
import type { CustomerStage } from "./customer.types";

/** ภาษาใช้เฉพาะข้อความ Timeline ที่ Backend สร้างขึ้น ไม่แก้ข้อมูลจริงจาก Lark */
export type CustomerDashboardLanguage = "th" | "en";

export type CustomerDashboardChannel = DashboardChannel;

export type CustomerListItemResponse = {
    customer_id: string;
    customer_name: string;
    channel: CustomerDashboardChannel;
    channel_customer_id: string;
    phone: string | null;
    current_stage: CustomerStage;
    lead_score: number;
    hot_lead: boolean;
    ai_summary: string | null;
    last_message: string | null;
    message_count: number;
    sales_owner: string | null;
    active_pipeline_id: string | null;
    active_order_id: string | null;
    created_at: string;
    updated_at: string;
};

export type CustomerListResponse = {
    items: CustomerListItemResponse[];
    summary: {
        total_customers: number;
        hot_leads: number;
        closing_customers: number;
        unassigned_customers: number;
    };
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    updated_at: string;
};

export type CustomerTimelineItemResponse = {
    id: string;
    type: "message" | "stage" | "order" | "payment";
    title: string;
    detail: string;
    created_at: string;
};

export type CustomerDetailResponse = CustomerListItemResponse & {
    product_name: string | null;
    delivery_address: string | null;
    timeline: CustomerTimelineItemResponse[];
};

export type CustomerListQuery = {
    search: string;
    channel: string | null;
    stage: SalesStage | null;
    hot_lead: boolean | null;
    sort: "updated_desc" | "lead_score_desc" | "name_asc";
    page: number;
    page_size: number;
};

type LarkRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

/** แปลง Record จาก Lark ให้ตรง Contract snake_case ที่ Frontend mapper รออยู่ */
function mapCustomer(record: LarkCustomerRecord): CustomerListItemResponse {
    const fields = record.fields;
    const createdAt = readTimestamp(fields[CUSTOMER_FIELDS.CREATED_AT]);
    const updatedAt = readTimestamp(fields[CUSTOMER_FIELDS.UPDATED_AT]) || createdAt;

    return {
        // ระบบปัจจุบันยังไม่มี business customer_id แยก จึงใช้ Lark record_id เป็น Detail URL ที่เชื่อถือได้
        customer_id: record.record_id,
        customer_name: getLarkText(fields[CUSTOMER_FIELDS.CUSTOMER_NAME], "").trim(),
        channel: normalizeChannel(fields[CUSTOMER_FIELDS.CHANNEL]),
        channel_customer_id: getLarkText(
            fields[CUSTOMER_FIELDS.CHANNEL_CUSTOMER_ID],
            ""
        ).trim(),
        phone: nullableText(fields[CUSTOMER_FIELDS.PHONE]),
        current_stage: normalizeCustomerStage(fields[CUSTOMER_FIELDS.CURRENT_STAGE]),
        lead_score: normalizeLeadScore(
            getLarkNumber(fields[CUSTOMER_FIELDS.LEAD_SCORE], 0)
        ),
        hot_lead: getLarkBoolean(fields[CUSTOMER_FIELDS.HOT_LEAD], false),
        ai_summary: nullableText(fields[CUSTOMER_FIELDS.AI_SUMMARY]),
        last_message: nullableText(fields[CUSTOMER_FIELDS.LAST_MESSAGE]),
        message_count: Math.max(
            0,
            Math.floor(getLarkNumber(fields[CUSTOMER_FIELDS.MESSAGE_COUNT], 0))
        ),
        sales_owner: nullableText(fields[CUSTOMER_FIELDS.SALES_OWNER]),
        active_pipeline_id: nullableText(
            fields[CUSTOMER_FIELDS.ACTIVE_PIPELINE_ID]
        ),
        active_order_id: nullableText(fields[CUSTOMER_FIELDS.ACTIVE_ORDER_ID]),
        created_at: toIso(createdAt),
        updated_at: toIso(updatedAt, createdAt),
    };
}

function matchesQuery(
    item: CustomerListItemResponse,
    query: CustomerListQuery
): boolean {
    const search = query.search.trim().toLocaleLowerCase("th-TH");
    const searchable = [
        item.customer_id,
        item.customer_name,
        item.channel_customer_id,
        item.phone ?? "",
        item.last_message ?? "",
        item.sales_owner ?? "",
    ]
        .join(" ")
        .toLocaleLowerCase("th-TH");

    return (
        (!search || searchable.includes(search)) &&
        (!query.channel || item.channel === normalizeChannel(query.channel)) &&
        (!query.stage || item.current_stage === query.stage) &&
        (query.hot_lead === null || item.hot_lead === query.hot_lead)
    );
}

function sortCustomers(
    items: CustomerListItemResponse[],
    sort: CustomerListQuery["sort"]
): CustomerListItemResponse[] {
    return [...items].sort((left, right) => {
        if (sort === "lead_score_desc") {
            return right.lead_score - left.lead_score;
        }

        if (sort === "name_asc") {
            return left.customer_name.localeCompare(right.customer_name, "th");
        }

        return Date.parse(right.updated_at) - Date.parse(left.updated_at);
    });
}

/** GET /customers ใช้ Service นี้สำหรับ Filter, Sort และ Pagination หลังอ่าน Lark Base */
export async function getCustomerList(
    env: Env,
    query: CustomerListQuery
): Promise<CustomerListResponse> {
    const records = await listCustomers(env);
    const allItems = records.map(mapCustomer);
    const filteredItems = sortCustomers(
        allItems.filter((item) => matchesQuery(item, query)),
        query.sort
    );
    const totalPages = Math.max(1, Math.ceil(filteredItems.length / query.page_size));
    const safePage = Math.min(query.page, totalPages);
    const start = (safePage - 1) * query.page_size;

    return {
        items: filteredItems.slice(start, start + query.page_size),
        // Summary ตั้งใจคำนวณจากฐานลูกค้าทั้งหมด ไม่เปลี่ยนตาม Filter ของตาราง
        summary: {
            total_customers: allItems.length,
            hot_leads: allItems.filter((item) => item.hot_lead).length,
            closing_customers: allItems.filter(
                (item) => item.current_stage === "Closing"
            ).length,
            unassigned_customers: allItems.filter((item) => {
                const owner = item.sales_owner?.trim().toLowerCase();
                return !owner || owner === "unassigned";
            }).length,
        },
        total: filteredItems.length,
        page: safePage,
        page_size: query.page_size,
        total_pages: totalPages,
        updated_at: new Date().toISOString(),
    };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
    const text = getLarkText(value, "").trim();
    if (!text) return {};

    try {
        const parsed = JSON.parse(text) as unknown;
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

function actionTimelineType(action: string): CustomerTimelineItemResponse["type"] {
    if (action.includes("PAYMENT") || action === "SALE_WON") return "payment";
    if (action.includes("ORDER") || action === "ADDRESS_UPDATED") return "order";
    return "stage";
}

const ACTION_TITLES: Record<string, { th: string; en: string }> = {
    PIPELINE_CREATED: { th: "สร้างกระบวนการขาย", en: "Sales pipeline created" },
    PIPELINE_UPDATED: { th: "อัปเดตกระบวนการขาย", en: "Sales pipeline updated" },
    ORDER_CREATED: { th: "สร้างคำสั่งซื้อ", en: "Order created" },
    ORDER_QUANTITY_UPDATED: { th: "อัปเดตจำนวนสินค้า", en: "Order quantity updated" },
    ADDRESS_UPDATED: { th: "อัปเดตที่อยู่จัดส่ง", en: "Delivery address updated" },
    PHONE_UPDATED: { th: "อัปเดตเบอร์โทร", en: "Phone number updated" },
    PAYMENT_SLIP_RECEIVED: { th: "ได้รับหลักฐานการชำระเงิน", en: "Payment evidence received" },
    PAYMENT_VERIFIED: { th: "ยืนยันการชำระเงิน", en: "Payment verified" },
    SALE_WON: { th: "ปิดการขายสำเร็จ", en: "Sale marked as won" },
    SALE_LOST: { th: "ปิดการขายไม่สำเร็จ", en: "Sale marked as lost" },
    ORDER_CANCELLED: { th: "ยกเลิกคำสั่งซื้อ", en: "Order cancelled" },
    SALES_ASSIGNED: { th: "มอบหมายผู้ดูแลการขาย", en: "Sales owner assigned" },
    PAYMENT_OVERDUE: { th: "เกินกำหนดชำระเงิน", en: "Payment overdue" },
    MARKETPLACE_ORDER_CREATED: { th: "ได้รับคำสั่งซื้อ Marketplace", en: "Marketplace order received" },
    MARKETPLACE_ORDER_UPDATED: { th: "อัปเดตคำสั่งซื้อ Marketplace", en: "Marketplace order updated" },
};

function activityDetail(
    action: string,
    payload: Record<string, unknown>,
    language: CustomerDashboardLanguage
): string {
    const values = [
        getLarkText(payload.stage, "").trim(),
        getLarkText(payload.order_status, "").trim(),
        getLarkText(payload.payment_status, "").trim(),
        getLarkText(payload.sales_owner, "").trim(),
        getLarkText(payload.product_name, "").trim(),
    ].filter(Boolean);

    if (values.length > 0) return values.join(" · ");

    const orderId = getLarkText(payload.order_record_id, "").trim();
    if (orderId) return `Order ${orderId}`;

    return language === "th"
        ? `กิจกรรม ${action}`
        : `Activity ${action}`;
}

function timelineFromConversation(
    record: LarkRecord,
    language: CustomerDashboardLanguage
): CustomerTimelineItemResponse {
    const message = getLarkText(
        record.fields[CONVERSATION_FIELDS.MESSAGE],
        ""
    ).trim();
    const messageType = getLarkText(
        record.fields[CONVERSATION_FIELDS.MESSAGE_TYPE],
        "text"
    ).trim().toLowerCase();

    return {
        id: `message:${record.record_id}`,
        type: "message",
        title: language === "th" ? "ข้อความจากลูกค้า" : "Customer message",
        detail:
            message ||
            (messageType === "image"
                ? language === "th"
                    ? "ลูกค้าส่งรูปภาพ"
                    : "Customer sent an image"
                : language === "th"
                  ? "ไม่มีข้อความ"
                  : "No message content"),
        created_at: toIso(readTimestamp(record.fields[CONVERSATION_FIELDS.CREATED_AT])),
    };
}

function timelineFromActivity(
    record: LarkRecord,
    language: CustomerDashboardLanguage
): CustomerTimelineItemResponse {
    const action = getLarkText(
        record.fields[ACTIVITY_FIELDS.ACTION],
        "UNKNOWN"
    ).trim();
    const payload = parseJsonObject(record.fields[ACTIVITY_FIELDS.NEW_VALUE]);

    return {
        id: `activity:${record.record_id}`,
        type: actionTimelineType(action),
        title:
            ACTION_TITLES[action]?.[language] ??
            (language === "th" ? "อัปเดตข้อมูลลูกค้า" : "Customer updated"),
        detail: activityDetail(action, payload, language),
        created_at: toIso(readTimestamp(record.fields[ACTIVITY_FIELDS.CREATED_AT])),
    };
}

function timelineFromOrder(
    record: LarkRecord,
    language: CustomerDashboardLanguage
): CustomerTimelineItemResponse {
    const orderNumber =
        getLarkText(record.fields[ORDER_FIELDS.ORDER_NUMBER], "").trim() ||
        getLarkText(record.fields[ORDER_FIELDS.EXTERNAL_ORDER_ID], "").trim() ||
        record.record_id;
    const product = getLarkText(
        record.fields[ORDER_FIELDS.PRODUCT_NAME],
        language === "th" ? "ไม่ระบุสินค้า" : "Unspecified product"
    ).trim();
    const quantity = getLarkNumber(record.fields[ORDER_FIELDS.QUANTITY], 0);
    const orderStatus = getLarkText(
        record.fields[ORDER_FIELDS.ORDER_STATUS],
        ""
    ).trim();
    const paymentStatus = getLarkText(
        record.fields[ORDER_FIELDS.PAYMENT_STATUS],
        ""
    ).trim();

    return {
        id: `order:${record.record_id}`,
        type: paymentStatus.toLowerCase() === "paid" ? "payment" : "order",
        title:
            language === "th"
                ? `คำสั่งซื้อ ${orderNumber}`
                : `Order ${orderNumber}`,
        detail: [
            quantity > 0 ? `${product} × ${quantity}` : product,
            orderStatus,
            paymentStatus,
        ]
            .filter(Boolean)
            .join(" · "),
        created_at: toIso(
            readTimestamp(
                record.fields[ORDER_FIELDS.UPDATED_AT],
                readTimestamp(record.fields[ORDER_FIELDS.CREATED_AT])
            )
        ),
    };
}

/** GET /customers/:id สร้าง Customer 360° จาก Customer + Conversation + Activity + Order */
export async function getCustomerDetail(
    env: Env,
    customerRecordId: string,
    language: CustomerDashboardLanguage
): Promise<CustomerDetailResponse | null> {
    const customer = await getCustomerByRecordId(env, customerRecordId);
    if (!customer) return null;

    const [conversations, activities, orders] = await Promise.all([
        listConversations(env),
        listActivities(env),
        findOrdersByCustomer(env, customerRecordId),
    ]);

    const relatedConversations = conversations.filter((record) =>
        getLinkedRecordIds(record.fields[CONVERSATION_FIELDS.CUSTOMER]).includes(
            customerRecordId
        )
    );
    const relatedActivities = activities.filter((record) =>
        getLinkedRecordIds(record.fields[ACTIVITY_FIELDS.CUSTOMER]).includes(
            customerRecordId
        )
    );
    const sortedOrders = [...orders].sort(
        (left, right) =>
            readTimestamp(right.fields[ORDER_FIELDS.UPDATED_AT]) -
            readTimestamp(left.fields[ORDER_FIELDS.UPDATED_AT])
    );
    const latestAddress = nullableText(sortedOrders[0]?.fields[ORDER_FIELDS.ADDRESS]);

    const timeline = [
        ...relatedConversations.map((record) =>
            timelineFromConversation(record, language)
        ),
        ...relatedActivities.map((record) => timelineFromActivity(record, language)),
        ...orders.map((record) => timelineFromOrder(record, language)),
    ]
        .sort(
            (left, right) =>
                Date.parse(right.created_at) - Date.parse(left.created_at)
        )
        .slice(0, 30);

    return {
        ...mapCustomer(customer),
        product_name: nullableText(customer.fields[CUSTOMER_FIELDS.PRODUCT_NAME]),
        delivery_address: latestAddress,
        timeline,
    };
}
