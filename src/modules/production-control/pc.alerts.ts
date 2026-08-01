import type { Env } from "../../config/env";
import { recordAndDispatchNotificationOnce } from "../notifications/notification.service";
import type {
    NotificationSnapshot,
    NotificationType,
} from "../notifications/notification.types";

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
): Promise<void> {
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
        await recordAndDispatchNotificationOnce(env, {
            event_id: input.event_id,
            notification_type: input.type,
            message: input.detail,
            payload,
        });
    } catch (error) {
        console.error("PC_EXCEPTION_NOTIFICATION_FAILED", {
            event_id: input.event_id,
            type: input.type,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
