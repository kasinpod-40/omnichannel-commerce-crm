export type NotificationType =
    | "NEW_LEAD"
    | "HOT_LEAD"
    | "PAYMENT_REVIEW"
    | "PAYMENT_VERIFIED"
    | "SALE_WON"
    | "SALE_LOST"
    | "PAYMENT_OVERDUE";

export type NotificationStatus =
    | "Pending"
    | "Sent"
    | "Read"
    | "Failed";

export type NotificationSnapshot = {
    version: 1;
    captured_at: number;
    customer_name: string;
    channel: string;
    phone: string;
    current_stage: string;
    lead_score: number;
    last_message: string;
    sales_owner: string;
    order_number: string;
    product_name: string;
    product_size?: string;
    quantity: number;
    total_amount: number;
    slip_amount: number;
    payment_status?: string;
    order_status?: string;
    marketplace_event_kind?: "created" | "completed" | "cancelled";
    dashboard_read_at?: number;
    review_resolved_at?: number;
};

export type Notification = {
    event_id: string;
    notification_type: NotificationType;
    customer_record_id: string;
    message: string;
    payload?: NotificationSnapshot;
    status?: NotificationStatus;
    created_at?: number;
};

export type NotificationDeliveryUpdate = {
    status: "Sent" | "Failed";
    attempt_count: number;
    sent_at?: number | null;
    error_message?: string;
};
