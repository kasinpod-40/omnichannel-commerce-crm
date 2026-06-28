import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    NOTIFICATION_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import {
    sendLarkGroupReviewCard,
    sendLarkGroupText,
} from "../../providers/lark/lark-group-webhook.provider";
import { buildLarkDashboardAppLink } from "../../providers/lark/lark-applink";
import { enqueueNotificationDelivery } from "../../queues/notification.producer";
import { classifyOperationalError } from "../../utils/errors";
import {
    getFirstLinkedRecordId,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { getCustomerByRecordId } from "../customers/customer.repository";
import { getOrderByRecordId } from "../orders/order.repository";
import { getPipelineByRecordId } from "../pipeline/pipeline.repository";
import {
    createNotification,
    findNotificationByEventId,
    findPendingNotifications,
    getNotificationByRecordId,
    updateNotificationDelivery,
    updateNotificationPayload,
    type LarkNotificationRecord,
} from "./notification.repository";
import type {
    Notification,
    NotificationSnapshot,
    NotificationStatus,
    NotificationType,
} from "./notification.types";

export type RecordNotificationResult = {
    duplicate: boolean;
    record: LarkNotificationRecord;
};

export type AutoDispatchNotificationResult =
    RecordNotificationResult & {
        delivery: SendNotificationResult | null;
        dispatch_error?: string;
    };

export type SendNotificationResult = {
    ok: boolean;
    notification_record_id: string;
    notification_type: string;
    previous_status: string;
    status: "Sent" | "Failed";
    already_sent: boolean;
    attempt_count: number;
    webhook_response?: unknown;
    error_message?: string;
    error_code?: string;
    retryable?: boolean;
    record?: LarkNotificationRecord;
};

export type SendPendingNotificationsResult = {
    ok: boolean;
    requested_limit: number;
    found: number;
    sent: number;
    failed: number;
    already_sent: number;
    results: SendNotificationResult[];
};

const NOTIFICATION_LABELS: Record<
    NotificationType,
    string
> = {
    NEW_LEAD: "มีลูกค้าใหม่",
    HOT_LEAD: "พบลูกค้าที่มีโอกาสซื้อสูง",
    PAYMENT_REVIEW: "มีการชำระเงินรอตรวจสอบ",
    PAYMENT_VERIFIED: "ยืนยันการชำระเงินสำเร็จ",
    SALE_WON: "ปิดการขายสำเร็จ",
    SALE_LOST: "ลูกค้ายกเลิกการสั่งซื้อ",
    PAYMENT_OVERDUE: "คำสั่งซื้อเกินกำหนดชำระเงิน",
};

const NOTIFICATION_ICONS: Record<
    NotificationType,
    string
> = {
    NEW_LEAD: "🆕",
    HOT_LEAD: "🔥",
    PAYMENT_REVIEW: "🧾",
    PAYMENT_VERIFIED: "✅",
    SALE_WON: "🎉",
    SALE_LOST: "❌",
    PAYMENT_OVERDUE: "⏰",
};

const NEXT_ACTIONS: Record<
    NotificationType,
    string
> = {
    NEW_LEAD: "ตรวจสอบข้อความและเริ่มติดต่อลูกค้า",
    HOT_LEAD: "รีบติดต่อลูกค้าและเสนอข้อมูลเพื่อปิดการขาย",
    PAYMENT_REVIEW: "ตรวจสอบสลิปและยอดโอน",
    PAYMENT_VERIFIED: "เตรียมดำเนินการตามคำสั่งซื้อ",
    SALE_WON: "เตรียมจัดส่งและติดตามงานจนเสร็จสมบูรณ์",
    SALE_LOST: "ตรวจสอบสาเหตุและบันทึกหมายเหตุสำหรับติดตามภายหลัง",
    PAYMENT_OVERDUE: "ติดต่อลูกค้าเพื่อติดตามการชำระเงิน",
};

export function isNotificationType(
    value: string
): value is NotificationType {
    return Object.prototype.hasOwnProperty.call(
        NOTIFICATION_LABELS,
        value
    );
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message.slice(0, 1000);
    }

    return String(error).slice(0, 1000);
}

export function getLastEventPart(eventId: string): string {
    const parts = eventId
        .split(":")
        .map((part) => part.trim())
        .filter(Boolean);

    return parts.at(-1) ?? "";
}

function formatStage(stage: string): string {
    const labels: Record<string, string> = {
        "New Lead": "ลูกค้าใหม่",
        Interested: "สนใจสินค้า",
        Negotiating: "กำลังเจรจา",
        Closing: "ใกล้ปิดการขาย",
        Won: "ปิดการขายแล้ว",
        Lost: "ยกเลิกหรือไม่สนใจ",
    };

    return labels[stage] ?? (stage || "ยังไม่ได้ระบุ");
}

function formatSalesOwner(owner: string): string {
    const normalized = owner.trim();

    if (
        !normalized ||
        normalized.toLowerCase() === "unassigned"
    ) {
        return "ยังไม่ได้มอบหมาย";
    }

    return normalized;
}

function formatAmount(amount: number): string {
    if (!Number.isFinite(amount) || amount <= 0) {
        return "ยังไม่ได้ระบุยอด";
    }

    return `${new Intl.NumberFormat("th-TH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(amount)} บาท`;
}

function isMarketplaceSnapshot(
    snapshot: NotificationSnapshot
): boolean {
    return ["Shopee", "Lazada", "TikTok"].includes(
        snapshot.channel
    );
}

function marketplaceNotificationTitle(
    notificationType: NotificationType,
    snapshot: NotificationSnapshot
): string | null {
    if (!isMarketplaceSnapshot(snapshot)) {
        return null;
    }

    if (notificationType === "SALE_WON") {
        return snapshot.marketplace_event_kind === "completed"
            ? `✅ คำสั่งซื้อ ${snapshot.channel} เสร็จสมบูรณ์`
            : `🛒 มีคำสั่งซื้อใหม่จาก ${snapshot.channel}`;
    }

    if (notificationType === "SALE_LOST") {
        return `❌ คำสั่งซื้อ ${snapshot.channel} ถูกยกเลิก`;
    }

    return null;
}

function marketplaceNextAction(
    notificationType: NotificationType,
    snapshot: NotificationSnapshot
): string | null {
    if (!isMarketplaceSnapshot(snapshot)) {
        return null;
    }

    if (notificationType === "SALE_WON") {
        return snapshot.marketplace_event_kind === "completed"
            ? "ตรวจสอบความเรียบร้อยของคำสั่งซื้อและปิดงานใน CRM"
            : "ตรวจสอบคำสั่งซื้อและเตรียมดำเนินการตามสถานะใน Marketplace";
    }

    if (notificationType === "SALE_LOST") {
        return "ตรวจสอบเหตุผลการยกเลิก คืนสินค้า หรือคืนเงินใน Marketplace";
    }

    return null;
}

function addLine(
    lines: string[],
    label: string,
    value: string | number | null | undefined
): void {
    if (value === null || value === undefined) {
        return;
    }

    const text = String(value).trim();

    if (!text) {
        return;
    }

    lines.push(`${label}: ${text}`);
}

function normalizeSnapshotString(
    value: unknown,
    fallback = ""
): string {
    return typeof value === "string"
        ? value.trim()
        : fallback;
}

function normalizeSnapshotNumber(
    value: unknown,
    fallback = 0
): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string") {
        const parsed = Number(value);

        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return fallback;
}

export function parseNotificationSnapshot(
    record: LarkNotificationRecord
): NotificationSnapshot | null {
    const payloadText = getLarkText(
        record.fields[NOTIFICATION_FIELDS.PAYLOAD_JSON],
        ""
    ).trim();

    if (!payloadText) {
        return null;
    }

    try {
        const parsed = JSON.parse(payloadText) as Record<
            string,
            unknown
        >;

        if (parsed.version !== 1) {
            return null;
        }

        return {
            version: 1,
            captured_at: normalizeSnapshotNumber(
                parsed.captured_at,
                0
            ),
            customer_name: normalizeSnapshotString(
                parsed.customer_name,
                "ไม่ทราบชื่อลูกค้า"
            ),
            channel: normalizeSnapshotString(
                parsed.channel,
                "ไม่ระบุ"
            ),
            phone: normalizeSnapshotString(parsed.phone),
            current_stage: normalizeSnapshotString(
                parsed.current_stage
            ),
            lead_score: normalizeSnapshotNumber(
                parsed.lead_score,
                0
            ),
            last_message: normalizeSnapshotString(
                parsed.last_message
            ),
            sales_owner: normalizeSnapshotString(
                parsed.sales_owner,
                "Unassigned"
            ),
            order_number: normalizeSnapshotString(
                parsed.order_number
            ),
            product_name: normalizeSnapshotString(
                parsed.product_name
            ),
            product_size: normalizeSnapshotString(
                parsed.product_size
            ),
            quantity: normalizeSnapshotNumber(
                parsed.quantity,
                0
            ),
            total_amount: normalizeSnapshotNumber(
                parsed.total_amount,
                0
            ),
            slip_amount: normalizeSnapshotNumber(
                parsed.slip_amount,
                0
            ),
            payment_status: normalizeSnapshotString(
                parsed.payment_status
            ),
            order_status: normalizeSnapshotString(
                parsed.order_status
            ),
            marketplace_event_kind:
                parsed.marketplace_event_kind === "completed" ||
                parsed.marketplace_event_kind === "cancelled" ||
                parsed.marketplace_event_kind === "created"
                    ? parsed.marketplace_event_kind
                    : undefined,
            dashboard_read_at: (() => {
                const value = normalizeSnapshotNumber(parsed.dashboard_read_at, 0);
                return value > 0 ? value : undefined;
            })(),
            review_resolved_at: (() => {
                const value = normalizeSnapshotNumber(parsed.review_resolved_at, 0);
                return value > 0 ? value : undefined;
            })(),
        };
    } catch {
        return null;
    }
}

async function captureNotificationSnapshot(
    env: Env,
    notification: Notification
): Promise<NotificationSnapshot> {
    const customer = await getCustomerByRecordId(
        env,
        notification.customer_record_id
    );

    const eventId = notification.event_id.trim();
    let orderRecordId = "";
    let pipelineRecordId = "";

    if (
        notification.notification_type === "PAYMENT_REVIEW" ||
        notification.notification_type === "PAYMENT_VERIFIED"
    ) {
        orderRecordId = getLastEventPart(eventId);
    }

    if (
        notification.notification_type === "SALE_WON" ||
        notification.notification_type === "SALE_LOST"
    ) {
        pipelineRecordId = getLastEventPart(eventId);
    }

    const pipeline = pipelineRecordId
        ? await getPipelineByRecordId(
              env,
              pipelineRecordId
          )
        : null;

    if (!orderRecordId && pipeline) {
        orderRecordId =
            getFirstLinkedRecordId(
                pipeline.fields[PIPELINE_FIELDS.ORDER]
            ) ?? "";
    }

    const order = orderRecordId
        ? await getOrderByRecordId(env, orderRecordId)
        : null;

    return {
        version: 1,
        captured_at: Date.now(),
        customer_name: getLarkText(
            customer?.fields[
                CUSTOMER_FIELDS.CUSTOMER_NAME
            ],
            getLarkText(
                order?.fields[ORDER_FIELDS.CUSTOMER_NAME],
                "ไม่ทราบชื่อลูกค้า"
            )
        ).trim(),
        channel: getLarkText(
            customer?.fields[CUSTOMER_FIELDS.CHANNEL],
            getLarkText(
                order?.fields[ORDER_FIELDS.CHANNEL],
                "ไม่ระบุ"
            )
        ).trim(),
        phone: getLarkText(
            customer?.fields[CUSTOMER_FIELDS.PHONE],
            getLarkText(
                order?.fields[ORDER_FIELDS.PHONE],
                ""
            )
        ).trim(),
        current_stage: getLarkText(
            customer?.fields[
                CUSTOMER_FIELDS.CURRENT_STAGE
            ],
            ""
        ).trim(),
        lead_score: getLarkNumber(
            customer?.fields[CUSTOMER_FIELDS.LEAD_SCORE],
            0
        ),
        last_message: getLarkText(
            customer?.fields[
                CUSTOMER_FIELDS.LAST_MESSAGE
            ],
            ""
        ).trim(),
        sales_owner: getLarkText(
            customer?.fields[
                CUSTOMER_FIELDS.SALES_OWNER
            ],
            getLarkText(
                order?.fields[ORDER_FIELDS.SALES_OWNER],
                "Unassigned"
            )
        ).trim(),
        order_number: getLarkText(
            order?.fields[ORDER_FIELDS.ORDER_NUMBER],
            ""
        ).trim(),
        product_name: getLarkText(
            order?.fields[ORDER_FIELDS.PRODUCT_NAME],
            ""
        ).trim(),
        product_size: getLarkText(
            order?.fields[ORDER_FIELDS.PRODUCT_SIZE],
            ""
        ).trim(),
        quantity: getLarkNumber(
            order?.fields[ORDER_FIELDS.QUANTITY],
            0
        ),
        total_amount: getLarkNumber(
            order?.fields[ORDER_FIELDS.TOTAL_AMOUNT],
            0
        ),
        slip_amount: getLarkNumber(
            order?.fields[ORDER_FIELDS.SLIP_AMOUNT],
            0
        ),
        payment_status: getLarkText(
            order?.fields[ORDER_FIELDS.PAYMENT_STATUS],
            ""
        ).trim(),
        order_status: getLarkText(
            order?.fields[ORDER_FIELDS.ORDER_STATUS],
            ""
        ).trim(),
    };
}

function buildNotificationLines(
    notificationType: NotificationType,
    snapshot: NotificationSnapshot
): string[] {
    const lines: string[] = [];
    const marketplace = isMarketplaceSnapshot(snapshot);

    addLine(lines, "ลูกค้า", snapshot.customer_name);
    addLine(lines, "ช่องทาง", snapshot.channel);

    if (snapshot.phone) {
        addLine(lines, "โทรศัพท์", snapshot.phone);
    }

    if (notificationType === "HOT_LEAD") {
        addLine(
            lines,
            "คะแนนความสนใจ",
            `${snapshot.lead_score}/100`
        );
    }

    if (
        notificationType === "NEW_LEAD" ||
        notificationType === "HOT_LEAD"
    ) {
        addLine(
            lines,
            "ข้อความล่าสุด",
            snapshot.last_message
        );
        addLine(
            lines,
            "สถานะ",
            formatStage(snapshot.current_stage)
        );
    }

    if (
        notificationType === "PAYMENT_REVIEW" ||
        notificationType === "PAYMENT_VERIFIED" ||
        notificationType === "SALE_WON" ||
        notificationType === "SALE_LOST"
    ) {
        addLine(
            lines,
            "เลขที่คำสั่งซื้อ",
            snapshot.order_number
        );
        addLine(lines, "สินค้า", snapshot.product_name);

        if (snapshot.product_size) {
            addLine(lines, "ไซส์/ขนาด", snapshot.product_size);
        }

        if (snapshot.quantity > 0) {
            addLine(
                lines,
                "จำนวน",
                `${snapshot.quantity} ชิ้น`
            );
        }

        if (
            notificationType === "PAYMENT_REVIEW" ||
            notificationType === "PAYMENT_VERIFIED" ||
            (notificationType === "SALE_WON" && !marketplace) ||
            snapshot.slip_amount > 0
        ) {
            addLine(
                lines,
                "ยอดโอน",
                snapshot.slip_amount > 0
                    ? formatAmount(snapshot.slip_amount)
                    : "ยังอ่านยอดจากสลิปไม่ได้"
            );
        }

        if (
            marketplace &&
            (notificationType === "SALE_WON" ||
                notificationType === "SALE_LOST")
        ) {
            addLine(
                lines,
                "ยอดรวม",
                formatAmount(snapshot.total_amount)
            );
            addLine(
                lines,
                "สถานะชำระเงิน",
                snapshot.payment_status
            );
            addLine(
                lines,
                "สถานะคำสั่งซื้อ",
                snapshot.order_status
            );
        }
    }

    if (notificationType === "SALE_LOST") {
        addLine(
            lines,
            "ข้อความล่าสุด",
            snapshot.last_message
        );
        addLine(
            lines,
            "สถานะ",
            marketplace
                ? "ยกเลิกหรือคืนสินค้าใน Marketplace"
                : "ยกเลิกการสั่งซื้อ"
        );
    }

    if (notificationType === "PAYMENT_REVIEW") {
        addLine(
            lines,
            "สถานะ",
            snapshot.order_number
                ? "รอตรวจสอบสลิป"
                : "ได้รับสลิปแล้ว รอผูกคำสั่งซื้อ"
        );
    }

    if (notificationType === "PAYMENT_VERIFIED") {
        addLine(
            lines,
            "สถานะ",
            snapshot.order_status === "Waiting Address"
                ? "ชำระเงินแล้ว — รอที่อยู่จัดส่ง"
                : "ชำระเงินแล้ว"
        );
    }

    if (notificationType === "SALE_WON") {
        addLine(
            lines,
            "สถานะ",
            marketplace
                ? snapshot.marketplace_event_kind === "completed"
                    ? "คำสั่งซื้อสำเร็จแล้ว"
                    : "ได้รับคำสั่งซื้อใหม่"
                : "ปิดการขายสำเร็จ"
        );
    }

    if (notificationType === "PAYMENT_OVERDUE") {
        addLine(lines, "สถานะ", "เกินกำหนดชำระเงิน");
    }

    addLine(
        lines,
        "ผู้ดูแล",
        formatSalesOwner(snapshot.sales_owner)
    );

    return lines;
}

function formatNotificationText(
    record: LarkNotificationRecord
): string {
    const typeText = getLarkText(
        record.fields[
            NOTIFICATION_FIELDS.NOTIFICATION_TYPE
        ],
        ""
    ).trim();

    const fallbackMessage = getLarkText(
        record.fields[NOTIFICATION_FIELDS.MESSAGE],
        ""
    ).trim();

    if (!isNotificationType(typeText)) {
        return [
            "[CRM] 🔔 การแจ้งเตือน",
            "",
            fallbackMessage || "ไม่มีรายละเอียด",
        ].join("\n");
    }

    const snapshot = parseNotificationSnapshot(record);

    if (!snapshot) {
        return [
            `[CRM] ${NOTIFICATION_ICONS[typeText]} ${NOTIFICATION_LABELS[typeText]}`,
            "",
            fallbackMessage || "ไม่มีรายละเอียด",
        ].join("\n");
    }

    const detailLines = buildNotificationLines(
        typeText,
        snapshot
    );
    const marketplaceTitle = marketplaceNotificationTitle(
        typeText,
        snapshot
    );
    const marketplaceAction = marketplaceNextAction(
        typeText,
        snapshot
    );

    return [
        `[CRM] ${marketplaceTitle ?? `${NOTIFICATION_ICONS[typeText]} ${NOTIFICATION_LABELS[typeText]}`}`,
        "",
        ...detailLines,
        "",
        `สิ่งที่ต้องทำ: ${
            marketplaceAction ??
            (typeText === "PAYMENT_REVIEW" &&
            !snapshot.order_number
                ? "ตรวจสอบข้อมูลลูกค้าและผูกสลิปกับคำสั่งซื้อ"
                : typeText === "PAYMENT_VERIFIED" &&
                    snapshot.order_status === "Waiting Address"
                  ? "ติดต่อลูกค้าเพื่อขอชื่อ เบอร์โทร และที่อยู่จัดส่ง"
                  : NEXT_ACTIONS[typeText])
        }`,
    ]
        .filter((line, index, array) => {
            if (line !== "") {
                return true;
            }

            return (
                index > 0 &&
                index < array.length - 1 &&
                array[index - 1] !== ""
            );
        })
        .join("\n");
}

export async function recordNotificationOnce(
    env: Env,
    notification: Notification
): Promise<RecordNotificationResult> {
    const normalizedEventId =
        notification.event_id.trim();

    if (!normalizedEventId) {
        throw new Error(
            "Notification event_id is required"
        );
    }

    const existing =
        await findNotificationByEventId(
            env,
            normalizedEventId
        );

    if (existing) {
        return {
            duplicate: true,
            record: existing,
        };
    }

    const normalizedNotification: Notification = {
        ...notification,
        event_id: normalizedEventId,
        message: notification.message.trim(),
        status: notification.status ?? "Pending",
    };

    const created = await createNotification(
        env,
        normalizedNotification
    );

    return {
        duplicate: false,
        record: created,
    };
}

export async function recordAndDispatchNotificationOnce(
    env: Env,
    notification: Notification
): Promise<AutoDispatchNotificationResult> {
    const recorded = await recordNotificationOnce(
        env,
        notification
    );

    const existingStatus = getLarkText(
        recorded.record.fields[
            NOTIFICATION_FIELDS.STATUS
        ],
        "Pending"
    ).trim();

    if (
        recorded.duplicate &&
        (existingStatus === "Sent" || existingStatus === "Read")
    ) {
        return {
            ...recorded,
            delivery: null,
        };
    }

    /*
     * PAYMENT_REVIEW เป็นงานที่คนต้องเห็นทันที จึงลองส่ง Lark Group Card
     * ใน request ปัจจุบันก่อน แล้วใช้ Queue เป็น fallback เมื่อ Webhook ล้มเหลว
     * Queue ที่มาทีหลังจะเห็นสถานะ Sent และไม่ส่งซ้ำ
     */
    if (notification.notification_type === "PAYMENT_REVIEW") {
        try {
            const delivery = await sendNotificationByRecordId(
                env,
                recorded.record.record_id
            );

            if (delivery.ok) {
                return {
                    ...recorded,
                    delivery,
                };
            }

            if (delivery.retryable !== false) {
                try {
                    await enqueueNotificationDelivery(env, {
                        schema_version: 1,
                        notification_record_id: recorded.record.record_id,
                        event_id: notification.event_id,
                        created_at: Date.now(),
                    });
                } catch (queueError) {
                    return {
                        ...recorded,
                        delivery,
                        dispatch_error: `${delivery.error_message ?? "Payment review delivery failed"}; queue: ${getErrorMessage(queueError)}`,
                    };
                }
            }

            return {
                ...recorded,
                delivery,
                dispatch_error: delivery.error_message,
            };
        } catch (error) {
            try {
                await enqueueNotificationDelivery(env, {
                    schema_version: 1,
                    notification_record_id: recorded.record.record_id,
                    event_id: notification.event_id,
                    created_at: Date.now(),
                });
            } catch (queueError) {
                return {
                    ...recorded,
                    delivery: null,
                    dispatch_error: `${getErrorMessage(error)}; queue: ${getErrorMessage(queueError)}`,
                };
            }

            return {
                ...recorded,
                delivery: null,
                dispatch_error: getErrorMessage(error),
            };
        }
    }

    try {
        await enqueueNotificationDelivery(env, {
            schema_version: 1,
            notification_record_id:
                recorded.record.record_id,
            event_id: notification.event_id,
            created_at: Date.now(),
        });

        return {
            ...recorded,
            delivery: null,
        };
    } catch (error) {
        /*
         * Record ยังถูกเก็บเป็น Pending แม้ Queue ส่งไม่สำเร็จ
         * จึงสามารถใช้ /notification/send-pending ส่งซ้ำได้
         * โดยไม่ทำให้ CRM หลักล้มตาม Notification
         */
        return {
            ...recorded,
            delivery: null,
            dispatch_error: getErrorMessage(error),
        };
    }
}

export async function ensureNotificationSnapshot(
    env: Env,
    record: LarkNotificationRecord
): Promise<LarkNotificationRecord> {
    const existingSnapshot = parseNotificationSnapshot(record);
    if (existingSnapshot && existingSnapshot.captured_at > 0) {
        return record;
    }

    const typeText = getLarkText(
        record.fields[NOTIFICATION_FIELDS.NOTIFICATION_TYPE],
        ""
    ).trim();

    if (!isNotificationType(typeText)) {
        return record;
    }

    const customerRecordId =
        getFirstLinkedRecordId(
            record.fields[NOTIFICATION_FIELDS.CUSTOMER]
        ) ?? "";

    if (!customerRecordId) {
        return record;
    }

    const snapshot = await captureNotificationSnapshot(
        env,
        {
            event_id: getLarkText(
                record.fields[NOTIFICATION_FIELDS.EVENT_ID],
                ""
            ),
            notification_type: typeText,
            customer_record_id: customerRecordId,
            message: getLarkText(
                record.fields[NOTIFICATION_FIELDS.MESSAGE],
                ""
            ),
            status: getLarkText(
                record.fields[NOTIFICATION_FIELDS.STATUS],
                "Pending"
            ) as NotificationStatus,
        }
    );
    const nextSnapshot: NotificationSnapshot = {
        ...snapshot,
        ...(existingSnapshot?.dashboard_read_at
            ? { dashboard_read_at: existingSnapshot.dashboard_read_at }
            : {}),
        ...(existingSnapshot?.review_resolved_at
            ? { review_resolved_at: existingSnapshot.review_resolved_at }
            : {}),
    };

    const updated = await updateNotificationPayload(
        env,
        record.record_id,
        nextSnapshot as unknown as Record<string, unknown>
    );

    return {
        ...record,
        ...updated,
        fields: {
            ...record.fields,
            ...updated.fields,
            [NOTIFICATION_FIELDS.PAYLOAD_JSON]: JSON.stringify(nextSnapshot),
        },
    };
}

export async function markNotificationDashboardRead(
    env: Env,
    record: LarkNotificationRecord,
    readAt = Date.now()
): Promise<LarkNotificationRecord> {
    const hydrated = await ensureNotificationSnapshot(env, record);
    const snapshot = parseNotificationSnapshot(hydrated);
    const nextPayload: Record<string, unknown> = snapshot
        ? { ...snapshot, dashboard_read_at: snapshot.dashboard_read_at ?? readAt }
        : { version: 1, captured_at: 0, dashboard_read_at: readAt };

    if (snapshot?.dashboard_read_at) {
        return hydrated;
    }

    return await updateNotificationPayload(env, record.record_id, nextPayload);
}

/** ปิด Payment Review ที่ดำเนินการแล้ว โดยไม่ต้องเพิ่ม Select option ใหม่ใน Lark Base */
export async function markPaymentReviewNotificationResolved(
    env: Env,
    record: LarkNotificationRecord,
    resolvedAt = Date.now()
): Promise<LarkNotificationRecord> {
    const hydrated = await ensureNotificationSnapshot(env, record);
    const snapshot = parseNotificationSnapshot(hydrated);
    const nextPayload: Record<string, unknown> = snapshot
        ? {
              ...snapshot,
              dashboard_read_at: snapshot.dashboard_read_at ?? resolvedAt,
              review_resolved_at: snapshot.review_resolved_at ?? resolvedAt,
          }
        : {
              version: 1,
              captured_at: 0,
              dashboard_read_at: resolvedAt,
              review_resolved_at: resolvedAt,
          };
    const payloadUpdated = snapshot?.review_resolved_at
        ? hydrated
        : await updateNotificationPayload(env, record.record_id, nextPayload);
    const status = getLarkText(
        record.fields[NOTIFICATION_FIELDS.STATUS],
        "Pending"
    ).trim();

    if (status === "Sent" || status === "Read") {
        return payloadUpdated;
    }

    const attemptCount = getLarkNumber(
        record.fields[NOTIFICATION_FIELDS.ATTEMPT_COUNT],
        0
    );
    const deliveryUpdated = await updateNotificationDelivery(
        env,
        record.record_id,
        {
            status: "Sent",
            attempt_count: attemptCount,
            sent_at: resolvedAt,
            error_message: "",
        }
    );

    return {
        ...payloadUpdated,
        ...deliveryUpdated,
        fields: {
            ...payloadUpdated.fields,
            ...deliveryUpdated.fields,
            [NOTIFICATION_FIELDS.PAYLOAD_JSON]: JSON.stringify(nextPayload),
            [NOTIFICATION_FIELDS.STATUS]: "Sent",
        },
    };
}

export async function sendNotificationByRecordId(
    env: Env,
    notificationRecordId: string
): Promise<SendNotificationResult> {
    const normalizedRecordId =
        notificationRecordId.trim();

    if (!normalizedRecordId) {
        throw new Error(
            "notification_record_id is required"
        );
    }

    const notification =
        await getNotificationByRecordId(
            env,
            normalizedRecordId
        );

    if (!notification) {
        throw new Error(
            `Notification not found: ${normalizedRecordId}`
        );
    }

    const previousStatus = getLarkText(
        notification.fields[
            NOTIFICATION_FIELDS.STATUS
        ],
        "Pending"
    ).trim() as NotificationStatus;

    const notificationType = getLarkText(
        notification.fields[
            NOTIFICATION_FIELDS.NOTIFICATION_TYPE
        ],
        "UNKNOWN"
    ).trim();

    const previousAttempts = getLarkNumber(
        notification.fields[
            NOTIFICATION_FIELDS.ATTEMPT_COUNT
        ],
        0
    );

    if (previousStatus === "Sent" || previousStatus === "Read") {
        return {
            ok: true,
            notification_record_id:
                notification.record_id,
            notification_type: notificationType,
            previous_status: previousStatus,
            status: "Sent",
            already_sent: true,
            attempt_count: previousAttempts,
            record: notification,
        };
    }

    const nextAttemptCount = previousAttempts + 1;
    const hydratedNotification =
        await ensureNotificationSnapshot(
            env,
            notification
        );
    const hydratedSnapshot = parseNotificationSnapshot(hydratedNotification);

    if (notificationType === "PAYMENT_REVIEW" && hydratedSnapshot?.review_resolved_at) {
        const terminalRecord = await updateNotificationDelivery(
            env,
            notification.record_id,
            {
                status: "Sent",
                attempt_count: previousAttempts,
                sent_at: hydratedSnapshot.review_resolved_at,
                error_message: "",
            }
        );
        return {
            ok: true,
            notification_record_id: notification.record_id,
            notification_type: notificationType,
            previous_status: previousStatus,
            status: "Sent",
            already_sent: true,
            attempt_count: previousAttempts,
            record: terminalRecord,
        };
    }

    const text = formatNotificationText(
        hydratedNotification
    );

    try {
        const snapshot = hydratedSnapshot;
        const eventId = getLarkText(
            hydratedNotification.fields[
                NOTIFICATION_FIELDS.EVENT_ID
            ],
            ""
        ).trim();
        const orderRecordId =
            notificationType === "PAYMENT_REVIEW" &&
            snapshot?.order_number
                ? getLastEventPart(eventId)
                : "";
        const reviewPath = orderRecordId
            ? `/orders/${encodeURIComponent(orderRecordId)}?review=1&notification=${encodeURIComponent(notification.record_id)}`
            : "";
        const reviewUrl = reviewPath
            ? buildLarkDashboardAppLink(env, reviewPath)
            : "";

        const webhookResult = reviewUrl
            ? await sendLarkGroupReviewCard(env, {
                  title: "🧾 มีการชำระเงินรอตรวจสอบ",
                  markdown: text.replace(/^\[CRM\]\s*/u, ""),
                  button_text: "เปิดตรวจสอบ",
                  button_url: reviewUrl,
              })
            : await sendLarkGroupText(env, text);

        const updated =
            await updateNotificationDelivery(
                env,
                notification.record_id,
                {
                    status: "Sent",
                    attempt_count:
                        nextAttemptCount,
                    sent_at: Date.now(),
                    error_message: "",
                }
            );

        return {
            ok: true,
            notification_record_id:
                notification.record_id,
            notification_type: notificationType,
            previous_status: previousStatus,
            status: "Sent",
            already_sent: false,
            attempt_count: nextAttemptCount,
            webhook_response:
                webhookResult.response,
            record: updated,
        };
    } catch (error) {
        const classification = classifyOperationalError(error);
        const errorMessage = classification.message;

        let updated:
            | LarkNotificationRecord
            | undefined;

        try {
            updated =
                await updateNotificationDelivery(
                    env,
                    notification.record_id,
                    {
                        status: "Failed",
                        attempt_count:
                            nextAttemptCount,
                        sent_at: null,
                        error_message:
                            errorMessage,
                    }
                );
        } catch {
            updated = undefined;
        }

        return {
            ok: false,
            notification_record_id:
                notification.record_id,
            notification_type: notificationType,
            previous_status: previousStatus,
            status: "Failed",
            already_sent: false,
            attempt_count: nextAttemptCount,
            error_message: errorMessage,
            error_code: classification.code,
            retryable: classification.retryable,
            record: updated,
        };
    }
}

export async function sendPendingNotifications(
    env: Env,
    limit = 10
): Promise<SendPendingNotificationsResult> {
    const safeLimit = Math.min(
        Math.max(Math.trunc(limit), 1),
        20
    );

    const pending =
        await findPendingNotifications(
            env,
            safeLimit
        );

    const results: SendNotificationResult[] = [];

    for (const notification of pending) {
        const result =
            await sendNotificationByRecordId(
                env,
                notification.record_id
            );

        results.push(result);
    }

    const sent = results.filter(
        (result) =>
            result.status === "Sent" &&
            !result.already_sent
    ).length;

    const failed = results.filter(
        (result) => result.status === "Failed"
    ).length;

    const alreadySent = results.filter(
        (result) => result.already_sent
    ).length;

    return {
        ok: failed === 0,
        requested_limit: safeLimit,
        found: pending.length,
        sent,
        failed,
        already_sent: alreadySent,
        results,
    };
}
