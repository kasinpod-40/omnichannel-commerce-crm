import type { Env } from "../../config/env";
import {
    ACTIVITY_FIELDS,
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import {
    getFirstLinkedRecordId,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
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
type LarkRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

type CachedSummary = {
    expires_at: number;
    value: CommerceDashboardSummary;
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
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

        if (channel) {
            channelMap.get(channel)!.orders += 1;
        }

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
