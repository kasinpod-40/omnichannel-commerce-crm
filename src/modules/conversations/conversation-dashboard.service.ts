import type { Env } from "../../config/env";
import { CONVERSATION_FIELDS } from "../../core/lark-fields";
import {
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import {
    buildCustomerLookup,
    buildCustomerSnapshot,
    getLinkedRecordId,
    normalizeChannel,
    nullableText,
    readTimestamp,
    toIso,
    unknownCustomer,
} from "../dashboard-read/dashboard-read.shared";
import type { DashboardCustomerSnapshot } from "../dashboard-read/dashboard-read.types";
import {
    getDashboardConversations,
    getDashboardCustomers,
} from "../dashboard-read/dashboard-read.records";
import { getCustomerByRecordId } from "../customers/customer.repository";
import {
    listConversationsByCustomer,
    type LarkConversationRecord,
} from "./conversation.repository";

export type ConversationIntentResponse =
    | "Just Browsing"
    | "Interested"
    | "Purchase Intent"
    | "Ready To Buy"
    | "Payment"
    | "Support";
export type ConversationProcessStatusResponse = "processed" | "pending" | "failed";

export type ConversationMessageResponse = {
    message_id: string;
    message_type: "text" | "image";
    content: string;
    image_url: string | null;
    created_at: string;
};

export type ConversationMessagePageResponse = {
    items: ConversationMessageResponse[];
    next_cursor: string | null;
    has_more: boolean;
};

export type ConversationListItemResponse = {
    conversation_id: string;
    customer_id: string;
    customer_name: string;
    channel: "LINE" | "Shopee" | "Lazada" | "TikTok Shop";
    message_preview: string;
    last_message_at: string;
    message_count: number;
    intent: ConversationIntentResponse;
    hot_lead: boolean;
    lead_score: number;
    process_status: ConversationProcessStatusResponse;
    assigned_to: string | null;
};

export type ConversationListResponse = {
    items: ConversationListItemResponse[];
    summary: {
        total_customers: number;
        total_messages: number;
        hot_leads: number;
        failed_messages: number;
    };
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    updated_at: string;
};

export type ConversationDetailResponse = ConversationListItemResponse & {
    phone: string | null;
    customer_stage: DashboardCustomerSnapshot["current_stage"];
    ai_summary: string | null;
    active_order_id: string | null;
    messages: ConversationMessageResponse[];
    next_cursor: string | null;
    has_more_messages: boolean;
};

export type ConversationListQuery = {
    search: string;
    intent: ConversationIntentResponse | null;
    process_status: ConversationProcessStatusResponse | null;
    page: number;
    page_size: number;
};

export type ConversationMessageQuery = {
    limit: number;
    before: string | null;
};

type ConversationReadData = {
    customers: Awaited<ReturnType<typeof getDashboardCustomers>>;
    conversations: Awaited<ReturnType<typeof getDashboardConversations>>;
};

type MessageCursor = {
    createdAt: number;
    recordId: string;
};

const DEFAULT_MESSAGE_LIMIT = 20;

async function loadConversationReadData(env: Env): Promise<ConversationReadData> {
    const [customers, conversations] = await Promise.all([
        getDashboardCustomers(env),
        getDashboardConversations(env),
    ]);
    return { customers, conversations };
}

function normalizeIntent(value: unknown): ConversationIntentResponse {
    const text = getLarkText(value, "").trim().toLowerCase();

    if (text.includes("payment") || text.includes("slip")) return "Payment";
    if (text.includes("support") || text.includes("complaint")) return "Support";
    if (text.includes("ready") || text.includes("order") || text.includes("address")) return "Ready To Buy";
    if (text.includes("purchase") || text.includes("price") || text.includes("discount") || text.includes("negotiat")) return "Purchase Intent";
    if (text.includes("interest")) return "Interested";
    return "Just Browsing";
}

function normalizeProcessStatus(value: unknown): ConversationProcessStatusResponse {
    const status = getLarkText(value, "processed").trim().toLowerCase();
    if (status === "failed" || status === "error") return "failed";
    if (status === "pending" || status === "processing") return "pending";
    return "processed";
}

function messageType(record: LarkConversationRecord): "text" | "image" {
    const type = getLarkText(record.fields[CONVERSATION_FIELDS.MESSAGE_TYPE], "text").trim().toLowerCase();
    return type === "image" ? "image" : "text";
}

function messageTimestamp(record: LarkConversationRecord): number {
    return readTimestamp(record.fields[CONVERSATION_FIELDS.CREATED_AT]);
}

function compareMessages(left: LarkConversationRecord, right: LarkConversationRecord): number {
    const timeDifference = messageTimestamp(left) - messageTimestamp(right);
    return timeDifference || left.record_id.localeCompare(right.record_id);
}

function encodeCursor(record: LarkConversationRecord): string {
    const payload = JSON.stringify([messageTimestamp(record), record.record_id]);
    return btoa(payload).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCursor(value: string): MessageCursor {
    try {
        const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
        const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
        const parsed = JSON.parse(atob(`${normalized}${padding}`)) as unknown;
        if (
            !Array.isArray(parsed) ||
            parsed.length !== 2 ||
            !Number.isFinite(parsed[0]) ||
            typeof parsed[1] !== "string" ||
            !parsed[1]
        ) {
            throw new Error("invalid cursor payload");
        }
        return { createdAt: Number(parsed[0]), recordId: parsed[1] };
    } catch {
        throw new Error("INVALID_MESSAGE_CURSOR");
    }
}

function isBeforeCursor(record: LarkConversationRecord, cursor: MessageCursor): boolean {
    const timestamp = messageTimestamp(record);
    return timestamp < cursor.createdAt || (
        timestamp === cursor.createdAt && record.record_id.localeCompare(cursor.recordId) < 0
    );
}

function imageProxyPath(record: LarkConversationRecord): string {
    return `/conversations/images/${encodeURIComponent(record.record_id)}`;
}

function mapMessage(record: LarkConversationRecord): ConversationMessageResponse {
    const type = messageType(record);
    const message = getLarkText(record.fields[CONVERSATION_FIELDS.MESSAGE], "").trim();

    return {
        message_id: getLarkText(
            record.fields[CONVERSATION_FIELDS.EXTERNAL_MESSAGE_ID],
            record.record_id
        ).trim() || record.record_id,
        message_type: type,
        content: message || (type === "image" ? "Image" : ""),
        image_url: type === "image" ? imageProxyPath(record) : null,
        created_at: toIso(messageTimestamp(record)),
    };
}

function createMessagePage(
    records: LarkConversationRecord[],
    query: ConversationMessageQuery
): ConversationMessagePageResponse {
    const lineRecords = records
        .filter((record) => normalizeChannel(record.fields[CONVERSATION_FIELDS.CHANNEL]) === "LINE")
        .sort(compareMessages);
    const cursor = query.before ? decodeCursor(query.before) : null;
    const eligible = cursor
        ? lineRecords.filter((record) => isBeforeCursor(record, cursor))
        : lineRecords;
    const safeLimit = Math.max(1, Math.min(query.limit, 50));
    const start = Math.max(0, eligible.length - safeLimit);
    const pageRecords = eligible.slice(start);
    const hasMore = start > 0;

    return {
        items: pageRecords.map(mapMessage),
        next_cursor: hasMore && pageRecords[0] ? encodeCursor(pageRecords[0]) : null,
        has_more: hasMore,
    };
}

function buildListItem(
    customer: DashboardCustomerSnapshot,
    records: LarkConversationRecord[]
): ConversationListItemResponse {
    const ordered = [...records].sort(compareMessages);
    const latest = ordered.at(-1);
    const latestFields = latest?.fields ?? {};
    const latestMessage = latest
        ? getLarkText(latestFields[CONVERSATION_FIELDS.MESSAGE], "").trim()
        : customer.last_message ?? "";

    return {
        // Conversation ของระบบปัจจุบันคือ Timeline ต่อ Customer จึงใช้ Customer record_id เป็น URL ที่คงที่
        conversation_id: customer.customer_id,
        customer_id: customer.customer_id,
        customer_name: customer.customer_name,
        channel: customer.channel,
        message_preview: latestMessage || customer.last_message || "",
        last_message_at: toIso(
            latest ? messageTimestamp(latest) : customer.updated_at_ms,
            customer.updated_at_ms
        ),
        message_count: Math.max(records.length, customer.message_count),
        intent: normalizeIntent(
            latestFields[CONVERSATION_FIELDS.BUYER_INTENT] ??
            latestFields[CONVERSATION_FIELDS.INTENT]
        ),
        hot_lead: latest
            ? getLarkBoolean(latestFields[CONVERSATION_FIELDS.HOT_LEAD], customer.hot_lead)
            : customer.hot_lead,
        lead_score: Math.min(100, Math.max(0, latest
            ? getLarkNumber(latestFields[CONVERSATION_FIELDS.LEAD_SCORE], customer.lead_score)
            : customer.lead_score)),
        process_status: normalizeProcessStatus(latestFields[CONVERSATION_FIELDS.PROCESS_STATUS]),
        assigned_to: customer.sales_owner,
    };
}

function matchesQuery(item: ConversationListItemResponse, query: ConversationListQuery): boolean {
    const search = query.search.trim().toLocaleLowerCase("th-TH");
    const text = [
        item.customer_id,
        item.customer_name,
        item.message_preview,
        item.assigned_to ?? "",
    ].join(" ").toLocaleLowerCase("th-TH");

    return (
        (!search || text.includes(search)) &&
        (!query.intent || item.intent === query.intent) &&
        (!query.process_status || item.process_status === query.process_status)
    );
}

function groupLineConversations(
    records: LarkConversationRecord[]
): Map<string, LarkConversationRecord[]> {
    const groups = new Map<string, LarkConversationRecord[]>();

    for (const record of records) {
        // Scope หน้า Conversations ปัจจุบันแสดงเฉพาะข้อความขาเข้าจาก LINE OA
        if (normalizeChannel(record.fields[CONVERSATION_FIELDS.CHANNEL]) !== "LINE") continue;
        const customerId = getLinkedRecordId(record.fields[CONVERSATION_FIELDS.CUSTOMER]);
        if (!customerId) continue;
        const items = groups.get(customerId) ?? [];
        items.push(record);
        groups.set(customerId, items);
    }

    return groups;
}

export async function getConversationList(
    env: Env,
    query: ConversationListQuery
): Promise<ConversationListResponse> {
    const data = await loadConversationReadData(env);
    const customerLookup = buildCustomerLookup(data.customers);
    const groups = groupLineConversations(data.conversations);
    const allItems = [...groups.entries()].map(([customerId, records]) =>
        buildListItem(customerLookup.get(customerId) ?? unknownCustomer(customerId), records)
    ).sort((left, right) => Date.parse(right.last_message_at) - Date.parse(left.last_message_at));
    const filteredItems = allItems.filter((item) => matchesQuery(item, query));
    const totalPages = Math.max(1, Math.ceil(filteredItems.length / query.page_size));
    const safePage = Math.min(Math.max(query.page, 1), totalPages);
    const start = (safePage - 1) * query.page_size;

    return {
        items: filteredItems.slice(start, start + query.page_size),
        summary: {
            total_customers: allItems.length,
            total_messages: [...groups.values()].reduce((total, records) => total + records.length, 0),
            hot_leads: allItems.filter((item) => item.hot_lead).length,
            failed_messages: [...groups.values()].reduce(
                (total, records) => total + records.filter((record) =>
                    normalizeProcessStatus(record.fields[CONVERSATION_FIELDS.PROCESS_STATUS]) === "failed"
                ).length,
                0
            ),
        },
        total: filteredItems.length,
        page: safePage,
        page_size: query.page_size,
        total_pages: totalPages,
        updated_at: new Date().toISOString(),
    };
}

export async function getConversationDetail(
    env: Env,
    conversationId: string
): Promise<ConversationDetailResponse | null> {
    // Detail อ่านเฉพาะ Customer และข้อความที่ Link มายัง Customer นี้จาก Lark
    // ไม่โหลด Conversation ทั้งตารางซ้ำเพียงเพื่อเปิด Timeline หนึ่งราย
    const [customerRecord, linkedRecords] = await Promise.all([
        getCustomerByRecordId(env, conversationId),
        listConversationsByCustomer(env, conversationId),
    ]);
    const lineRecords = linkedRecords.filter((record) =>
        normalizeChannel(record.fields[CONVERSATION_FIELDS.CHANNEL]) === "LINE"
    );
    if (lineRecords.length === 0) return null;

    const customer = customerRecord
        ? buildCustomerSnapshot(customerRecord)
        : unknownCustomer(conversationId);
    const latestPage = createMessagePage(lineRecords, {
        limit: DEFAULT_MESSAGE_LIMIT,
        before: null,
    });

    return {
        ...buildListItem(customer, lineRecords),
        phone: customer.phone,
        customer_stage: customer.current_stage,
        ai_summary: customer.ai_summary ?? nullableText(
            [...lineRecords].sort((left, right) => compareMessages(right, left))[0]
                ?.fields[CONVERSATION_FIELDS.AI_SUMMARY]
        ),
        active_order_id: customer.active_order_id,
        messages: latestPage.items,
        next_cursor: latestPage.next_cursor,
        has_more_messages: latestPage.has_more,
    };
}

export async function getConversationMessages(
    env: Env,
    conversationId: string,
    query: ConversationMessageQuery
): Promise<ConversationMessagePageResponse | null> {
    // Cursor timeline จำกัดการอ่านที่ Customer เดียวตั้งแต่ Lark search API
    const linkedRecords = await listConversationsByCustomer(env, conversationId);
    const lineRecords = linkedRecords.filter((record) =>
        normalizeChannel(record.fields[CONVERSATION_FIELDS.CHANNEL]) === "LINE"
    );
    if (lineRecords.length === 0) return null;
    return createMessagePage(lineRecords, query);
}
