import type { Env } from "../../config/env";
import {
    ACTIVITY_FIELDS,
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import {
    SALES_STAGE_VALUES,
    isSalesStage,
    type SalesStage,
} from "../../core/sales-stage";
import {
    getFirstLinkedRecordId,
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import type { LarkActivityRecord } from "../activities/activity.repository";
import type { ActivityAction } from "../activities/activity.types";
import type { LarkCustomerRecord } from "../customers/customer.repository";
import { classifyCustomerWorkQueue } from "../customers/customer-work-queue";
import {
    getDashboardActivities,
    getDashboardCustomers,
    getDashboardOrders,
    getDashboardPipelines,
} from "../dashboard-read/dashboard-read.records";
import type { LarkOrderRecord } from "../orders/order.repository";
import {
    buildOrderActivityIndex,
    classifyOrderWorkQueue,
    type OrderWorkQueue,
} from "../orders/order-work-queue";
import type { LarkPipelineRecord } from "../pipeline/pipeline.repository";
import {
    buildPeriodBuckets,
    defaultDashboardPeriod,
    isInPeriod,
    type DashboardPeriod,
} from "./dashboard-period";

export type DashboardLanguage = "th" | "en";
export type DashboardDataScope = "all" | "line" | "marketplaces";
export type DashboardChannel = "LINE" | "Shopee" | "Lazada" | "TikTok Shop";
export type DashboardOrderStatus =
    | "pending_review"
    | "waiting_new_slip"
    | "waiting_payment"
    | "waiting_delivery"
    | "ready_to_ship"
    | "in_progress"
    | "completed"
    | "cancelled";

export type CommerceDashboardSummary = {
    period: {
        mode: DashboardPeriod["mode"];
        value: string;
        start_at: string;
        end_at: string;
        previous_start_at: string;
        previous_end_at: string;
        granularity: DashboardPeriod["granularity"];
    };
    totals: {
        revenue_thb: number;
        total_leads: number;
        close_rate_percent: number;
        paid_orders: number;
        pending_orders: number;
    };
    changes: {
        revenue_percent: number;
        leads_percent: number;
        close_rate_percent: number;
        paid_orders_percent: number;
        pending_orders_percent: number;
    };
    channels: Array<{
        channel: DashboardChannel;
        orders: number;
        revenue_thb: number;
        share_percent: number;
    }>;
    revenue_trend: {
        granularity: DashboardPeriod["granularity"];
        current_period: Array<{
            key: string;
            revenue_thb: number;
            paid_orders: number;
        }>;
        previous_period: Array<{
            key: string;
            revenue_thb: number;
            paid_orders: number;
        }>;
        change_percent: number;
    };
    action_counts: {
        payment_review: number;
        waiting_new_slip: number;
        waiting_payment: number;
        missing_delivery: number;
        ready_to_ship: number;
        hot_leads: number;
        marketplace_ready_to_ship: number;
        total: number;
    };
    pipeline_stages: Array<{ stage: SalesStage; count: number }>;
    sales_performance: Array<{
        sales_owner: string | null;
        revenue_thb: number;
        paid_orders: number;
        active_leads: number;
        hot_leads: number;
    }>;
    order_statuses: Array<{ status: DashboardOrderStatus; count: number }>;
    recent_activities: Array<{
        id: string;
        title: string;
        detail: string;
        created_at: string;
        type: "lead" | "order" | "payment" | "system";
    }>;
    data_quality: {
        paid_orders_missing_paid_at: number;
        unknown_channel_orders: number;
    };
    updated_at: string;
};

type CachedSummary = { expires_at: number; value: CommerceDashboardSummary };
type ActivityType = CommerceDashboardSummary["recent_activities"][number]["type"];

const SUMMARY_CACHE_MS = 10_000;
const CHANNEL_ORDER: DashboardChannel[] = ["LINE", "TikTok Shop", "Shopee", "Lazada"];
const summaryCache = new Map<string, CachedSummary>();
const pendingSummary = new Map<string, Promise<CommerceDashboardSummary>>();

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function readTimestamp(value: unknown): number {
    const timestamp = getLarkNumber(value, 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
    return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

function percentChange(current: number, previous: number): number {
    if (previous === 0) return current === 0 ? 0 : 100;
    return round2(((current - previous) / previous) * 100);
}

function normalize(value: unknown): string {
    return getLarkText(value, "")
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ");
}

function normalizeChannel(value: unknown): DashboardChannel | null {
    const channel = normalize(value);
    if (channel === "line" || channel === "line oa") return "LINE";
    if (channel === "shopee") return "Shopee";
    if (channel === "lazada") return "Lazada";
    if (["tiktok", "tiktok shop", "tik tok"].includes(channel)) return "TikTok Shop";
    return null;
}

function normalizeSalesOwner(value: unknown): string | null {
    const owner = getLarkText(value, "").trim();
    return !owner || owner.toLowerCase() === "unassigned" ? null : owner;
}

function customerStage(customer: LarkCustomerRecord): SalesStage {
    const stage = getLarkText(
        customer.fields[CUSTOMER_FIELDS.CURRENT_STAGE],
        "New Lead"
    ).trim();
    return isSalesStage(stage) ? stage : "New Lead";
}

function paidAt(order: LarkOrderRecord): number {
    return readTimestamp(order.fields[ORDER_FIELDS.PAID_AT]);
}

function createdAt(record: { fields: Record<string, unknown> }, field: string): number {
    return readTimestamp(record.fields[field]);
}

function isPaid(order: LarkOrderRecord): boolean {
    return (
        getLarkBoolean(order.fields[ORDER_FIELDS.PAYMENT_VERIFIED], false) ||
        normalize(order.fields[ORDER_FIELDS.PAYMENT_STATUS]) === "paid"
    );
}

function pipelineClosedAt(pipeline: LarkPipelineRecord): number {
    // ไม่เดาวันปิดจากวันสร้าง เพราะจะทำให้ Close Rate ย้อนหลังคลาดเคลื่อน
    return readTimestamp(pipeline.fields[PIPELINE_FIELDS.CLOSED_AT]);
}

function closeRate(
    pipelines: readonly LarkPipelineRecord[],
    start: number,
    end: number
): number {
    let won = 0;
    let lost = 0;
    for (const pipeline of pipelines) {
        const status = normalize(pipeline.fields[PIPELINE_FIELDS.STATUS]);
        if (status !== "won" && status !== "lost") continue;
        if (!isInPeriod(pipelineClosedAt(pipeline), start, end)) continue;
        status === "won" ? (won += 1) : (lost += 1);
    }
    return won + lost === 0 ? 0 : round2((won / (won + lost)) * 100);
}

function buildTrend(
    orders: readonly LarkOrderRecord[],
    period: DashboardPeriod
): CommerceDashboardSummary["revenue_trend"] {
    const build = (previous: boolean) => {
        const buckets = buildPeriodBuckets(period, previous).map((bucket) => ({
            ...bucket,
            revenue_thb: 0,
            paid_orders: 0,
        }));
        for (const order of orders) {
            if (!isPaid(order)) continue;
            const eventAt = paidAt(order);
            if (!eventAt) continue;
            const bucket = buckets.find((item) => isInPeriod(eventAt, item.start_at, item.end_at));
            if (!bucket) continue;
            bucket.revenue_thb += Math.max(
                0,
                getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0)
            );
            bucket.paid_orders += 1;
        }
        return buckets.map(({ key, revenue_thb, paid_orders }) => ({
            key,
            revenue_thb: round2(revenue_thb),
            paid_orders,
        }));
    };
    const current = build(false);
    const previous = build(true);
    return {
        granularity: period.granularity,
        current_period: current,
        previous_period: previous,
        change_percent: percentChange(
            current.reduce((sum, item) => sum + item.revenue_thb, 0),
            previous.reduce((sum, item) => sum + item.revenue_thb, 0)
        ),
    };
}

function buildPipelineStages(
    customers: readonly LarkCustomerRecord[]
): CommerceDashboardSummary["pipeline_stages"] {
    const counts = new Map<SalesStage, number>(
        SALES_STAGE_VALUES.map((stage) => [stage, 0])
    );
    for (const customer of customers) {
        const stage = customerStage(customer);
        counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }
    return SALES_STAGE_VALUES.map((stage) => ({ stage, count: counts.get(stage) ?? 0 }));
}

function mapOperationalStatus(
    order: LarkOrderRecord,
    queue: OrderWorkQueue
): DashboardOrderStatus {
    if (queue === "payment_review") return "pending_review";
    if (queue === "waiting_new_slip") return "waiting_new_slip";
    if (queue === "waiting_payment") return "waiting_payment";
    if (queue === "missing_delivery") return "waiting_delivery";
    if (queue === "ready_to_ship" || queue === "marketplace_ready_to_ship") return "ready_to_ship";

    const orderStatus = normalize(order.fields[ORDER_FIELDS.ORDER_STATUS]);
    const marketplaceStatus = normalize(order.fields[ORDER_FIELDS.MARKETPLACE_STATUS]);
    const fulfillment = normalize(order.fields[ORDER_FIELDS.FULFILLMENT_STATUS]);
    if (["cancelled", "canceled", "returned", "refunded", "failed"].includes(orderStatus)) {
        return "cancelled";
    }
    if (["cancelled", "canceled", "returned", "refunded", "failed"].includes(marketplaceStatus)) {
        return "cancelled";
    }
    if (["delivered", "fulfilled"].includes(fulfillment) || ["delivered"].includes(marketplaceStatus)) {
        return "completed";
    }
    if (["processing", "shipped", "in transit", "ready to ship"].includes(marketplaceStatus)) {
        return "in_progress";
    }
    if (isPaid(order)) return "in_progress";
    if (["completed", "delivered"].includes(orderStatus)) return "completed";
    return "waiting_payment";
}

function buildOrderAnalytics(
    customers: readonly LarkCustomerRecord[],
    pipelines: readonly LarkPipelineRecord[],
    orders: readonly LarkOrderRecord[],
    activities: readonly LarkActivityRecord[],
    period: DashboardPeriod
): Pick<CommerceDashboardSummary, "action_counts" | "order_statuses"> {
    const customerMap = new Map(customers.map((item) => [item.record_id, item] as const));
    const activityIndex = buildOrderActivityIndex(activities);
    const queues = new Map<OrderWorkQueue, number>([
        ["payment_review", 0],
        ["waiting_new_slip", 0],
        ["waiting_payment", 0],
        ["missing_delivery", 0],
        ["ready_to_ship", 0],
        ["marketplace_ready_to_ship", 0],
        ["none", 0],
    ]);
    const statusOrder: DashboardOrderStatus[] = [
        "pending_review",
        "waiting_new_slip",
        "waiting_payment",
        "waiting_delivery",
        "ready_to_ship",
        "in_progress",
        "completed",
        "cancelled",
    ];
    const statuses = new Map<DashboardOrderStatus, number>(
        statusOrder.map((status) => [status, 0])
    );

    for (const order of orders) {
        const classification = classifyOrderWorkQueue(
            order,
            customerMap,
            activityIndex.get(order.record_id) ?? []
        );
        queues.set(
            classification.work_queue,
            (queues.get(classification.work_queue) ?? 0) + 1
        );
        const orderCreatedAt = readTimestamp(order.fields[ORDER_FIELDS.CREATED_AT]);
        if (isInPeriod(orderCreatedAt, period.start_at, period.end_at)) {
            const status = mapOperationalStatus(order, classification.work_queue);
            statuses.set(status, (statuses.get(status) ?? 0) + 1);
        }
    }

    const hotLeads = customers.filter(
        (customer) => classifyCustomerWorkQueue(customer, pipelines) === "hot_lead"
    ).length;
    const paymentReview = queues.get("payment_review") ?? 0;
    const waitingNewSlip = queues.get("waiting_new_slip") ?? 0;
    const waitingPayment = queues.get("waiting_payment") ?? 0;
    const missingDelivery = queues.get("missing_delivery") ?? 0;
    const readyToShip = queues.get("ready_to_ship") ?? 0;
    const marketplaceReady = queues.get("marketplace_ready_to_ship") ?? 0;

    return {
        action_counts: {
            payment_review: paymentReview,
            waiting_new_slip: waitingNewSlip,
            waiting_payment: waitingPayment,
            missing_delivery: missingDelivery,
            ready_to_ship: readyToShip,
            hot_leads: hotLeads,
            marketplace_ready_to_ship: marketplaceReady,
            total:
                paymentReview +
                waitingNewSlip +
                waitingPayment +
                missingDelivery +
                readyToShip +
                hotLeads +
                marketplaceReady,
        },
        order_statuses: statusOrder.map((status) => ({
            status,
            count: statuses.get(status) ?? 0,
        })),
    };
}

function buildSalesPerformance(
    customers: readonly LarkCustomerRecord[],
    pipelines: readonly LarkPipelineRecord[],
    orders: readonly LarkOrderRecord[],
    customerMap: ReadonlyMap<string, LarkCustomerRecord>,
    period: DashboardPeriod
): CommerceDashboardSummary["sales_performance"] {
    type Totals = CommerceDashboardSummary["sales_performance"][number];
    const totals = new Map<string, Totals>();
    const ensure = (owner: string | null): Totals => {
        const key = owner ?? "__unassigned__";
        const existing = totals.get(key);
        if (existing) return existing;
        const value: Totals = {
            sales_owner: owner,
            revenue_thb: 0,
            paid_orders: 0,
            active_leads: 0,
            hot_leads: 0,
        };
        totals.set(key, value);
        return value;
    };

    for (const customer of customers) {
        const owner = normalizeSalesOwner(customer.fields[CUSTOMER_FIELDS.SALES_OWNER]);
        const stage = customerStage(customer);
        if (stage !== "Won" && stage !== "Lost") ensure(owner).active_leads += 1;
        if (classifyCustomerWorkQueue(customer, pipelines) === "hot_lead") {
            ensure(owner).hot_leads += 1;
        }
    }

    for (const order of orders) {
        if (!isPaid(order) || !isInPeriod(paidAt(order), period.start_at, period.end_at)) continue;
        const customerId = getFirstLinkedRecordId(order.fields[ORDER_FIELDS.CUSTOMER]);
        const customer = customerId ? customerMap.get(customerId) : undefined;
        const owner =
            normalizeSalesOwner(order.fields[ORDER_FIELDS.SALES_OWNER]) ??
            normalizeSalesOwner(customer?.fields[CUSTOMER_FIELDS.SALES_OWNER]);
        const target = ensure(owner);
        target.revenue_thb += Math.max(
            0,
            getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0)
        );
        target.paid_orders += 1;
    }

    return [...totals.values()]
        .map((item) => ({ ...item, revenue_thb: round2(item.revenue_thb) }))
        .filter((item) =>
            item.revenue_thb > 0 || item.paid_orders > 0 || item.active_leads > 0 || item.hot_leads > 0
        )
        .sort((left, right) => right.revenue_thb - left.revenue_thb || right.active_leads - left.active_leads);
}

function parseActivityPayload(value: unknown): Record<string, unknown> {
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

function activityType(action: string): ActivityType {
    if (action.includes("PAYMENT") || action === "SALE_WON") return "payment";
    if (action.includes("ORDER") || action === "ADDRESS_UPDATED" || action === "PHONE_UPDATED") return "order";
    if (action.includes("PIPELINE") || action === "SALE_LOST" || action === "MESSAGE_RECEIVED") return "lead";
    return "system";
}

const ACTIVITY_TITLES: Record<ActivityAction, { th: string; en: string }> = {
    MESSAGE_RECEIVED: { th: "ได้รับข้อความลูกค้าใหม่", en: "New customer message received" },
    PIPELINE_CREATED: { th: "สร้างกระบวนการขายใหม่", en: "Sales pipeline created" },
    PIPELINE_UPDATED: { th: "อัปเดตกระบวนการขาย", en: "Sales pipeline updated" },
    ORDER_CREATED: { th: "สร้างคำสั่งซื้อใหม่", en: "New order created" },
    ORDER_QUANTITY_UPDATED: { th: "อัปเดตจำนวนสินค้า", en: "Order quantity updated" },
    ADDRESS_UPDATED: { th: "อัปเดตที่อยู่จัดส่ง", en: "Delivery address updated" },
    PHONE_UPDATED: { th: "อัปเดตเบอร์โทรลูกค้า", en: "Customer phone updated" },
    PAYMENT_SLIP_RECEIVED: { th: "ได้รับหลักฐานการชำระเงิน", en: "Payment evidence received" },
    PENDING_PAYMENT_SAVED: { th: "บันทึกข้อมูลชำระเงินรอตรวจสอบ", en: "Pending payment saved" },
    PENDING_PAYMENT_ATTACHED: { th: "ผูกข้อมูลชำระเงินกับคำสั่งซื้อ", en: "Pending payment attached to order" },
    PAYMENT_VERIFIED: { th: "ยืนยันการชำระเงินแล้ว", en: "Payment verified" },
    PAYMENT_REVIEW_APPROVED: { th: "อนุมัติการชำระเงินจาก Dashboard", en: "Payment approved from dashboard" },
    PAYMENT_REVIEW_REJECTED: { th: "ปฏิเสธหลักฐานการชำระเงิน", en: "Payment evidence rejected" },
    SALE_WON: { th: "ปิดการขายสำเร็จ", en: "Sale marked as won" },
    SALE_LOST: { th: "ปิดกระบวนการขายเป็นไม่สำเร็จ", en: "Sale marked as lost" },
    ORDER_CANCELLED: { th: "ยกเลิกคำสั่งซื้อ", en: "Order cancelled" },
    SALES_ASSIGNED: { th: "มอบหมายผู้ดูแลการขาย", en: "Sales owner assigned" },
    PAYMENT_OVERDUE: { th: "คำสั่งซื้อเกินกำหนดชำระ", en: "Payment became overdue" },
    MARKETPLACE_ORDER_CREATED: { th: "ได้รับคำสั่งซื้อใหม่จาก Marketplace", en: "New marketplace order received" },
    MARKETPLACE_ORDER_UPDATED: { th: "อัปเดตคำสั่งซื้อ Marketplace", en: "Marketplace order updated" },
};

function mapRecentActivities(
    activities: readonly LarkActivityRecord[],
    customers: readonly LarkCustomerRecord[],
    language: DashboardLanguage,
    period: DashboardPeriod
): CommerceDashboardSummary["recent_activities"] {
    const customerNames = new Map(
        customers.map((customer) => [
            customer.record_id,
            getLarkText(customer.fields[CUSTOMER_FIELDS.CUSTOMER_NAME], "").trim(),
        ] as const)
    );
    return [...activities]
        .filter((activity) =>
            isInPeriod(
                readTimestamp(activity.fields[ACTIVITY_FIELDS.CREATED_AT]),
                period.start_at,
                period.end_at
            )
        )
        .sort((left, right) =>
            readTimestamp(right.fields[ACTIVITY_FIELDS.CREATED_AT]) -
            readTimestamp(left.fields[ACTIVITY_FIELDS.CREATED_AT])
        )
        .slice(0, 6)
        .map((activity) => {
            const action = getLarkText(activity.fields[ACTIVITY_FIELDS.ACTION], "").trim();
            const payload = parseActivityPayload(activity.fields[ACTIVITY_FIELDS.NEW_VALUE]);
            const customerId = getFirstLinkedRecordId(activity.fields[ACTIVITY_FIELDS.CUSTOMER]);
            const customerName =
                (customerId ? customerNames.get(customerId) : "") ||
                getLarkText(payload.customer_name, "").trim() ||
                (language === "th" ? "ไม่ระบุชื่อ" : "Unnamed customer");
            const orderId = getLarkText(payload.order_record_id, "").trim();
            const detail = [
                language === "th" ? `ลูกค้า ${customerName}` : `Customer ${customerName}`,
                orderId ? `Order ${orderId}` : "",
            ].filter(Boolean).join(" · ");
            return {
                id: getLarkText(activity.fields[ACTIVITY_FIELDS.EVENT_ID], "").trim() || activity.record_id,
                title: ACTIVITY_TITLES[action as ActivityAction]?.[language] ??
                    (language === "th" ? "อัปเดตข้อมูล CRM" : "CRM data updated"),
                detail,
                created_at: new Date(
                    readTimestamp(activity.fields[ACTIVITY_FIELDS.CREATED_AT]) || Date.now()
                ).toISOString(),
                type: activityType(action),
            };
        });
}

function channelInScope(value: unknown, scope: DashboardDataScope): boolean {
    if (scope === "all") return true;
    const channel = normalizeChannel(value);
    return scope === "line" ? channel === "LINE" : channel !== null && channel !== "LINE";
}

function scopeRecords(
    customers: readonly LarkCustomerRecord[],
    pipelines: readonly LarkPipelineRecord[],
    orders: readonly LarkOrderRecord[],
    activities: readonly LarkActivityRecord[],
    scope: DashboardDataScope
) {
    if (scope === "all") return { customers, pipelines, orders, activities };

    const scopedCustomers = customers.filter((customer) =>
        channelInScope(customer.fields[CUSTOMER_FIELDS.CHANNEL], scope)
    );
    const customerIds = new Set(scopedCustomers.map((customer) => customer.record_id));
    const scopedOrders = orders.filter((order) =>
        channelInScope(order.fields[ORDER_FIELDS.CHANNEL], scope)
    );
    const orderIds = new Set(scopedOrders.map((order) => order.record_id));
    const scopedPipelines = pipelines.filter((pipeline) => {
        const customerId = getFirstLinkedRecordId(pipeline.fields[PIPELINE_FIELDS.CUSTOMER]);
        return Boolean(customerId && customerIds.has(customerId));
    });
    const scopedActivities = activities.filter((activity) => {
        const customerId = getFirstLinkedRecordId(activity.fields[ACTIVITY_FIELDS.CUSTOMER]);
        if (customerId && customerIds.has(customerId)) return true;
        const oldPayload = parseActivityPayload(activity.fields[ACTIVITY_FIELDS.OLD_VALUE]);
        const newPayload = parseActivityPayload(activity.fields[ACTIVITY_FIELDS.NEW_VALUE]);
        const orderId =
            getLarkText(newPayload.order_record_id, "").trim() ||
            getLarkText(oldPayload.order_record_id, "").trim();
        return Boolean(orderId && orderIds.has(orderId));
    });
    return {
        customers: scopedCustomers,
        pipelines: scopedPipelines,
        orders: scopedOrders,
        activities: scopedActivities,
    };
}

async function buildSummary(
    env: Env,
    language: DashboardLanguage,
    period: DashboardPeriod,
    now: number,
    scope: DashboardDataScope
): Promise<CommerceDashboardSummary> {
    const [allCustomers, allPipelines, allOrders, allActivities] = await Promise.all([
        getDashboardCustomers(env),
        getDashboardPipelines(env),
        getDashboardOrders(env),
        getDashboardActivities(env),
    ]);
    const { customers, pipelines, orders, activities } = scopeRecords(
        allCustomers,
        allPipelines,
        allOrders,
        allActivities,
        scope
    );
    const customerMap = new Map(customers.map((item) => [item.record_id, item] as const));
    const paidCurrent = orders.filter((order) =>
        isPaid(order) && isInPeriod(paidAt(order), period.start_at, period.end_at)
    );
    const paidPrevious = orders.filter((order) =>
        isPaid(order) && isInPeriod(paidAt(order), period.previous_start_at, period.previous_end_at)
    );
    const currentRevenue = paidCurrent.reduce(
        (sum, order) => sum + Math.max(0, getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0)),
        0
    );
    const previousRevenue = paidPrevious.reduce(
        (sum, order) => sum + Math.max(0, getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0)),
        0
    );
    const currentLeads = customers.filter((customer) =>
        isInPeriod(
            createdAt(customer, CUSTOMER_FIELDS.CREATED_AT),
            period.start_at,
            period.end_at
        )
    ).length;
    const previousLeads = customers.filter((customer) =>
        isInPeriod(
            createdAt(customer, CUSTOMER_FIELDS.CREATED_AT),
            period.previous_start_at,
            period.previous_end_at
        )
    ).length;
    const currentCloseRate = closeRate(pipelines, period.start_at, period.end_at);
    const previousCloseRate = closeRate(
        pipelines,
        period.previous_start_at,
        period.previous_end_at
    );
    const channelTotals = new Map<
        DashboardChannel,
        { orders: number; revenue: number }
    >(CHANNEL_ORDER.map((channel) => [channel, { orders: 0, revenue: 0 }]));
    let unknownChannelOrders = 0;
    for (const order of paidCurrent) {
        const channel = normalizeChannel(order.fields[ORDER_FIELDS.CHANNEL]);
        if (!channel) {
            unknownChannelOrders += 1;
            continue;
        }
        const totals = channelTotals.get(channel)!;
        totals.orders += 1;
        totals.revenue += Math.max(0, getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0));
    }
    const channels = CHANNEL_ORDER.map((channel) => {
        const totals = channelTotals.get(channel)!;
        return {
            channel,
            orders: totals.orders,
            revenue_thb: round2(totals.revenue),
            share_percent: currentRevenue > 0 ? round2((totals.revenue / currentRevenue) * 100) : 0,
        };
    }).sort((left, right) => right.revenue_thb - left.revenue_thb);
    const orderAnalytics = buildOrderAnalytics(customers, pipelines, orders, activities, period);

    return {
        period: {
            mode: period.mode,
            value: period.value,
            start_at: new Date(period.start_at).toISOString(),
            end_at: new Date(period.end_at).toISOString(),
            previous_start_at: new Date(period.previous_start_at).toISOString(),
            previous_end_at: new Date(period.previous_end_at).toISOString(),
            granularity: period.granularity,
        },
        totals: {
            revenue_thb: round2(currentRevenue),
            total_leads: currentLeads,
            close_rate_percent: currentCloseRate,
            paid_orders: paidCurrent.length,
            pending_orders: orderAnalytics.action_counts.waiting_payment +
                orderAnalytics.action_counts.waiting_new_slip,
        },
        changes: {
            revenue_percent: percentChange(currentRevenue, previousRevenue),
            leads_percent: percentChange(currentLeads, previousLeads),
            close_rate_percent: round2(currentCloseRate - previousCloseRate),
            paid_orders_percent: percentChange(paidCurrent.length, paidPrevious.length),
            pending_orders_percent: 0,
        },
        channels,
        revenue_trend: buildTrend(orders, period),
        action_counts: orderAnalytics.action_counts,
        pipeline_stages: buildPipelineStages(customers),
        sales_performance: buildSalesPerformance(customers, pipelines, orders, customerMap, period),
        order_statuses: orderAnalytics.order_statuses,
        recent_activities: mapRecentActivities(activities, customers, language, period),
        data_quality: {
            paid_orders_missing_paid_at: orders.filter((order) => isPaid(order) && paidAt(order) === 0).length,
            unknown_channel_orders: unknownChannelOrders,
        },
        updated_at: new Date(now).toISOString(),
    };
}

export async function getCommerceDashboardSummary(
    env: Env,
    language: DashboardLanguage,
    periodOrNow: DashboardPeriod | number,
    now = Date.now(),
    scope: DashboardDataScope = "all"
): Promise<CommerceDashboardSummary> {
    // รองรับ signature รุ่นก่อนชั่วคราวสำหรับ route/test ภายใน โดยข้อมูลจริงรุ่นใหม่ใช้ DashboardPeriod เสมอ
    const effectiveNow = typeof periodOrNow === "number" ? periodOrNow : now;
    const period = typeof periodOrNow === "number"
        ? defaultDashboardPeriod("month", effectiveNow)
        : periodOrNow;
    const cacheKey = `${language}:${scope}:${period.mode}:${period.value}`;
    const cached = summaryCache.get(cacheKey);
    if (cached && cached.expires_at > Date.now()) return cached.value;
    const pending = pendingSummary.get(cacheKey);
    if (pending) return await pending;

    const request = buildSummary(env, language, period, effectiveNow, scope)
        .then((value) => {
            summaryCache.set(cacheKey, {
                expires_at: Date.now() + SUMMARY_CACHE_MS,
                value,
            });
            return value;
        })
        .finally(() => pendingSummary.delete(cacheKey));
    pendingSummary.set(cacheKey, request);
    return await request;
}

export function clearCommerceDashboardCache(): void {
    summaryCache.clear();
    pendingSummary.clear();
}
