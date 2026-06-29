import type {
    LineEventQueueMessage,
    QueueProducerBinding,
} from "../queues/line-event.types";
import type { NotificationQueueMessage } from "../queues/notification-event.types";
import type { MarketplaceEventQueueMessage } from "../queues/marketplace-event.types";

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

    // Dashboard Authentication: ค่าจริงตั้งผ่าน Wrangler/Cloudflare หลัง Deploy Frontend
    DASHBOARD_URL: string;
    LARK_AUTH_REDIRECT_URI: string;
    LARK_ALLOWED_TENANT_KEY?: string;
    AUTH_SESSION_SECRET: string;
    AUTH_ALLOWED_ORIGINS?: string;
    AUTH_SESSION_TTL_SECONDS?: string;
    AUTH_COOKIE_SAME_SITE?: string;

    LARK_APP_TOKEN: string;
    LARK_GROUP_WEBHOOK_URL: string;
    LARK_GROUP_WEBHOOK_KEYWORD?: string;
    NOTIFICATION_DISPATCH_TOKEN: string;
    LARK_WORKFLOW_TOKEN?: string;
    // Webhook Trigger ของ Lark Workflow ที่มี AI-generated text/AI Agent และ synchronous callback
    LARK_AI_WORKFLOW_WEBHOOK_URL?: string;
    LARK_AI_WORKFLOW_TOKEN?: string;
    LARK_AI_WORKFLOW_TIMEOUT_MS?: string;

    CUSTOMERS_TABLE_ID: string;
    CONVERSATIONS_TABLE_ID: string;
    PIPELINE_TABLE_ID: string;
    ORDERS_TABLE_ID: string;
    ACTIVITIES_TABLE_ID: string;
    NOTIFICATIONS_TABLE_ID: string;

    AI?: WorkersAIBinding;
    WORKERS_TEXT_MODEL?: string;


    GEMINI_API_KEY?: string;
    GEMINI_TEXT_MODEL?: string;
    GEMINI_IMAGE_MODEL?: string;

    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    LINE_EVENTS_QUEUE: QueueProducerBinding<LineEventQueueMessage>;
    NOTIFICATION_QUEUE: QueueProducerBinding<NotificationQueueMessage>;
    MARKETPLACE_EVENTS_QUEUE: QueueProducerBinding<MarketplaceEventQueueMessage>;

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


    DOCUMENT_LINK_SECRET?: string;
    DOCUMENT_WORKFLOW_TOKEN?: string;
    DOCUMENT_COMPANY_NAME?: string;
    DOCUMENT_COMPANY_ADDRESS?: string;
    DOCUMENT_COMPANY_TAX_ID?: string;
    DOCUMENT_COMPANY_BRANCH?: string;
    DOCUMENT_COMPANY_PHONE?: string;
    DOCUMENT_COMPANY_EMAIL?: string;
    DOCUMENT_LOGO_URL?: string;
    DOCUMENT_NOTE?: string;
    DOCUMENT_QUOTATION_VALID_DAYS?: string;
    DOCUMENT_VAT_RATE?: string;
    DOCUMENT_PRICE_INCLUDES_VAT?: string;
    DOCUMENT_TAX_FORM_EXPIRES_MINUTES?: string;

    MARKETPLACE_TOKENS?: KVNamespace;
}
