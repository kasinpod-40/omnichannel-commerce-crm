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
    getLarkAttachmentTokens,
    getLarkBoolean,
    getFirstLinkedRecordId,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { normalizePhoneNumber } from "../../utils/phone";
import { listActivities } from "../activities/activity.repository";
import type { ActivityAction } from "../activities/activity.types";
import { listCustomers } from "../customers/customer.repository";
import { listOrders } from "../orders/order.repository";
import { listPipelines } from "../pipeline/pipeline.repository";

/** ภาษาที่ Frontend ส่งมาเพื่อให้ข้อความกิจกรรมไม่ปะปนไทยกับอังกฤษ */
export type DashboardLanguage = "th" | "en";

export type CommerceDashboardSummary = {
    totals: {
        revenue_thb: number;
        total_leads: number;
        close_rate_percent: number;
        pending_orders: number;
    };
    changes: {
        revenue_percent: number;
        leads_percent: number;
        close_rate_percent: number;
        pending_orders_percent: number;
    };
    channels: Array<{
        channel: "LINE" | "Shopee" | "Lazada" | "TikTok Shop";
        orders: number;
        revenue_thb: number;
        share_percent: number;
    }>;
    revenue_trend: {
        period_days: 7;
        current_period: Array<{
            date: string;
            revenue_thb: number;
            paid_orders: number;
        }>;
        previous_period: Array<{
            date: string;
            revenue_thb: number;
            paid_orders: number;
        }>;
        change_percent: number;
    };
    action_counts: {
        payment_review: number;
        waiting_payment: number;
        missing_delivery: number;
        ready_to_ship: number;
        hot_leads: number;
        marketplace_ready_to_ship: number;
        total: number;
    };
    pipeline_stages: Array<{
        stage: SalesStage;
        count: number;
    }>;
    sales_performance: Array<{
        sales_owner: string | null;
        revenue_thb: number;
        paid_orders: number;
        active_leads: number;
        hot_leads: number;
    }>;
    order_statuses: Array<{
        status:
            | "pending_review"
            | "waiting_payment"
            | "waiting_delivery"
            | "ready_to_ship"
            | "in_progress"
            | "completed"
            | "cancelled";
        count: number;
    }>;
    recent_activities: Array<{
        id: string;
        title: string;
        detail: string;
        created_at: string;
        type: "lead" | "order" | "payment" | "system";
    }>;
    updated_at: string;
};

type DashboardChannel = CommerceDashboardSummary["channels"][number]["channel"];
type ActivityType = CommerceDashboardSummary["recent_activities"][number]["type"];
type DashboardOrderStatus = CommerceDashboardSummary["order_statuses"][number]["status"];
type LarkRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

type CachedSummary = {
    expires_at: number;
    value: CommerceDashboardSummary;
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1_000;
const TREND_DAYS = 7 as const;
const SUMMARY_CACHE_MS = 10_000;
const CHANNEL_ORDER: DashboardChannel[] = [
    "TikTok Shop",
    "Shopee",
    "LINE",
    "Lazada",
];

/*
 * Dashboard ถูก React Query เรียกซ้ำได้ตอนหน้าได้รับ Focus
 * Cache สั้น 10 วินาทีช่วยลดการยิง Lark Base ซ้ำโดยไม่ทำให้ข้อมูลเก่าอยู่นาน
 */
const summaryCache = new Map<DashboardLanguage, CachedSummary>();
const pendingSummary = new Map<
    DashboardLanguage,
    Promise<CommerceDashboardSummary>
>();

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

/** แปลง Timestamp จาก Lark เป็น milliseconds และคืน 0 เมื่อไม่มีค่า */
function readTimestamp(value: unknown): number {
    const timestamp = getLarkNumber(value, 0);

    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return 0;
    }

    // Lark DateTime ใช้ milliseconds แต่รองรับ seconds เผื่อข้อมูลเก่า
    return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

function isBetween(
    timestamp: number,
    startInclusive: number,
    endExclusive: number
): boolean {
    return timestamp >= startInclusive && timestamp < endExclusive;
}

/** คำนวณเปอร์เซ็นต์เทียบช่วงก่อนหน้า โดยกรณีฐานเดิมเป็นศูนย์ให้ใช้ 100% */
function percentChange(current: number, previous: number): number {
    if (previous === 0) {
        return current === 0 ? 0 : 100;
    }

    return round2(((current - previous) / previous) * 100);
}

function normalizeStatus(value: unknown): string {
    return getLarkText(value, "").trim().toLowerCase();
}

/** รวมชื่อช่องทางหลายรูปแบบจาก Lark ให้ตรง Contract ของ Frontend */
function normalizeChannel(value: unknown): DashboardChannel | null {
    const channel = normalizeStatus(value).replace(/\s+/g, " ");

    if (channel === "line" || channel === "line oa") {
        return "LINE";
    }

    if (channel === "shopee") {
        return "Shopee";
    }

    if (channel === "lazada") {
        return "Lazada";
    }

    if (
        channel === "tiktok" ||
        channel === "tiktok shop" ||
        channel === "tik tok"
    ) {
        return "TikTok Shop";
    }

    return null;
}

function normalizeComparableValue(value: unknown): string {
    return normalizeStatus(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function normalizeSalesOwner(value: unknown): string | null {
    const owner = getLarkText(value, "").trim();
    if (!owner || owner.toLowerCase() === "unassigned") {
        return null;
    }
    return owner;
}

function readCustomerStage(customer: LarkRecord): SalesStage {
    const stage = getLarkText(
        customer.fields[CUSTOMER_FIELDS.CURRENT_STAGE],
        "New Lead"
    ).trim();
    return isSalesStage(stage) ? stage : "New Lead";
}

function hasPaymentEvidence(order: LarkRecord): boolean {
    const fields = order.fields;
    return (
        getLarkAttachmentTokens(fields[ORDER_FIELDS.SLIP_ATTACHMENT]).length > 0 ||
        Boolean(getLarkText(fields[ORDER_FIELDS.SLIP_IMAGE_URL], "").trim()) ||
        getLarkNumber(fields[ORDER_FIELDS.SLIP_AMOUNT], 0) > 0 ||
        Boolean(getLarkText(fields[ORDER_FIELDS.SLIP_BANK], "").trim())
    );
}

function resolveOrderCustomer(
    order: LarkRecord,
    customerByRecordId: ReadonlyMap<string, LarkRecord>
): LarkRecord | null {
    const customerId = getFirstLinkedRecordId(
        order.fields[ORDER_FIELDS.CUSTOMER]
    );
    return customerId ? customerByRecordId.get(customerId) ?? null : null;
}

function resolveOrderPhone(
    order: LarkRecord,
    customerByRecordId: ReadonlyMap<string, LarkRecord>
): string {
    const orderPhone = normalizePhoneNumber(
        getLarkText(order.fields[ORDER_FIELDS.PHONE], "").trim()
    );
    if (orderPhone) return orderPhone;

    const customer = resolveOrderCustomer(order, customerByRecordId);
    return customer
        ? normalizePhoneNumber(
            getLarkText(customer.fields[CUSTOMER_FIELDS.PHONE], "").trim()
        ) ?? ""
        : "";
}

/**
 * สถานะแสดงผลกลางของกราฟและ Action Center
 * ลำดับเดียวกับ Frontend order-display-status เพื่อไม่ให้ Overview นับคนละความหมายกับหน้า Orders
 */
function resolveDashboardOrderStatus(
    order: LarkRecord,
    customerByRecordId: ReadonlyMap<string, LarkRecord>
): DashboardOrderStatus {
    const orderStatus = normalizeComparableValue(
        order.fields[ORDER_FIELDS.ORDER_STATUS]
    );
    const paymentStatus = normalizeComparableValue(
        order.fields[ORDER_FIELDS.PAYMENT_STATUS]
    );
    const channel = normalizeChannel(order.fields[ORDER_FIELDS.CHANNEL]) ?? "LINE";
    const paymentVerified = getLarkBoolean(
        order.fields[ORDER_FIELDS.PAYMENT_VERIFIED],
        false
    );

    if (["cancelled", "canceled", "returned"].includes(orderStatus)) {
        return "cancelled";
    }

    if (
        orderStatus === "payment review" ||
        paymentStatus === "payment review" ||
        (!paymentVerified && hasPaymentEvidence(order))
    ) {
        return "pending_review";
    }

    const paymentConfirmed = paymentVerified || paymentStatus === "paid";

    if (paymentConfirmed) {
        if (channel === "LINE") {
            const address = getLarkText(
                order.fields[ORDER_FIELDS.ADDRESS],
                ""
            ).trim();
            const phone = resolveOrderPhone(order, customerByRecordId);
            return address && phone ? "ready_to_ship" : "waiting_delivery";
        }

        if (["completed", "delivered"].includes(orderStatus)) {
            return "completed";
        }
        return "in_progress";
    }

    if (["completed", "delivered"].includes(orderStatus)) {
        return "completed";
    }
    if (orderStatus === "waiting address") {
        return "waiting_delivery";
    }
    if (["confirmed", "processing", "ready to ship", "shipped"].includes(orderStatus)) {
        return "in_progress";
    }
    return "waiting_payment";
}

function isMarketplaceReadyToShip(order: LarkRecord): boolean {
    const channel = normalizeChannel(order.fields[ORDER_FIELDS.CHANNEL]);
    if (!channel || channel === "LINE") return false;

    const statuses = [
        order.fields[ORDER_FIELDS.MARKETPLACE_STATUS],
        order.fields[ORDER_FIELDS.ORDER_STATUS],
    ].map(normalizeComparableValue);

    return statuses.some((status) => status === "ready to ship");
}

function startOfBangkokDay(timestamp: number): number {
    return (
        Math.floor((timestamp + BANGKOK_OFFSET_MS) / DAY_MS) * DAY_MS -
        BANGKOK_OFFSET_MS
    );
}

function bangkokDateKey(timestamp: number): string {
    return new Date(timestamp + BANGKOK_OFFSET_MS)
        .toISOString()
        .slice(0, 10);
}

function isPaidOrder(order: LarkRecord): boolean {
    return normalizeStatus(
        order.fields[ORDER_FIELDS.PAYMENT_STATUS]
    ) === "paid";
}

function isPendingOrder(order: LarkRecord): boolean {
    const paymentStatus = normalizeStatus(
        order.fields[ORDER_FIELDS.PAYMENT_STATUS]
    );
    const orderStatus = normalizeStatus(
        order.fields[ORDER_FIELDS.ORDER_STATUS]
    );

    const terminalStatuses = new Set([
        "completed",
        "cancelled",
        "returned",
    ]);
    const terminalPayments = new Set([
        "failed",
        "refunded",
    ]);

    /*
     * Order ที่ชำระแล้วแต่ยัง Processing/Ready to Ship/Shipped ยังเป็นงานรอดำเนินการ
     * จึงตัดออกเฉพาะสถานะ Order ที่จบแล้ว หรือ Payment ที่ล้มเหลว/คืนเงิน
     */
    return (
        !terminalStatuses.has(orderStatus) &&
        !terminalPayments.has(paymentStatus)
    );
}

function getOrderEventTimestamp(order: LarkRecord): number {
    return (
        readTimestamp(order.fields[ORDER_FIELDS.PAID_AT]) ||
        readTimestamp(order.fields[ORDER_FIELDS.UPDATED_AT]) ||
        readTimestamp(order.fields[ORDER_FIELDS.CREATED_AT])
    );
}

function getPipelineClosedTimestamp(pipeline: LarkRecord): number {
    return (
        readTimestamp(pipeline.fields[PIPELINE_FIELDS.CLOSED_AT]) ||
        readTimestamp(pipeline.fields[PIPELINE_FIELDS.CREATED_AT])
    );
}

function calculateCloseRate(
    pipelines: LarkRecord[],
    start?: number,
    end?: number
): number {
    let won = 0;
    let lost = 0;

    for (const pipeline of pipelines) {
        const status = normalizeStatus(
            pipeline.fields[PIPELINE_FIELDS.STATUS]
        );

        if (status !== "won" && status !== "lost") {
            continue;
        }

        if (start !== undefined && end !== undefined) {
            const closedAt = getPipelineClosedTimestamp(pipeline);

            if (!isBetween(closedAt, start, end)) {
                continue;
            }
        }

        if (status === "won") {
            won += 1;
        } else {
            lost += 1;
        }
    }

    const closed = won + lost;
    return closed === 0 ? 0 : round2((won / closed) * 100);
}

function buildRevenueTrend(
    orders: LarkRecord[],
    now: number
): CommerceDashboardSummary["revenue_trend"] {
    const currentEnd = startOfBangkokDay(now) + DAY_MS;
    const currentStart = currentEnd - TREND_DAYS * DAY_MS;
    const previousStart = currentStart - TREND_DAYS * DAY_MS;

    const currentPeriod = Array.from({ length: TREND_DAYS }, (_, index) => ({
        date: bangkokDateKey(currentStart + index * DAY_MS),
        revenue_thb: 0,
        paid_orders: 0,
    }));
    const previousPeriod = Array.from({ length: TREND_DAYS }, (_, index) => ({
        date: bangkokDateKey(previousStart + index * DAY_MS),
        revenue_thb: 0,
        paid_orders: 0,
    }));

    for (const order of orders) {
        if (!isPaidOrder(order)) continue;

        const eventAt = getOrderEventTimestamp(order);
        const amount = Math.max(
            0,
            getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0)
        );

        if (isBetween(eventAt, currentStart, currentEnd)) {
            const index = Math.floor((eventAt - currentStart) / DAY_MS);
            const point = currentPeriod[index];
            if (point) {
                point.revenue_thb += amount;
                point.paid_orders += 1;
            }
        } else if (isBetween(eventAt, previousStart, currentStart)) {
            const index = Math.floor((eventAt - previousStart) / DAY_MS);
            const point = previousPeriod[index];
            if (point) {
                point.revenue_thb += amount;
                point.paid_orders += 1;
            }
        }
    }

    const normalizedCurrent = currentPeriod.map((point) => ({
        ...point,
        revenue_thb: round2(point.revenue_thb),
    }));
    const normalizedPrevious = previousPeriod.map((point) => ({
        ...point,
        revenue_thb: round2(point.revenue_thb),
    }));
    const currentRevenue = normalizedCurrent.reduce(
        (sum, point) => sum + point.revenue_thb,
        0
    );
    const previousRevenue = normalizedPrevious.reduce(
        (sum, point) => sum + point.revenue_thb,
        0
    );

    return {
        period_days: TREND_DAYS,
        current_period: normalizedCurrent,
        previous_period: normalizedPrevious,
        change_percent: percentChange(currentRevenue, previousRevenue),
    };
}

function buildPipelineStages(
    customers: LarkRecord[]
): CommerceDashboardSummary["pipeline_stages"] {
    const counts = new Map<SalesStage, number>(
        SALES_STAGE_VALUES.map((stage) => [stage, 0])
    );

    for (const customer of customers) {
        const stage = readCustomerStage(customer);
        counts.set(stage, (counts.get(stage) ?? 0) + 1);
    }

    return SALES_STAGE_VALUES.map((stage) => ({
        stage,
        count: counts.get(stage) ?? 0,
    }));
}

function buildSalesPerformance(
    customers: LarkRecord[],
    orders: LarkRecord[],
    customerByRecordId: ReadonlyMap<string, LarkRecord>
): CommerceDashboardSummary["sales_performance"] {
    type SalesTotals = {
        sales_owner: string | null;
        revenue_thb: number;
        paid_orders: number;
        active_leads: number;
        hot_leads: number;
    };

    const totalsByOwner = new Map<string, SalesTotals>();
    const ownerKey = (owner: string | null) => owner ?? "__unassigned__";
    const ensureOwner = (owner: string | null): SalesTotals => {
        const key = ownerKey(owner);
        const existing = totalsByOwner.get(key);
        if (existing) return existing;

        const created: SalesTotals = {
            sales_owner: owner,
            revenue_thb: 0,
            paid_orders: 0,
            active_leads: 0,
            hot_leads: 0,
        };
        totalsByOwner.set(key, created);
        return created;
    };

    for (const customer of customers) {
        const owner = normalizeSalesOwner(
            customer.fields[CUSTOMER_FIELDS.SALES_OWNER]
        );
        const stage = readCustomerStage(customer);
        const active = stage !== "Won" && stage !== "Lost";
        const totals = ensureOwner(owner);

        if (active) totals.active_leads += 1;
        if (
            active &&
            getLarkBoolean(customer.fields[CUSTOMER_FIELDS.HOT_LEAD], false)
        ) {
            totals.hot_leads += 1;
        }
    }

    for (const order of orders) {
        if (!isPaidOrder(order)) continue;

        const customer = resolveOrderCustomer(order, customerByRecordId);
        const owner = normalizeSalesOwner(
            order.fields[ORDER_FIELDS.SALES_OWNER]
        ) ?? normalizeSalesOwner(customer?.fields[CUSTOMER_FIELDS.SALES_OWNER]);
        const totals = ensureOwner(owner);
        totals.revenue_thb += Math.max(
            0,
            getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0)
        );
        totals.paid_orders += 1;
    }

    return [...totalsByOwner.values()]
        .map((item) => ({
            ...item,
            revenue_thb: round2(item.revenue_thb),
        }))
        .filter(
            (item) =>
                item.revenue_thb > 0 ||
                item.paid_orders > 0 ||
                item.active_leads > 0 ||
                item.hot_leads > 0
        )
        .sort((left, right) => {
            if (right.revenue_thb !== left.revenue_thb) {
                return right.revenue_thb - left.revenue_thb;
            }
            if (right.active_leads !== left.active_leads) {
                return right.active_leads - left.active_leads;
            }
            return (left.sales_owner ?? "").localeCompare(
                right.sales_owner ?? "",
                "th"
            );
        });
}

function buildOrderAnalytics(
    customers: LarkRecord[],
    orders: LarkRecord[]
): Pick<CommerceDashboardSummary, "action_counts" | "order_statuses"> {
    const customerByRecordId = new Map(
        customers.map((customer) => [customer.record_id, customer] as const)
    );
    const statusOrder: DashboardOrderStatus[] = [
        "pending_review",
        "waiting_payment",
        "waiting_delivery",
        "ready_to_ship",
        "in_progress",
        "completed",
        "cancelled",
    ];
    const statusCounts = new Map<DashboardOrderStatus, number>(
        statusOrder.map((status) => [status, 0])
    );
    let marketplaceReadyToShip = 0;

    for (const order of orders) {
        const status = resolveDashboardOrderStatus(order, customerByRecordId);
        statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
        // Marketplace Ready to Ship เป็น Action แยกจากกลุ่มสถานะอื่น
        // จึงนับเฉพาะ Order ที่ถูกจัดอยู่ใน in_progress เพื่อไม่ให้ Total ซ้ำจากข้อมูลขัดแย้ง
        if (status === "in_progress" && isMarketplaceReadyToShip(order)) {
            marketplaceReadyToShip += 1;
        }
    }

    const hotLeads = customers.filter((customer) => {
        const stage = readCustomerStage(customer);
        return (
            stage !== "Won" &&
            stage !== "Lost" &&
            getLarkBoolean(customer.fields[CUSTOMER_FIELDS.HOT_LEAD], false)
        );
    }).length;
    const actionCounts = {
        payment_review: statusCounts.get("pending_review") ?? 0,
        waiting_payment: statusCounts.get("waiting_payment") ?? 0,
        missing_delivery: statusCounts.get("waiting_delivery") ?? 0,
        ready_to_ship: statusCounts.get("ready_to_ship") ?? 0,
        hot_leads: hotLeads,
        marketplace_ready_to_ship: marketplaceReadyToShip,
        total: 0,
    };
    actionCounts.total =
        actionCounts.payment_review +
        actionCounts.waiting_payment +
        actionCounts.missing_delivery +
        actionCounts.ready_to_ship +
        actionCounts.hot_leads +
        actionCounts.marketplace_ready_to_ship;

    return {
        action_counts: actionCounts,
        order_statuses: statusOrder.map((status) => ({
            status,
            count: statusCounts.get(status) ?? 0,
        })),
    };
}

/** อ่าน JSON ที่ Activity service serialize ไว้ใน new_value โดยไม่ทำให้ Dashboard พัง */
function parseActivityPayload(value: unknown): Record<string, unknown> {
    const text = getLarkText(value, "").trim();

    if (!text) {
        return {};
    }

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
    if (
        action.includes("PAYMENT") ||
        action === "SALE_WON"
    ) {
        return "payment";
    }

    if (
        action.includes("ORDER") ||
        action === "ADDRESS_UPDATED"
    ) {
        return "order";
    }

    if (
        action.includes("PIPELINE") ||
        action === "MESSAGE_RECEIVED" ||
        action === "PHONE_UPDATED" ||
        action === "SALES_ASSIGNED" ||
        action === "SALE_LOST"
    ) {
        return "lead";
    }

    return "system";
}

const ACTIVITY_TITLES: Record<
    ActivityAction,
    { th: string; en: string }
> = {
    MESSAGE_RECEIVED: {
        th: "ได้รับข้อความลูกค้าใหม่",
        en: "New customer message received",
    },
    PIPELINE_CREATED: {
        th: "สร้างกระบวนการขายใหม่",
        en: "Sales pipeline created",
    },
    PIPELINE_UPDATED: {
        th: "อัปเดตกระบวนการขาย",
        en: "Sales pipeline updated",
    },
    ORDER_CREATED: {
        th: "สร้างคำสั่งซื้อใหม่",
        en: "New order created",
    },
    ORDER_QUANTITY_UPDATED: {
        th: "อัปเดตจำนวนสินค้า",
        en: "Order quantity updated",
    },
    ADDRESS_UPDATED: {
        th: "อัปเดตที่อยู่จัดส่ง",
        en: "Delivery address updated",
    },
    PHONE_UPDATED: {
        th: "อัปเดตเบอร์โทรลูกค้า",
        en: "Customer phone updated",
    },
    PAYMENT_SLIP_RECEIVED: {
        th: "ได้รับหลักฐานการชำระเงิน",
        en: "Payment evidence received",
    },
    PENDING_PAYMENT_SAVED: {
        th: "บันทึกข้อมูลชำระเงินรอตรวจสอบ",
        en: "Pending payment saved",
    },
    PENDING_PAYMENT_ATTACHED: {
        th: "ผูกข้อมูลชำระเงินกับคำสั่งซื้อ",
        en: "Pending payment attached to order",
    },
    PAYMENT_VERIFIED: {
        th: "ยืนยันการชำระเงินแล้ว",
        en: "Payment verified",
    },
    PAYMENT_REVIEW_APPROVED: {
        th: "อนุมัติการชำระเงินจาก Dashboard",
        en: "Payment approved from dashboard",
    },
    PAYMENT_REVIEW_REJECTED: {
        th: "ปฏิเสธหลักฐานการชำระเงิน",
        en: "Payment evidence rejected",
    },
    SALE_WON: {
        th: "ปิดการขายสำเร็จ",
        en: "Sale marked as won",
    },
    SALE_LOST: {
        th: "ปิดกระบวนการขายเป็นไม่สำเร็จ",
        en: "Sale marked as lost",
    },
    ORDER_CANCELLED: {
        th: "ยกเลิกคำสั่งซื้อ",
        en: "Order cancelled",
    },
    SALES_ASSIGNED: {
        th: "มอบหมายผู้ดูแลการขาย",
        en: "Sales owner assigned",
    },
    PAYMENT_OVERDUE: {
        th: "คำสั่งซื้อเกินกำหนดชำระ",
        en: "Payment became overdue",
    },
    MARKETPLACE_ORDER_CREATED: {
        th: "ได้รับคำสั่งซื้อใหม่จาก Marketplace",
        en: "New marketplace order received",
    },
    MARKETPLACE_ORDER_UPDATED: {
        th: "อัปเดตคำสั่งซื้อ Marketplace",
        en: "Marketplace order updated",
    },
};

/**
 * สร้างข้อความรายละเอียดกิจกรรมโดยใช้ชื่อลูกค้าจริงแทน Lark record_id
 *
 * ผู้เรียกใช้: mapRecentActivities()
 * แหล่งชื่อ: Customers table ที่ buildCommerceDashboardSummary() ดึงมาพร้อม Activity
 * เหตุผล: record_id เช่น recxxxxxxxx เป็นข้อมูลเทคนิคและไม่ควรแสดงให้ผู้ใช้ปลายทาง
 */
function activityDetail(
    activity: LarkRecord,
    payload: Record<string, unknown>,
    language: DashboardLanguage,
    customerNameByRecordId: ReadonlyMap<string, string>
): string {
    const orderId = getLarkText(payload.order_record_id, "").trim();
    const pipelineId = getLarkText(payload.pipeline_record_id, "").trim();
    const customerId = getFirstLinkedRecordId(
        activity.fields[ACTIVITY_FIELDS.CUSTOMER]
    );
    const customerNameFromPayload = getLarkText(
        payload.customer_name,
        ""
    ).trim();
    const customerName =
        (customerId ? customerNameByRecordId.get(customerId) : undefined) ||
        customerNameFromPayload ||
        (language === "th" ? "ไม่ระบุชื่อ" : "Unnamed customer");
    const status =
        getLarkText(payload.payment_status, "").trim() ||
        getLarkText(payload.order_status, "").trim() ||
        getLarkText(payload.stage, "").trim();

    const parts: string[] = [
        language === "th"
            ? `ลูกค้า ${customerName}`
            : `Customer ${customerName}`,
    ];

    if (orderId) {
        parts.push(`Order ${orderId}`);
    } else if (pipelineId) {
        parts.push(`Pipeline ${pipelineId}`);
    }

    if (status) {
        parts.push(status);
    }

    return parts.join(" · ");
}

function mapRecentActivities(
    activities: LarkRecord[],
    language: DashboardLanguage,
    customerNameByRecordId: ReadonlyMap<string, string>
): CommerceDashboardSummary["recent_activities"] {
    return [...activities]
        .sort(
            (left, right) =>
                readTimestamp(right.fields[ACTIVITY_FIELDS.CREATED_AT]) -
                readTimestamp(left.fields[ACTIVITY_FIELDS.CREATED_AT])
        )
        .slice(0, 4)
        .map((activity) => {
            const rawAction = getLarkText(
                activity.fields[ACTIVITY_FIELDS.ACTION],
                ""
            ).trim();
            const action = rawAction as ActivityAction;
            const title = ACTIVITY_TITLES[action]?.[language] ??
                (language === "th" ? "อัปเดตข้อมูล CRM" : "CRM data updated");
            const timestamp = readTimestamp(
                activity.fields[ACTIVITY_FIELDS.CREATED_AT]
            );
            const payload = parseActivityPayload(
                activity.fields[ACTIVITY_FIELDS.NEW_VALUE]
            );

            return {
                id:
                    getLarkText(
                        activity.fields[ACTIVITY_FIELDS.EVENT_ID],
                        ""
                    ).trim() || activity.record_id,
                title,
                detail: activityDetail(
                    activity,
                    payload,
                    language,
                    customerNameByRecordId
                ),
                created_at: new Date(timestamp || Date.now()).toISOString(),
                type: activityType(rawAction),
            };
        });
}

async function buildCommerceDashboardSummary(
    env: Env,
    language: DashboardLanguage,
    now: number
): Promise<CommerceDashboardSummary> {
    // ดึงสี่ตารางพร้อมกันเพื่อลดเวลารอรวมของหน้า Dashboard
    const [customers, pipelines, orders, activities] = await Promise.all([
        listCustomers(env),
        listPipelines(env),
        listOrders(env),
        listActivities(env),
    ]);

    /*
     * Activity เก็บ Link ไปยัง Customer เป็น record_id เท่านั้น
     * Map นี้ใช้แปลง record_id เป็น customer_name หนึ่งครั้ง แล้วส่งเข้า mapper กิจกรรม
     * เพื่อไม่ต้องเรียก Lark เพิ่มทีละ Activity และไม่แสดงรหัสภายในให้ผู้ใช้เห็น
     */
    const customerNameByRecordId = new Map(
        customers.map((customer) => {
            const customerName = getLarkText(
                customer.fields[CUSTOMER_FIELDS.CUSTOMER_NAME],
                ""
            ).trim();

            return [customer.record_id, customerName] as const;
        }).filter((entry) => entry[1].length > 0)
    );
    const customerByRecordId = new Map(
        customers.map((customer) => [customer.record_id, customer] as const)
    );

    const currentStart = now - THIRTY_DAYS_MS;
    const previousStart = currentStart - THIRTY_DAYS_MS;

    let totalRevenue = 0;
    let currentRevenue = 0;
    let previousRevenue = 0;
    let currentPendingCreated = 0;
    let previousPendingCreated = 0;
    let pendingOrders = 0;

    const channelMap = new Map<
        DashboardChannel,
        { orders: number; revenue: number }
    >(
        CHANNEL_ORDER.map((channel) => [
            channel,
            { orders: 0, revenue: 0 },
        ])
    );

    for (const order of orders) {
        const channel = normalizeChannel(
            order.fields[ORDER_FIELDS.CHANNEL]
        );
        const amount = Math.max(
            0,
            getLarkNumber(order.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0)
        );
        const createdAt = readTimestamp(
            order.fields[ORDER_FIELDS.CREATED_AT]
        );
        const eventAt = getOrderEventTimestamp(order);
        const pending = isPendingOrder(order);

        if (pending) {
            pendingOrders += 1;

            if (isBetween(createdAt, currentStart, now)) {
                currentPendingCreated += 1;
            } else if (
                isBetween(createdAt, previousStart, currentStart)
            ) {
                previousPendingCreated += 1;
            }
        }

        if (!isPaidOrder(order)) {
            continue;
        }

        totalRevenue += amount;

        if (channel) {
            // Donut แสดงสัดส่วนยอดขายที่ยืนยันแล้ว จำนวน Order จึงต้องใช้ฐาน Paid เดียวกัน
            channelMap.get(channel)!.orders += 1;
            channelMap.get(channel)!.revenue += amount;
        }

        if (isBetween(eventAt, currentStart, now)) {
            currentRevenue += amount;
        } else if (isBetween(eventAt, previousStart, currentStart)) {
            previousRevenue += amount;
        }
    }

    const currentLeads = customers.filter((customer) =>
        isBetween(
            readTimestamp(customer.fields[CUSTOMER_FIELDS.CREATED_AT]),
            currentStart,
            now
        )
    ).length;
    const previousLeads = customers.filter((customer) =>
        isBetween(
            readTimestamp(customer.fields[CUSTOMER_FIELDS.CREATED_AT]),
            previousStart,
            currentStart
        )
    ).length;

    const closeRate = calculateCloseRate(pipelines);
    const currentCloseRate = calculateCloseRate(
        pipelines,
        currentStart,
        now
    );
    const previousCloseRate = calculateCloseRate(
        pipelines,
        previousStart,
        currentStart
    );

    const channels = CHANNEL_ORDER.map((channel) => {
        const totals = channelMap.get(channel)!;
        return {
            channel,
            orders: totals.orders,
            revenue_thb: round2(totals.revenue),
            share_percent:
                totalRevenue > 0
                    ? round2((totals.revenue / totalRevenue) * 100)
                    : 0,
        };
    }).sort((left, right) => {
        if (right.revenue_thb !== left.revenue_thb) {
            return right.revenue_thb - left.revenue_thb;
        }

        return CHANNEL_ORDER.indexOf(left.channel) -
            CHANNEL_ORDER.indexOf(right.channel);
    });
    const revenueTrend = buildRevenueTrend(orders, now);
    const orderAnalytics = buildOrderAnalytics(customers, orders);
    const pipelineStages = buildPipelineStages(customers);
    const salesPerformance = buildSalesPerformance(
        customers,
        orders,
        customerByRecordId
    );

    return {
        totals: {
            revenue_thb: round2(totalRevenue),
            total_leads: customers.length,
            close_rate_percent: closeRate,
            pending_orders: pendingOrders,
        },
        changes: {
            revenue_percent: percentChange(
                currentRevenue,
                previousRevenue
            ),
            leads_percent: percentChange(currentLeads, previousLeads),
            close_rate_percent: round2(
                currentCloseRate - previousCloseRate
            ),
            pending_orders_percent: percentChange(
                currentPendingCreated,
                previousPendingCreated
            ),
        },
        channels,
        revenue_trend: revenueTrend,
        action_counts: orderAnalytics.action_counts,
        pipeline_stages: pipelineStages,
        sales_performance: salesPerformance,
        order_statuses: orderAnalytics.order_statuses,
        recent_activities: mapRecentActivities(
            activities,
            language,
            customerNameByRecordId
        ),
        updated_at: new Date(now).toISOString(),
    };
}

/**
 * Entry point ที่ Route เรียกใช้
 * ใช้ single-flight เพื่อให้ request ซ้ำในเวลาเดียวกันรอ Promise ชุดเดียวแทนการยิง Lark ซ้ำ
 */
export async function getCommerceDashboardSummary(
    env: Env,
    language: DashboardLanguage,
    now = Date.now()
): Promise<CommerceDashboardSummary> {
    const cached = summaryCache.get(language);

    if (cached && cached.expires_at > now) {
        return cached.value;
    }

    const pending = pendingSummary.get(language);

    if (pending) {
        return await pending;
    }

    const request = buildCommerceDashboardSummary(
        env,
        language,
        now
    )
        .then((value) => {
            summaryCache.set(language, {
                expires_at: Date.now() + SUMMARY_CACHE_MS,
                value,
            });
            return value;
        })
        .finally(() => {
            pendingSummary.delete(language);
        });

    pendingSummary.set(language, request);
    return await request;
}

/** ใช้เฉพาะ Unit Test เพื่อไม่ให้ Cache จาก Test ก่อนหน้ารบกวนผลลัพธ์ */
export function clearCommerceDashboardCache(): void {
    summaryCache.clear();
    pendingSummary.clear();
}
