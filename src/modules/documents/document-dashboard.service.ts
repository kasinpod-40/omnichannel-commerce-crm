import type { Env } from "../../config/env";
import { updateLarkRecord } from "../../providers/lark/lark.provider";
import { ACTIVITY_FIELDS, ORDER_FIELDS } from "../../core/lark-fields";
import {
    getFirstLinkedRecordId,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { AuthError } from "../auth/auth.error";
import {
    findActivityByEventId,
    listActivities,
    type LarkActivityRecord,
} from "../activities/activity.repository";
import { recordActivityOnce } from "../activities/activity.service";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";
import { getDashboardOrders } from "../dashboard-read/dashboard-read.records";
import { readTimestamp, toIso } from "../dashboard-read/dashboard-read.shared";
import { getOrderByRecordId, type LarkOrderRecord } from "../orders/order.repository";
import { resolveOrderBusinessIdentity } from "../orders/order-business-identity";
import {
    createSignedDocumentLink,
    generateAndSaveDocumentLink,
} from "./document-link.service";
import {
    buildDocumentNumberFromRecord,
    buildDocumentViewModelFromRecord,
} from "./document.service";
import type { DocumentType, DocumentViewModel } from "./document.types";

const DOCUMENT_FIELDS: Record<DocumentType, string> = {
    quotation: ORDER_FIELDS.QUOTATION_URL,
    invoice: ORDER_FIELDS.INVOICE_URL,
    "tax-invoice": ORDER_FIELDS.TAX_INVOICE_URL,
};
const DOCUMENT_TYPES: readonly DocumentType[] = [
    "quotation",
    "invoice",
    "tax-invoice",
];
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9:_-]{8,120}$/;

export type DashboardDocumentStatus = "ready" | "expired";

export type DashboardDocumentListItem = {
    document_id: string;
    document_number: string;
    document_type: DocumentType;
    customer_name: string;
    order_id: string;
    order_number: string;
    amount: number;
    currency: string;
    status: DashboardDocumentStatus;
    created_at: string;
    updated_at: string;
    preview_url: string | null;
};

export type DashboardDocumentListQuery = {
    search: string;
    type: DocumentType | null;
    status: DashboardDocumentStatus | null;
    date_from_ms: number | null;
    date_to_ms: number | null;
    order_id: string;
    order_number: string;
    page: number;
    page_size: number;
};

export type DashboardDocumentListResponse = {
    items: DashboardDocumentListItem[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
    updated_at: string;
};

export type DashboardDocumentDetail = DashboardDocumentListItem & {
    model: DocumentViewModel;
    history: Array<{
        action: string;
        created_at: string;
        actor_name: string | null;
        result: string | null;
    }>;
};

type HyperlinkValue = { text?: unknown; link?: unknown; url?: unknown };

function readHyperlink(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return /^https?:\/\//i.test(trimmed) ? trimmed : null;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            const link = readHyperlink(item);
            if (link) return link;
        }
        return null;
    }
    if (typeof value === "object") {
        const record = value as HyperlinkValue;
        for (const candidate of [record.link, record.url]) {
            if (typeof candidate === "string" && /^https?:\/\//i.test(candidate.trim())) {
                return candidate.trim();
            }
        }
    }
    return null;
}

function documentId(orderId: string, type: DocumentType): string {
    return `${orderId}:${type}`;
}

function documentStatus(url: string, now = Date.now()): DashboardDocumentStatus {
    try {
        const expires = Number(new URL(url).searchParams.get("expires"));
        return Number.isFinite(expires) && expires > 0 && expires <= now ? "expired" : "ready";
    } catch {
        return "ready";
    }
}

function activityDocumentType(activity: LarkActivityRecord): string {
    const value = getLarkText(activity.fields[ACTIVITY_FIELDS.NEW_VALUE], "");
    if (!value) return "";
    try {
        const parsed = JSON.parse(value) as { document_type?: unknown };
        return typeof parsed.document_type === "string" ? parsed.document_type : "";
    } catch {
        return "";
    }
}

function activityOrderId(activity: LarkActivityRecord): string {
    const value = getLarkText(activity.fields[ACTIVITY_FIELDS.NEW_VALUE], "");
    if (!value) return "";
    try {
        const parsed = JSON.parse(value) as { order_record_id?: unknown };
        return typeof parsed.order_record_id === "string" ? parsed.order_record_id : "";
    } catch {
        return "";
    }
}


function documentActivitySummary(activity: LarkActivityRecord): { actor_name: string | null; result: string | null } {
    const value = getLarkText(activity.fields[ACTIVITY_FIELDS.NEW_VALUE], "");
    if (!value) return { actor_name: null, result: null };
    try {
        const parsed = JSON.parse(value) as {
            actor?: { name?: unknown };
            result?: unknown;
        };
        return {
            actor_name: typeof parsed.actor?.name === "string"
                ? parsed.actor.name.trim() || null
                : null,
            result: parsed.result === "success" || parsed.result === "failed"
                ? parsed.result
                : null,
        };
    } catch {
        return { actor_name: null, result: null };
    }
}

function matchingDocumentActivities(
    activities: readonly LarkActivityRecord[],
    orderId: string,
    type: DocumentType
): LarkActivityRecord[] {
    return activities
        .filter((activity) =>
            getLarkText(activity.fields[ACTIVITY_FIELDS.ACTION], "") === "DOCUMENT_CREATED" &&
            activityOrderId(activity) === orderId &&
            activityDocumentType(activity) === type
        )
        .sort((left, right) =>
            readTimestamp(right.fields[ACTIVITY_FIELDS.CREATED_AT]) -
            readTimestamp(left.fields[ACTIVITY_FIELDS.CREATED_AT])
        );
}

function mapExistingDocument(
    env: Env,
    order: LarkOrderRecord,
    type: DocumentType,
    url: string,
    activities: readonly LarkActivityRecord[]
): DashboardDocumentListItem {
    let model: DocumentViewModel | null = null;
    try {
        model = buildDocumentViewModelFromRecord(env, order, type);
    } catch (error) {
        // เอกสารที่สร้างไว้ยังต้องปรากฏใน List เพื่อให้ผู้ใช้ลบได้ แม้ข้อมูลภาษีภายหลังไม่ครบ
        console.error("Document list uses safe fallback", {
            document_type: type,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    const identity = resolveOrderBusinessIdentity(
        order.fields,
        getLarkText(order.fields[ORDER_FIELDS.CHANNEL], "LINE")
    );
    const safeOrderNumber = identity.displayOrderNumber || "-";
    const matches = matchingDocumentActivities(activities, order.record_id, type);
    const orderCreatedAt = readTimestamp(order.fields[ORDER_FIELDS.CREATED_AT]);
    const orderUpdatedAt = readTimestamp(order.fields[ORDER_FIELDS.UPDATED_AT], orderCreatedAt);
    const latestActivityAt = matches[0]
        ? readTimestamp(matches[0].fields[ACTIVITY_FIELDS.CREATED_AT])
        : 0;
    const earliestActivityAt = matches.at(-1)
        ? readTimestamp(matches.at(-1)!.fields[ACTIVITY_FIELDS.CREATED_AT])
        : 0;
    return {
        document_id: documentId(order.record_id, type),
        document_number: model?.document_number ?? buildDocumentNumberFromRecord(order, type),
        document_type: type,
        customer_name: model?.customer.name ?? (
            getLarkText(order.fields[ORDER_FIELDS.TAX_NAME], "") ||
            getLarkText(order.fields[ORDER_FIELDS.CUSTOMER_NAME], "-") ||
            "-"
        ),
        order_id: order.record_id,
        order_number: model?.order.order_number ?? safeOrderNumber,
        amount: model?.grand_total ?? Math.max(0, getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0)),
        currency: model?.order.currency ?? (getLarkText(order.fields[ORDER_FIELDS.CURRENCY], "THB") || "THB"),
        status: documentStatus(url),
        created_at: toIso(earliestActivityAt || orderUpdatedAt || orderCreatedAt),
        updated_at: toIso(latestActivityAt || orderUpdatedAt || orderCreatedAt),
        preview_url: url,
    };
}

async function loadDocuments(env: Env): Promise<{
    orders: LarkOrderRecord[];
    activities: LarkActivityRecord[];
}> {
    const [orders, activities] = await Promise.all([
        getDashboardOrders(env),
        listActivities(env),
    ]);
    return { orders, activities };
}

export async function getDashboardDocumentList(
    env: Env,
    query: DashboardDocumentListQuery
): Promise<DashboardDocumentListResponse> {
    const { orders, activities } = await loadDocuments(env);
    const items: DashboardDocumentListItem[] = [];
    for (const order of orders) {
        for (const type of DOCUMENT_TYPES) {
            const url = readHyperlink(order.fields[DOCUMENT_FIELDS[type]]);
            if (!url) continue;
            try {
                items.push(mapExistingDocument(env, order, type, url, activities));
            } catch (error) {
                console.error("Document list item skipped", {
                    order_id: order.record_id,
                    document_type: type,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    const search = query.search.trim().toLocaleLowerCase("th-TH");
    const filtered = items.filter((item) => {
        const eventAt = Date.parse(item.created_at);
        return (
            (!search || [
                item.document_number,
                item.customer_name,
                item.order_number,
            ].join(" ").toLocaleLowerCase("th-TH").includes(search)) &&
            (!query.type || item.document_type === query.type) &&
            (!query.status || item.status === query.status) &&
            (!query.order_id || item.order_id === query.order_id) &&
            (!query.order_number || item.order_number.toLocaleLowerCase("th-TH").includes(query.order_number.trim().toLocaleLowerCase("th-TH"))) &&
            (query.date_from_ms === null || eventAt >= query.date_from_ms) &&
            (query.date_to_ms === null || eventAt < query.date_to_ms)
        );
    }).sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));

    const totalPages = Math.max(1, Math.ceil(filtered.length / query.page_size));
    const safePage = Math.min(query.page, totalPages);
    const start = (safePage - 1) * query.page_size;
    return {
        items: filtered.slice(start, start + query.page_size),
        total: filtered.length,
        page: safePage,
        page_size: query.page_size,
        total_pages: totalPages,
        updated_at: new Date().toISOString(),
    };
}


type LocatedDashboardDocument = {
    order: LarkOrderRecord;
    type: DocumentType;
    url: string;
    documentNumber: string;
};

function locateDocumentByNumber(
    _env: Env,
    orders: readonly LarkOrderRecord[],
    documentNumber: string
): LocatedDashboardDocument | null {
    const normalized = documentNumber.trim().toLocaleLowerCase("th-TH");
    if (!normalized) return null;

    for (const order of orders) {
        for (const type of DOCUMENT_TYPES) {
            const url = readHyperlink(order.fields[DOCUMENT_FIELDS[type]]);
            if (!url) continue;
            const candidateNumber = buildDocumentNumberFromRecord(order, type);
            if (candidateNumber.toLocaleLowerCase("th-TH") === normalized) {
                return { order, type, url, documentNumber: candidateNumber };
            }
        }
    }
    return null;
}

async function previewDashboardDocumentFromOrder(
    env: Env,
    requestUrl: string,
    order: LarkOrderRecord,
    type: DocumentType,
    activities: readonly LarkActivityRecord[]
): Promise<DashboardDocumentDetail> {
    const model = buildDocumentViewModelFromRecord(env, order, type);
    const generated = await createSignedDocumentLink({
        env,
        requestUrl,
        orderRecordId: order.record_id,
        documentType: type,
        expiresMinutes: 60,
        validateDocument: false,
    });
    const matches = matchingDocumentActivities(activities, order.record_id, type);
    const existingUrl = readHyperlink(order.fields[DOCUMENT_FIELDS[type]]);
    const base = mapExistingDocument(
        env,
        order,
        type,
        existingUrl ?? generated.url,
        activities
    );
    return {
        ...base,
        status: existingUrl ? documentStatus(existingUrl) : "ready",
        preview_url: generated.url,
        model,
        history: matches.map((activity) => ({
            action: "created",
            created_at: toIso(readTimestamp(activity.fields[ACTIVITY_FIELDS.CREATED_AT])),
            ...documentActivitySummary(activity),
        })),
    };
}

export async function previewDashboardDocument(
    env: Env,
    requestUrl: string,
    orderId: string,
    type: DocumentType
): Promise<DashboardDocumentDetail> {
    const [order, activities] = await Promise.all([
        getOrderByRecordId(env, orderId),
        listActivities(env),
    ]);
    if (!order) throw new AuthError("ORDER_NOT_FOUND", "Order was not found", 404);
    return previewDashboardDocumentFromOrder(env, requestUrl, order, type, activities);
}

export async function getDashboardDocumentByNumber(
    env: Env,
    documentNumber: string
): Promise<DashboardDocumentDetail | null> {
    const { orders, activities } = await loadDocuments(env);
    const located = locateDocumentByNumber(env, orders, documentNumber);
    if (!located) return null;

    // Detail ต้องเปิดได้แม้ระบบ Signed URL ขัดข้อง เพื่อให้ผู้ใช้ยังตรวจข้อมูลหรือลบเอกสารเสียได้
    const model = buildDocumentViewModelFromRecord(env, located.order, located.type);
    const base = mapExistingDocument(env, located.order, located.type, located.url, activities);
    const matches = matchingDocumentActivities(activities, located.order.record_id, located.type);
    return {
        ...base,
        preview_url: null,
        model,
        history: matches.map((activity) => ({
            action: "created",
            created_at: toIso(readTimestamp(activity.fields[ACTIVITY_FIELDS.CREATED_AT])),
            ...documentActivitySummary(activity),
        })),
    };
}

export async function refreshDashboardDocumentPreviewByNumber(
    env: Env,
    requestUrl: string,
    documentNumber: string
): Promise<DashboardDocumentDetail | null> {
    const { orders, activities } = await loadDocuments(env);
    const located = locateDocumentByNumber(env, orders, documentNumber);
    if (!located) return null;
    // Signed URL สร้างเฉพาะตอนผู้ใช้กดเปิดเอกสาร จึงไม่ผูกการเปิด Drawer กับอายุลิงก์เดิม
    return previewDashboardDocumentFromOrder(
        env,
        requestUrl,
        located.order,
        located.type,
        activities
    );
}

export async function deleteDashboardDocument(input: {
    env: Env;
    documentNumber: string;
    idempotencyKey: string;
    actor: { userId: string; name: string; role: string };
}): Promise<{ deleted: true; document_number: string; idempotent: boolean }> {
    if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
        throw new AuthError(
            "IDEMPOTENCY_KEY_INVALID",
            "A valid idempotency key is required",
            400
        );
    }

    const eventId = `document-delete:${input.idempotencyKey}`;
    if (await findActivityByEventId(input.env, eventId)) {
        return { deleted: true, document_number: input.documentNumber, idempotent: true };
    }

    const orders = await getDashboardOrders(input.env);
    const located = locateDocumentByNumber(input.env, orders, input.documentNumber);
    if (!located) {
        throw new AuthError("DOCUMENT_NOT_FOUND", "Document was not found", 404);
    }
    const customerId = getFirstLinkedRecordId(located.order.fields[ORDER_FIELDS.CUSTOMER]);
    if (!customerId) {
        throw new AuthError(
            "ORDER_CUSTOMER_MISSING",
            "The order is not linked to a customer",
            409
        );
    }

    await updateLarkRecord(
        input.env,
        input.env.ORDERS_TABLE_ID,
        located.order.record_id,
        {
            [DOCUMENT_FIELDS[located.type]]: null,
            [ORDER_FIELDS.UPDATED_AT]: Date.now(),
        }
    );
    await recordActivityOnce(input.env, {
        event_id: eventId,
        customer_record_id: customerId,
        action: "DOCUMENT_DELETED",
        old_value: {
            document_number: located.documentNumber,
            document_type: located.type,
        },
        new_value: {
            order_record_id: located.order.record_id,
            document_type: located.type,
            document_number: located.documentNumber,
            actor: input.actor,
            result: "success",
        },
    });
    clearDashboardReadCache();
    return {
        deleted: true,
        document_number: located.documentNumber,
        idempotent: false,
    };
}

export async function createDashboardDocument(input: {
    env: Env;
    requestUrl: string;
    orderId: string;
    type: DocumentType;
    idempotencyKey: string;
    actor: { userId: string; name: string; role: string };
}): Promise<{ document: DashboardDocumentDetail; idempotent: boolean }> {
    if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
        throw new AuthError(
            "IDEMPOTENCY_KEY_INVALID",
            "A valid idempotency key is required",
            400
        );
    }
    const eventId = `document-create:${input.idempotencyKey}`;
    const existingActivity = await findActivityByEventId(input.env, eventId);
    if (existingActivity) {
        return {
            document: await previewDashboardDocument(
                input.env,
                input.requestUrl,
                input.orderId,
                input.type
            ),
            idempotent: true,
        };
    }

    const order = await getOrderByRecordId(input.env, input.orderId);
    if (!order) throw new AuthError("ORDER_NOT_FOUND", "Order was not found", 404);
    const customerId = getFirstLinkedRecordId(order.fields[ORDER_FIELDS.CUSTOMER]);
    if (!customerId) {
        throw new AuthError(
            "ORDER_CUSTOMER_MISSING",
            "The order is not linked to a customer",
            409
        );
    }

    const generated = await generateAndSaveDocumentLink({
        env: input.env,
        requestUrl: input.requestUrl,
        orderRecordId: input.orderId,
        documentType: input.type,
        expiresMinutes: 1440,
    });
    await recordActivityOnce(input.env, {
        event_id: eventId,
        customer_record_id: customerId,
        action: "DOCUMENT_CREATED",
        old_value: null,
        new_value: {
            order_record_id: input.orderId,
            document_type: input.type,
            document_number: buildDocumentViewModelFromRecord(
                input.env,
                order,
                input.type
            ).document_number,
            url: generated.url,
            actor: input.actor,
            result: "success",
        },
    });
    clearDashboardReadCache();
    return {
        document: await previewDashboardDocument(
            input.env,
            input.requestUrl,
            input.orderId,
            input.type
        ),
        idempotent: false,
    };
}
