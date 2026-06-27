import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config/env";
import { createAuthSession } from "../modules/auth/auth.session";

const {
    getConversationList,
    getConversationDetail,
    getConversationMessages,
    getConversationImage,
    getPipelineList,
    getPipelineDetail,
    getOrderList,
    getOrderDetail,
    getMarketplaceStatus,
    getMarketplaceSyncHistory,
    getMarketplaceDetail,
} = vi.hoisted(() => ({
    getConversationList: vi.fn(),
    getConversationDetail: vi.fn(),
    getConversationMessages: vi.fn(),
    getConversationImage: vi.fn(),
    getPipelineList: vi.fn(),
    getPipelineDetail: vi.fn(),
    getOrderList: vi.fn(),
    getOrderDetail: vi.fn(),
    getMarketplaceStatus: vi.fn(),
    getMarketplaceSyncHistory: vi.fn(),
    getMarketplaceDetail: vi.fn(),
}));

vi.mock("../modules/conversations/conversation-dashboard.service", () => ({
    getConversationList,
    getConversationDetail,
    getConversationMessages,
}));
vi.mock("../modules/conversations/conversation-image.service", () => ({
    getConversationImage,
}));
vi.mock("../modules/pipeline/pipeline-dashboard.service", () => ({
    getPipelineList,
    getPipelineDetail,
}));
vi.mock("../modules/orders/order-dashboard.service", () => ({
    getOrderList,
    getOrderDetail,
}));
vi.mock("../modules/marketplace/marketplace-dashboard-status.service", () => ({
    getMarketplaceStatus,
    getMarketplaceSyncHistory,
    getMarketplaceDetail,
}));

import {
    handleConversationDetail,
    handleConversationList,
    handleConversationMessages,
    handleConversationImage,
} from "./conversations/conversations.route";
import {
    handlePipelineDetail,
    handlePipelineList,
} from "./pipelines/pipelines.route";
import {
    handleOrderDetail,
    handleOrderList,
} from "./orders/orders.route";
import {
    handleMarketplaceDetail,
    handleMarketplaceStatus,
    handleMarketplaceSyncHistory,
} from "./marketplace/status.route";
import { handleConversationRoutes } from "./conversations";
import { handlePipelineRoutes } from "./pipelines";
import { handleOrderRoutes } from "./orders";

const env = {
    DASHBOARD_URL: "https://crm.example.com",
    AUTH_ALLOWED_ORIGINS: "https://crm.example.com",
    AUTH_SESSION_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
    AUTH_SESSION_TTL_SECONDS: "3600",
    AUTH_COOKIE_SAME_SITE: "None",
} as Env;
const user = {
    user_id: "ou_user_001",
    lark_open_id: "ou_user_001",
    name: "Kasinpod",
    email: null,
    avatar_url: null,
    role: "admin" as const,
    sales_owner_name: null,
};

async function authHeaders(): Promise<HeadersInit> {
    const session = await createAuthSession(env, user);
    return {
        Origin: "https://crm.example.com",
        Cookie: `crm_session=${encodeURIComponent(session.token)}`,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    getConversationList.mockResolvedValue({ items: [], summary: {}, total: 0, page: 1, page_size: 10, total_pages: 1, updated_at: new Date().toISOString() });
    getConversationDetail.mockResolvedValue(null);
    getConversationMessages.mockResolvedValue({ items: [], next_cursor: null, has_more: false });
    getConversationImage.mockResolvedValue(null);
    getPipelineList.mockResolvedValue({ items: [], summary: {}, total: 0, updated_at: new Date().toISOString() });
    getPipelineDetail.mockResolvedValue(null);
    getOrderList.mockResolvedValue({ items: [], summary: {}, total: 0, page: 1, page_size: 10, total_pages: 1, updated_at: new Date().toISOString() });
    getOrderDetail.mockResolvedValue(null);
    getMarketplaceStatus.mockResolvedValue({ connections: [], updated_at: new Date().toISOString() });
    getMarketplaceSyncHistory.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 10, total: 0, total_pages: 1 }, updated_at: new Date().toISOString() });
    getMarketplaceDetail.mockResolvedValue(null);
});

describe("dashboard read routes", () => {

    it("does not claim routes with a similar prefix", async () => {
        const request = new Request("https://api.example.com/conversations-export");
        await expect(handleConversationRoutes(request, env, "/conversations-export")).resolves.toBeNull();
        await expect(handlePipelineRoutes(request, env, "/pipelines-report")).resolves.toBeNull();
        await expect(handleOrderRoutes(request, env, "/orders-export")).resolves.toBeNull();
    });
    it("rejects anonymous requests", async () => {
        const response = await handleConversationList(
            new Request("https://api.example.com/conversations", {
                headers: { Origin: "https://crm.example.com" },
            }),
            env
        );
        expect(response.status).toBe(401);
    });


    it("normalizes conversation filters", async () => {
        const response = await handleConversationList(
            new Request("https://api.example.com/conversations?search=min&intent=Ready%20To%20Buy&process_status=failed", {
                headers: await authHeaders(),
            }),
            env
        );
        expect(response.status).toBe(200);
        expect(getConversationList).toHaveBeenCalledWith(env, {
            search: "min",
            intent: "Ready To Buy",
            process_status: "failed",
            page: 1,
            page_size: 10,
        });
    });



    it("protects the conversation image proxy and returns image bytes for an authenticated session", async () => {
        const anonymous = await handleConversationImage(
            new Request("https://api.example.com/conversations/images/rec_image_1", {
                headers: { Origin: "https://crm.example.com" },
            }),
            env,
            "rec_image_1"
        );
        expect(anonymous.status).toBe(401);
        expect(getConversationImage).not.toHaveBeenCalled();

        getConversationImage.mockResolvedValue({
            bytes: new Uint8Array([137, 80, 78, 71]).buffer,
            mime_type: "image/png",
        });
        const authenticated = await handleConversationImage(
            new Request("https://api.example.com/conversations/images/rec_image_1", {
                headers: await authHeaders(),
            }),
            env,
            "rec_image_1"
        );

        expect(authenticated.status).toBe(200);
        expect(authenticated.headers.get("Content-Type")).toBe("image/png");
        expect(authenticated.headers.get("Cache-Control")).toContain("private");
        expect(getConversationImage).toHaveBeenCalledWith(env, "rec_image_1");
    });

    it("normalizes the conversation message cursor request", async () => {
        const response = await handleConversationMessages(
            new Request("https://api.example.com/conversations/rec_customer_1/messages?limit=50&before=cursor-1", {
                headers: await authHeaders(),
            }),
            env,
            "rec_customer_1"
        );
        expect(response.status).toBe(200);
        expect(getConversationMessages).toHaveBeenCalledWith(env, "rec_customer_1", {
            limit: 50,
            before: "cursor-1",
        });
    });

    it("returns 404 for missing detail records", async () => {
        const headers = await authHeaders();
        const [conversation, pipeline, order] = await Promise.all([
            handleConversationDetail(
                new Request("https://api.example.com/conversations/rec_customer_missing", { headers }),
                env,
                "rec_customer_missing"
            ),
            handlePipelineDetail(
                new Request("https://api.example.com/pipelines/rec_pipeline_missing", { headers }),
                env,
                "rec_pipeline_missing"
            ),
            handleOrderDetail(
                new Request("https://api.example.com/orders/rec_order_missing", { headers }),
                env,
                "rec_order_missing"
            ),
        ]);

        expect(conversation.status).toBe(404);
        expect(pipeline.status).toBe(404);
        expect(order.status).toBe(404);
    });
    it("normalizes pipeline filters", async () => {
        const response = await handlePipelineList(
            new Request("https://api.example.com/pipelines?search=min&status=won", {
                headers: await authHeaders(),
            }),
            env
        );
        expect(response.status).toBe(200);
        expect(getPipelineList).toHaveBeenCalledWith(env, { search: "min", status: "won" });
    });

    it("normalizes order pagination and filters", async () => {
        const response = await handleOrderList(
            new Request("https://api.example.com/orders?channel=TikTok%20Shop&order_status=Completed&payment_status=Paid&sort=amount_desc&page=2&page_size=20", {
                headers: await authHeaders(),
            }),
            env
        );
        expect(response.status).toBe(200);
        expect(getOrderList).toHaveBeenCalledWith(env, expect.objectContaining({
            channel: "TikTok Shop",
            order_status: "Completed",
            payment_status: "Paid",
            sort: "amount_desc",
            page: 2,
            page_size: 20,
        }));
    });

    it("returns marketplace status for authenticated users", async () => {
        const response = await handleMarketplaceStatus(
            new Request("https://api.example.com/marketplaces/status", {
                headers: await authHeaders(),
            }),
            env
        );
        expect(response.status).toBe(200);
        expect(getMarketplaceStatus).toHaveBeenCalledWith(env, "th");
    });


    it("normalizes marketplace history pagination", async () => {
        const response = await handleMarketplaceSyncHistory(
            new Request("https://api.example.com/marketplaces/sync-history?page=3&page_size=20", {
                headers: await authHeaders(),
            }),
            env
        );
        expect(response.status).toBe(200);
        expect(getMarketplaceSyncHistory).toHaveBeenCalledWith(env, "th", { page: 3, page_size: 20 });
    });

    it("forwards English language to marketplace mapper", async () => {
        const response = await handleMarketplaceStatus(
            new Request("https://api.example.com/marketplaces/status?lang=en", {
                headers: await authHeaders(),
            }),
            env
        );
        expect(response.status).toBe(200);
        expect(getMarketplaceStatus).toHaveBeenCalledWith(env, "en");
    });

    it("loads marketplace drawer detail independently from history page", async () => {
        getMarketplaceDetail.mockResolvedValue({ connection: { platform: "Lazada" }, recent_events: [], updated_at: new Date().toISOString() });
        const response = await handleMarketplaceDetail(
            new Request("https://api.example.com/marketplaces/lazada?lang=en", {
                headers: await authHeaders(),
            }),
            env,
            "lazada"
        );
        expect(response.status).toBe(200);
        expect(getMarketplaceDetail).toHaveBeenCalledWith(env, "lazada", "en");
    });
});
