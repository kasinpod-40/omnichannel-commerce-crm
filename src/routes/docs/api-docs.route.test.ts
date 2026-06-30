import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import {
    handleOpenApiJson,
    handleSwaggerDocs,
} from "./docs.route";
import {
    API_ROUTE_DEFINITIONS,
    buildOpenApiDocument,
} from "./openapi";

function env(): Env {
    return {
        ENVIRONMENT: "test",
        DASHBOARD_URL: "https://dashboard.example.com",
        LARK_AUTH_REDIRECT_URI:
            "https://api.example.com/auth/lark/callback",
        AUTH_SESSION_SECRET:
            "test-session-secret-that-is-longer-than-32-characters",
        LARK_APP_ID: "cli_test",
        LARK_APP_SECRET: "secret",
        LARK_APP_TOKEN: "app_token",
        LARK_GROUP_WEBHOOK_URL: "https://example.com/webhook",
        LARK_GROUP_WEBHOOK_KEYWORD: "OmniCommerce",
        NOTIFICATION_DISPATCH_TOKEN: "admin-token",
        CUSTOMERS_TABLE_ID: "tbl_customers",
        CONVERSATIONS_TABLE_ID: "tbl_conversations",
        PIPELINE_TABLE_ID: "tbl_pipeline",
        ORDERS_TABLE_ID: "tbl_orders",
        ACTIVITIES_TABLE_ID: "tbl_activities",
        NOTIFICATIONS_TABLE_ID: "tbl_notifications",
        LINE_CHANNEL_SECRET: "line-secret",
        LINE_CHANNEL_ACCESS_TOKEN: "line-token",
        LINE_EVENTS_QUEUE: { send: async () => undefined },
        NOTIFICATION_QUEUE: { send: async () => undefined },
        MARKETPLACE_EVENTS_QUEUE: { send: async () => undefined },
    } as Env;
}

describe("API documentation", () => {
    it("documents every registered route definition", () => {
        const document = buildOpenApiDocument(
            new Request("https://api.example.com/openapi.json")
        ) as {
            paths: Record<string, Record<string, unknown>>;
            servers: Array<{ url: string }>;
        };

        expect(document.servers[0]?.url).toBe(
            "https://api.example.com"
        );
        expect(document.paths["/health"]?.get).toBeTruthy();
        expect(document.paths["/auth/me"]?.get).toBeTruthy();
        expect(document.paths["/dashboard/summary"]?.get).toBeTruthy();
        expect(document.paths["/customers"]?.get).toBeTruthy();
        expect(document.paths["/customers/{customerId}"]?.get).toBeTruthy();
        expect(document.paths["/conversations"]?.get).toBeTruthy();
        expect(document.paths["/conversations/{conversationId}"]?.get).toBeTruthy();
        expect(document.paths["/conversations/{conversationId}/messages"]?.get).toBeTruthy();
        expect(document.paths["/conversations/images/{messageRecordId}"]?.get).toBeTruthy();
        expect(document.paths["/pipelines"]?.get).toBeTruthy();
        expect(document.paths["/pipelines/{pipelineId}"]?.get).toBeTruthy();
        expect(document.paths["/orders"]?.get).toBeTruthy();
        expect(document.paths["/orders/{orderId}"]?.get).toBeTruthy();
        expect(document.paths["/orders/{orderId}/amount"]?.post).toBeTruthy();
        expect(document.paths["/dashboard/documents"]?.get).toBeTruthy();
        expect(document.paths["/dashboard/documents"]?.post).toBeTruthy();
        expect(document.paths["/dashboard/documents/preview"]?.post).toBeTruthy();
        expect(document.paths["/dashboard/documents/order/{orderId}/{documentType}"]?.get).toBeTruthy();
        expect(document.paths["/notifications"]?.get).toBeTruthy();
        expect(document.paths["/notifications/unread-count"]?.get).toBeTruthy();
        expect(document.paths["/notifications/read-all"]?.post).toBeTruthy();
        expect(document.paths["/notifications/{notificationId}/read"]?.post).toBeTruthy();
        expect(document.paths["/payment-reviews/{orderId}"]?.get).toBeTruthy();
        expect(document.paths["/payment-reviews/{orderId}/image"]?.get).toBeTruthy();
        expect(document.paths["/payment-reviews/{orderId}/approve"]?.post).toBeTruthy();
        expect(document.paths["/payment-reviews/{orderId}/reject"]?.post).toBeTruthy();
        expect(document.paths["/marketplaces/status"]?.get).toBeTruthy();
        expect(document.paths["/marketplaces/sync-history"]?.get).toBeTruthy();
        expect(document.paths["/marketplaces/{marketplaceId}"]?.get).toBeTruthy();
        expect(document.paths["/webhooks/line"]?.post).toBeTruthy();
        expect(
            document.paths["/admin/marketplace/orders/upsert"]?.post
        ).toBeTruthy();
        expect(
            document.paths[
                "/documents/order/{orderRecordId}/{documentType}"
            ]?.get
        ).toBeTruthy();
        expect(document.paths["/queue/failure-test"]?.post).toBeTruthy();

        for (const route of API_ROUTE_DEFINITIONS) {
            expect(document.paths[route.path]?.[route.method]).toBeTruthy();
        }
    });

    it("rejects Swagger UI without session or admin token", async () => {
        const response = await handleSwaggerDocs(
            new Request("https://api.example.com/docs", {
                headers: { Accept: "text/html" },
            }),
            env()
        );

        expect(response.status).toBe(401);
        expect(await response.text()).toContain(
            "ต้องเข้าสู่ระบบก่อนเปิด API Docs"
        );
    });

    it("serves Swagger UI and OpenAPI JSON with admin token", async () => {
        const headers = {
            Authorization: "Bearer admin-token",
        };
        const swagger = await handleSwaggerDocs(
            new Request("https://api.example.com/docs", { headers }),
            env()
        );
        const openapi = await handleOpenApiJson(
            new Request("https://api.example.com/openapi.json", {
                headers,
            }),
            env()
        );

        expect(swagger.status).toBe(200);
        expect(await swagger.text()).toContain("SwaggerUIBundle");
        expect(openapi.status).toBe(200);
        expect(openapi.headers.get("Content-Type")).toContain(
            "application/json"
        );
    });
});
