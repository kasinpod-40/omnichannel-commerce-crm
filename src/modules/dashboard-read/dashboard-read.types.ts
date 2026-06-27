/**
 * ชนิดข้อมูลกลางสำหรับ API ฝั่ง Dashboard
 *
 * ไฟล์นี้ไม่ผูกกับ View ใด View หนึ่ง เพื่อให้ Conversations, Pipelines,
 * Orders และ Marketplaces ใช้รูปแบบ Customer/Channel/Record เดียวกัน
 * และไม่สร้าง logic แปลงค่า Lark ซ้ำในแต่ละ Feature
 */

export type DashboardChannel = "LINE" | "Shopee" | "Lazada" | "TikTok Shop";
export type DashboardLanguage = "th" | "en";

export type DashboardLarkRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

export type DashboardCustomerSnapshot = {
    customer_id: string;
    customer_name: string;
    channel: DashboardChannel;
    phone: string | null;
    current_stage: "New Lead" | "Interested" | "Negotiating" | "Closing" | "Won" | "Lost";
    lead_score: number;
    hot_lead: boolean;
    ai_summary: string | null;
    last_message: string | null;
    message_count: number;
    sales_owner: string | null;
    active_pipeline_id: string | null;
    active_order_id: string | null;
    created_at_ms: number;
    updated_at_ms: number;
};
