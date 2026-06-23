import type {
    LineEventQueueMessage,
    QueueProducerBinding,
} from "../queues/line-event.types";
import type { NotificationQueueMessage } from "../queues/notification-event.types";

export interface WorkersAIBinding {
    run(
        model: string,
        inputs: unknown
    ): Promise<unknown>;
}

export interface Env {
    ENVIRONMENT: string;

    LARK_APP_ID: string;
    LARK_APP_SECRET: string;

    LARK_APP_TOKEN: string;
    LARK_GROUP_WEBHOOK_URL: string;
    NOTIFICATION_DISPATCH_TOKEN: string;
    LARK_WORKFLOW_TOKEN?: string;

    CUSTOMERS_TABLE_ID: string;
    CONVERSATIONS_TABLE_ID: string;
    PIPELINE_TABLE_ID: string;
    ORDERS_TABLE_ID: string;
    ACTIVITIES_TABLE_ID: string;
    NOTIFICATIONS_TABLE_ID: string;

    AI?: WorkersAIBinding;
    WORKERS_TEXT_MODEL?: string;

    // Kept only for backward compatibility with the unused legacy image provider.
    WORKERS_IMAGE_MODEL?: string;

    GEMINI_API_KEY?: string;
    GEMINI_TEXT_MODEL?: string;
    GEMINI_IMAGE_MODEL?: string;

    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    LINE_EVENTS_QUEUE: QueueProducerBinding<LineEventQueueMessage>;
    NOTIFICATION_QUEUE: QueueProducerBinding<NotificationQueueMessage>;

    ENABLE_TEST_ROUTES?: string;
    PAYMENT_DUE_HOURS?: string;

    TIKTOK_APP_KEY?: string;
    TIKTOK_APP_SECRET?: string;
    TIKTOK_API_BASE?: string;
    TIKTOK_AUTH_BASE?: string;
    TIKTOK_REDIRECT_URI?: string;

    LAZADA_APP_KEY?: string;
    LAZADA_APP_SECRET?: string;
    LAZADA_API_BASE?: string;
    LAZADA_AUTH_BASE?: string;
    LAZADA_REDIRECT_URI?: string;
    LAZADA_POLL_ENABLED?: string;
    LAZADA_POLL_INITIAL_LOOKBACK_MINUTES?: string;
    LAZADA_POLL_OVERLAP_MINUTES?: string;
    LAZADA_POLL_PAGE_SIZE?: string;
    LAZADA_POLL_MAX_PAGES?: string;

    MARKETPLACE_TOKENS?: KVNamespace;
}
