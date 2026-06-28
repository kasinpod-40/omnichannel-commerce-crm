export type HotLeadNotificationInput = {
    current_hot_lead: boolean;
    previous_hot_lead: boolean;
    starting_new_sales_cycle: boolean;
};

/**
 * HOT_LEAD แจ้งเฉพาะผลของข้อความปัจจุบันที่เปลี่ยนสถานะในรอบขายนี้
 * ค่า hot_lead ที่ค้างจาก Customer aggregate เพียงอย่างเดียวห้ามสร้าง Noti
 */
export function shouldSendHotLeadNotification(
    input: HotLeadNotificationInput
): boolean {
    if (!input.current_hot_lead) {
        return false;
    }

    if (input.starting_new_sales_cycle) {
        return true;
    }

    return !input.previous_hot_lead;
}
