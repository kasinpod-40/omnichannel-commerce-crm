export const CUSTOMER_FIELDS = {
    CHANNEL: "channel",
    CHANNEL_CUSTOMER_ID: "channel_customer_id",
    CUSTOMER_NAME: "customer_name",
    PHONE: "phone",
    CURRENT_STAGE: "current_stage",
    LEAD_SCORE: "lead_score",
    HOT_LEAD: "hot_lead",
    AI_SUMMARY: "ai_summary",
    LAST_MESSAGE: "last_message",
    MESSAGE_COUNT: "message_count",
    ACTIVE_PIPELINE: "active_pipeline",
    ACTIVE_ORDER: "active_order",
    SALES_OWNER: "sales_owner",
    CREATED_AT: "created_at",
    UPDATED_AT: "updated_at",
} as const;

export const CONVERSATION_FIELDS = {
    CUSTOMER: "customer",
    CHANNEL: "channel",
    EXTERNAL_MESSAGE_ID: "external_message_id",
    MESSAGE_TYPE: "message_type",
    MESSAGE: "message",
    IMAGE_URL: "image_url",
    INTENT: "intent",
    LEAD_SCORE: "lead_score",
    HOT_LEAD: "hot_lead",
    AI_SUMMARY: "ai_summary",
    PROCESS_STATUS: "process_status",
    ERROR_MESSAGE: "error_message",
    CREATED_AT: "created_at",
} as const;

export const PIPELINE_FIELDS = {
    CUSTOMER: "customer",
    STAGE: "stage",
    STATUS: "status",
    LEAD_SCORE: "lead_score",
    AI_SUMMARY: "ai_summary",
    SALES_OWNER: "sales_owner",
    CREATED_AT: "created_at",
    CLOSED_AT: "closed_at",
    ORDER: "order",
} as const;

export const ORDER_FIELDS = {
    ORDER_NUMBER: "order_number",
    CUSTOMER: "customer",
    PIPELINE: "pipeline",
    CHANNEL: "channel",
    EXTERNAL_ORDER_ID: "external_order_id",
    CUSTOMER_NAME: "customer_name",
    PHONE: "phone",
    ADDRESS: "address",
    PRODUCT_NAME: "product_name",
    QUANTITY: "quantity",
    TOTAL_AMOUNT: "total_amount",
    PAYMENT_STATUS: "payment_status",
    PAYMENT_VERIFIED: "payment_verified",
    ORDER_STATUS: "order_status",
    SALES_OWNER: "sales_owner",
    CREATED_AT: "created_at",
} as const;

export const ACTIVITY_FIELDS = {
    EVENT_ID: "event_id",
    CUSTOMER: "customer",
    ACTION: "action",
    OLD_VALUE: "old_value",
    NEW_VALUE: "new_value",
    CREATED_AT: "created_at",
} as const;

export const NOTIFICATION_FIELDS = {
    NOTIFICATION_TYPE: "notification_type",
    CUSTOMER: "customer",
    MESSAGE: "message",
    STATUS: "status",
    CREATED_AT: "created_at",
} as const;