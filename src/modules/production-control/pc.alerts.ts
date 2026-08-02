import type { Env } from "../../config/env";
import { recordAndDispatchNotificationOnce } from "../notifications/notification.service";
import type {
    NotificationSnapshot,
    NotificationType,
} from "../notifications/notification.types";

/**
 * บันทึกและส่ง Notification ของ Production & Stock แบบ best effort.
 * คืน false เมื่อสร้าง Record หรือส่งเข้า Queue ไม่สำเร็จ เพื่อให้ caller
 * ตัดสินใจ retry ได้ โดยไม่กลืนความล้มเหลวเป็นผลสำเร็จเงียบ ๆ.
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
        const result = await recordAndDispatchNotificationOnce(env, {
            event_id: input.event_id,
            notification_type: input.type,
            message: input.detail,
            payload,
        });

        if (result.dispatch_error) {
            console.error("PC_EXCEPTION_NOTIFICATION_FAILED", {
                event_id: input.event_id,
                type: input.type,
                notification_record_id: result.record.record_id,
                error: result.dispatch_error,
            });
            return false;
        }

        return true;
    } catch (error) {
        console.error("PC_EXCEPTION_NOTIFICATION_FAILED", {
            event_id: input.event_id,
            type: input.type,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
