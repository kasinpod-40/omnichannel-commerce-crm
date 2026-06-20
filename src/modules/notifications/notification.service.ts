import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    NOTIFICATION_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import { sendLarkGroupText } from "../../providers/lark/lark-group-webhook.provider";
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
};

const NEXT_ACTIONS: Record<
    NotificationType,
    string
> = {
    NEW_LEAD: "ตรวจสอบข้อความและเริ่มติดต่อลูกค้า",
    HOT_LEAD: "รีบติดต่อลูกค้าและเสนอข้อมูลเพื่อปิดการขาย",
    PAYMENT_REVIEW: "ตรวจสอบสลิปและยอดชำระ",
    PAYMENT_VERIFIED: "เตรียมดำเนินการตามคำสั่งซื้อ",
    SALE_WON: "เตรียมจัดส่งและติดตามงานจนเสร็จสมบูรณ์",
    SALE_LOST: "ตรวจสอบสาเหตุและบันทึกหมายเหตุสำหรับติดตามภายหลัง",
};

function isNotificationType(
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

function getLastEventPart(eventId: string): string {
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

function parseNotificationSnapshot(
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
            quantity: normalizeSnapshotNumber(
                parsed.quantity,
                0
            ),
            total_amount: normalizeSnapshotNumber(
                parsed.total_amount,
                0
            ),
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
        quantity: getLarkNumber(
            order?.fields[ORDER_FIELDS.QUANTITY],
            0
        ),
        total_amount: getLarkNumber(
            order?.fields[ORDER_FIELDS.TOTAL_AMOUNT],
            0
        ),
    };
}

function buildNotificationLines(
    notificationType: NotificationType,
    snapshot: NotificationSnapshot
): string[] {
    const lines: string[] = [];

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

        if (snapshot.quantity > 0) {
            addLine(
                lines,
                "จำนวน",
                `${snapshot.quantity} ชิ้น`
            );
        }

        const amountLabel =
            notificationType === "SALE_WON"
                ? "ยอดขาย"
                : notificationType === "SALE_LOST"
                  ? "มูลค่าคำสั่งซื้อ"
                  : "ยอดชำระ";

        addLine(
            lines,
            amountLabel,
            formatAmount(snapshot.total_amount)
        );
    }

    if (notificationType === "SALE_LOST") {
        addLine(
            lines,
            "ข้อความล่าสุด",
            snapshot.last_message
        );
        addLine(lines, "สถานะ", "ยกเลิกการสั่งซื้อ");
    }

    if (notificationType === "PAYMENT_REVIEW") {
        addLine(lines, "สถานะ", "รอตรวจสอบสลิป");
    }

    if (notificationType === "PAYMENT_VERIFIED") {
        addLine(lines, "สถานะ", "ชำระเงินแล้ว");
    }

    if (notificationType === "SALE_WON") {
        addLine(lines, "สถานะ", "ปิดการขายสำเร็จ");
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

    return [
        `[CRM] ${NOTIFICATION_ICONS[typeText]} ${NOTIFICATION_LABELS[typeText]}`,
        "",
        ...detailLines,
        "",
        `สิ่งที่ต้องทำ: ${NEXT_ACTIONS[typeText]}`,
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

    const payload =
        normalizedNotification.payload ??
        (await captureNotificationSnapshot(
            env,
            normalizedNotification
        ));

    const created = await createNotification(
        env,
        {
            ...normalizedNotification,
            payload,
        }
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

    try {
        const delivery =
            await sendNotificationByRecordId(
                env,
                recorded.record.record_id
            );

        return {
            ...recorded,
            delivery,
        };
    } catch (error) {
        /*
         * การส่ง Notification ต้องไม่ทำให้ Flow CRM หลักล้ม
         * หากเกิดข้อผิดพลาดที่ไม่คาดคิด Record จะยังอยู่ใน
         * Pending/Failed เพื่อให้ /notification/send-pending
         * หรือระบบ Retry ในอนาคตส่งซ้ำได้
         */
        return {
            ...recorded,
            delivery: null,
            dispatch_error: getErrorMessage(error),
        };
    }
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

    if (previousStatus === "Sent") {
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
    const text = formatNotificationText(notification);

    try {
        const webhookResult =
            await sendLarkGroupText(env, text);

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
        const errorMessage =
            getErrorMessage(error);

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
