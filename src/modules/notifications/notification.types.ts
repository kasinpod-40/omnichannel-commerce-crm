export type NotificationType =
    | "NEW_LEAD"
    | "HOT_LEAD"
    | "PAYMENT_REVIEW"
    | "PAYMENT_VERIFIED"
    | "SALE_WON"
    | "SALE_LOST";

export type NotificationStatus =
    | "Pending"
    | "Sent"
    | "Read"
    | "Failed";

export type Notification = {
    event_id: string;
    notification_type: NotificationType;
    customer_record_id: string;
    message: string;
    status?: NotificationStatus;
    created_at?: number;
};
