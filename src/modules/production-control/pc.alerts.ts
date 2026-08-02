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
import { sendPcLarkActionCard } from "./pc.lark-card";
import { buildPcNotificationActionCard } from "./pc.workflow-card";

type PcActionCard = Awaited<
    ReturnType<typeof buildPcNotificationActionCard>
>;

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

async function updateSentStatus(
    env: Env,
    input: {
        event_id: string;
        notification_record_id: string;
        attempt_count: number;
    }
): Promise<void> {
    try {
        await updateNotificationDelivery(env, input.notification_record_id, {
            status: "Sent",
            attempt_count: input.attempt_count,
            sent_at: Date.now(),
            error_message: "",
        });
    } catch (auditError) {
        console.error("PC_EXCEPTION_NOTIFICATION_AUDIT_FAILED", {
            event_id: input.event_id,
            notification_record_id: input.notification_record_id,
            error:
                auditError instanceof Error
                    ? auditError.message
                    : String(auditError),
        });
    }
}

async function updateFailedStatus(
    env: Env,
    input: {
        notification_record_id: string;
        attempt_count: number;
        error_message: string;
    }
): Promise<void> {
    try {
        await updateNotificationDelivery(env, input.notification_record_id, {
            status: "Failed",
            attempt_count: input.attempt_count,
            sent_at: null,
            error_message: input.error_message,
        });
    } catch {
        // การบันทึก Error เป็น best effort; การตัดสิน retry ใช้ Error ต้นทาง
    }
}

function deliveryState(input: {
    duplicate: boolean;
    fields: Record<string, unknown>;
}): { already_sent: boolean; next_attempt: number } {
    const currentStatus = getLarkText(
        input.fields[NOTIFICATION_FIELDS.STATUS],
        "Pending"
    ).trim();

    return {
        already_sent:
            input.duplicate &&
            (currentStatus === "Sent" || currentStatus === "Read"),
        next_attempt:
            getLarkNumber(
                input.fields[NOTIFICATION_FIELDS.ATTEMPT_COUNT],
                0
            ) + 1,
    };
}

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
    const state = deliveryState(input);
    if (state.already_sent) return true;

    try {
        await sendLarkGroupText(env, input.text);
        await updateSentStatus(env, {
            event_id: input.event_id,
            notification_record_id: input.notification_record_id,
            attempt_count: state.next_attempt,
        });
        return true;
    } catch (error) {
        const classification = classifyOperationalError(error);
        await updateFailedStatus(env, {
            notification_record_id: input.notification_record_id,
            attempt_count: state.next_attempt,
            error_message: classification.message,
        });

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

async function sendReadablePcCard(
    env: Env,
    input: {
        event_id: string;
        notification_record_id: string;
        duplicate: boolean;
        fields: Record<string, unknown>;
        text_fallback: string;
        card: PcActionCard;
    }
): Promise<boolean> {
    if (!input.card) return false;
    const state = deliveryState(input);
    if (state.already_sent) return true;

    try {
        await sendPcLarkActionCard(env, input.card);
        await updateSentStatus(env, {
            event_id: input.event_id,
            notification_record_id: input.notification_record_id,
            attempt_count: state.next_attempt,
        });
        return true;
    } catch (error) {
        console.error("PC_ACTION_CARD_DELIVERY_FAILED", {
            event_id: input.event_id,
            notification_record_id: input.notification_record_id,
            error: error instanceof Error ? error.message : String(error),
        });

        return await sendReadablePcText(env, {
            event_id: input.event_id,
            notification_record_id: input.notification_record_id,
            duplicate: false,
            fields: input.fields,
            text: input.text_fallback,
        });
    }
}

function readableFallback(input: {
    type: "PC_STOCK_EXCEPTION" | "PC_MATERIAL_SHORTAGE";
    reference_id: string;
    product_name: string;
    detail: string;
    next_action: string;
    lark_text?: string;
}): string {
    const supplied = input.lark_text?.trim();
    if (supplied) return supplied;

    if (input.type === "PC_MATERIAL_SHORTAGE") {
        return [
            "[CRM] 🧵 วัตถุดิบไม่เพียงพอสำหรับแผนผลิต",
            "",
            `สินค้า: ${input.product_name}`,
            `อ้างอิง: ${input.reference_id}`,
            input.detail,
            "",
            `การดำเนินการ: ${input.next_action}`,
        ].join("\n");
    }

    return "";
}

function logCardBuildFailure(input: {
    event_id: string;
    reference_id: string;
    error: unknown;
}): void {
    console.error("PC_ACTION_CARD_BUILD_FAILED", {
        event_id: input.event_id,
        reference_id: input.reference_id,
        error:
            input.error instanceof Error
                ? input.error.message
                : String(input.error),
    });
}

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
    const readableText = readableFallback(input);
    let prebuiltCard: PcActionCard | undefined;

    /*
     * refreshPcMaterialPlan อาจพบวัตถุดิบ Critical ตั้งแต่ตอนสร้างแผนแนะนำ
     * จาก Order แต่ Flow ที่ผู้ใช้อนุมัติไว้ต้องเริ่มจากปุ่มอนุมัติผลิตก่อน
     * จึงไม่ส่ง Alert ระดับ material SKU ที่ยังผูกกับ Production batch ไม่ได้
     * ข้อมูลความเสี่ยงยังถูกบันทึกใน PC_Materials/PC_Production ตามเดิม และ
     * updatePcProductionStatus จะส่ง Alert แบบมีปุ่มสั่งซื้อเมื่ออนุมัติแล้วไม่พอจริง
     */
    if (
        input.type === "PC_MATERIAL_SHORTAGE" &&
        input.event_id.startsWith("pc:material:") &&
        !input.lark_text?.trim()
    ) {
        try {
            prebuiltCard = await buildPcNotificationActionCard(env, {
                notification_type: input.type,
                reference_id: input.reference_id,
                fallback_text: readableText,
            });

            if (!prebuiltCard) {
                console.info("PC_MATERIAL_ALERT_DEFERRED_UNTIL_APPROVAL", {
                    event_id: input.event_id,
                    reference_id: input.reference_id,
                });
                return true;
            }
        } catch (error) {
            logCardBuildFailure({
                event_id: input.event_id,
                reference_id: input.reference_id,
                error,
            });
        }
    }

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
            message: readableText || input.detail,
            payload,
        });

        if (readableText) {
            let card = prebuiltCard;
            if (card === undefined) {
                try {
                    card = await buildPcNotificationActionCard(env, {
                        notification_type: input.type,
                        reference_id: input.reference_id,
                        fallback_text: readableText,
                    });
                } catch (error) {
                    logCardBuildFailure({
                        event_id: input.event_id,
                        reference_id: input.reference_id,
                        error,
                    });
                }
            }

            if (card) {
                return await sendReadablePcCard(env, {
                    event_id: input.event_id,
                    notification_record_id: recorded.record.record_id,
                    duplicate: recorded.duplicate,
                    fields: recorded.record.fields,
                    text_fallback: readableText,
                    card,
                });
            }

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

        if (delivery.ok) return true;

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
