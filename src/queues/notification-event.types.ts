export interface NotificationQueueMessage {
    schema_version: 1;
    notification_record_id: string;
    event_id: string;
    created_at: number;
}
