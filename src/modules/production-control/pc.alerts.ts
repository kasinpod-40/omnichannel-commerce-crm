import type { Env } from "../../config/env";
import { NOTIFICATION_FIELDS } from "../../core/lark-fields";
import { sendLarkGroupText } from "../../providers/lark/lark-group-webhook.provider";
import { enqueueNotificationDelivery } from "../../queues/notification.producer";
import { classifyOperationalError } from "../../utils/errors";
import {
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { updateNotificationDelivery } from "../notifications/notification.repository";
import {
    recordNotificationOnce,
    sendNotificationByRecordId,
} from "../notifications/notification.service";
import type {
    NotificationSnapshot,
    NotificationType,
} from "../notifications/notification.types";

async function enqueuePcNotification(
    env: Env,
    input: {
        notification_record_id: string;
        event_id: string;
    }
): Promise<boolean> {
    try {
        await enqueueNotificationDelivery(env, {
            schema_version: 1,
            notification_record_id: input.notification_record_id,
            event_id: input.event_id,
            created_at: Date.now(),
        });
        return true;
    } catch (error) {
        console.error("PC_EXCEPTION_NOTIFICATION_QUEUE_FAILED", {
            event_id: input.event_id,
            notification_record_id: input.notification_record_id,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}

/**
 * ส่งข้อความ Low-stock ที่จัดรูปแบบสำหรับทีมงานโดยตรง แล้วบันทึกสถานะกลับเข้า
 * Notifications table. หาก Webhook ล้มเหลวแบบชั่วคราว จะใช้ Queue เดิมเป็น fallback.
 */
async function sendReadablePcText(
    env: Env,
    input: {
        event_id: string;
        notification_record_id: string;
        duplicate: boolean;
        fields: Record<string, unknown>;
        text: string;
    }
): Promise<boolean> {
    const currentStatus = getLarkText(
        input.fields[NOTIFICATION_FIELDS.STATUS],
        "Pending"
    ).trim();

    if (
        input.duplicate &&
        (currentStatus === "Sent" || currentStatus === "Read")
    ) {
        return true;
    }

    const nextAttempt =
        getLarkNumber(
            input.fields[NOTIFICATION_FIELDS.ATTEMPT_COUNT],
            0
        ) + 1;

    try {
        await sendLarkGroupText(env, input.text);

        try {
            await updateNotificationDelivery(
                env,
                input.notification_record_id,
                {
                    status: "Sent",
                    attempt_count: nextAttempt,
                    sent_at: Date.now(),
                    error_message: "",
                }
            );
        } catch (auditError) {
            // ข้อความส่งถึงกลุ่มแล้ว ห้าม Queue ซ้ำเพียงเพราะอัปเดต Audit ไม่สำเร็จ
            console.error("PC_EXCEPTION_NOTIFICATION_AUDIT_FAILED", {
                event_id: input.event_id,
                notification_record_id: input.notification_record_id,
                error:
                    auditError instanceof Error
                        ? auditError.message
                        : String(auditError),
            });
        }

        return true;
    } catch (error) {
        const classification = classifyOperationalError(error);

        try {
            await updateNotificationDelivery(
                env,
                input.notification_record_id,
                {
                    status: "Failed",
                    attempt_count: nextAttempt,
                    sent_at: null,
                    error_message: classification.message,
                }
            );
        } catch {
            // การบันทึก Error เป็น best effort; การตัดสิน retry ใช้ Error ต้นทาง
        }

        if (!classification.retryable) {
            console.error("PC_EXCEPTION_NOTIFICATION_FAILED", {
                event_id: input.event_id,
                notification_record_id: input.notification_record_id,
                code: classification.code,
                error: classification.message,
            });
            return false;
        }

        return await enqueuePcNotification(env, {
            notification_record_id: input.notification_record_id,
            event_id: input.event_id,
        });
    }
}

/**
 * บันทึกและส่ง Notification ของ Production & Stock แบบทันที.
 * Low-stock สามารถส่งข้อความที่อ่านง่ายผ่าน lark_text ได้ โดยยังคง Record, retry,
 * Queue fallback และ idempotency เดิมครบถ้วน.
 */
export async function notifyPcExceptionOnce(
    env: Env,
    input: {
        event_id: string;
        type: Extract<
            NotificationType,
            "PC_STOCK_EXCEPTION" | "PC_MATERIAL_SHORTAGE"
        >;
        reference_id: string;
        product_name: string;
        detail: string;
        next_action: string;
        lark_text?: string;
    }
): Promise<boolean> {
    const payload: NotificationSnapshot = {
        version: 1,
        captured_at: Date.now(),
        customer_name: "ฝ่ายผลิตและคลังสินค้า",
        channel: "Lark Base",
        phone: "",
        current_stage: "",
        lead_score: 0,
        last_message: input.detail,
        sales_owner: "Unassigned",
        order_number: "",
        product_name: input.product_name,
        quantity: 0,
        total_amount: 0,
        slip_amount: 0,
        pc_reference_id: input.reference_id,
        pc_detail: input.detail,
        pc_next_action: input.next_action,
    };

    try {
        const recorded = await recordNotificationOnce(env, {
            event_id: input.event_id,
            notification_type: input.type,
            message: input.lark_text?.trim() || input.detail,
            payload,
        });
        const readableText = input.lark_text?.trim();

        if (readableText) {
            return await sendReadablePcText(env, {
                event_id: input.event_id,
                notification_record_id: recorded.record.record_id,
                duplicate: recorded.duplicate,
                fields: recorded.record.fields,
                text: readableText,
            });
        }

        const delivery = await sendNotificationByRecordId(
            env,
            recorded.record.record_id
        );

        if (delivery.ok) {
            return true;
        }

        if (delivery.retryable !== false) {
            return await enqueuePcNotification(env, {
                notification_record_id: recorded.record.record_id,
                event_id: input.event_id,
            });
        }

        console.error("PC_EXCEPTION_NOTIFICATION_FAILED", {
            event_id: input.event_id,
            type: input.type,
            notification_record_id: recorded.record.record_id,
            code: delivery.error_code,
            error: delivery.error_message,
        });
        return false;
    } catch (error) {
        console.error("PC_EXCEPTION_NOTIFICATION_FAILED", {
            event_id: input.event_id,
            type: input.type,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
