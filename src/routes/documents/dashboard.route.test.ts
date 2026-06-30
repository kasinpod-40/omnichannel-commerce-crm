import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { AuthError } from "../../modules/auth/auth.error";
import { createAuthSession } from "../../modules/auth/auth.session";

const { getDashboardDocumentByNumber, getDashboardDocumentList, previewDashboardDocument, createDashboardDocument } = vi.hoisted(() => ({
    getDashboardDocumentByNumber: vi.fn(),
    getDashboardDocumentList: vi.fn(),
    previewDashboardDocument: vi.fn(),
    createDashboardDocument: vi.fn(),
}));
vi.mock("../../modules/documents/document-dashboard.service", () => ({
    getDashboardDocumentByNumber,
    getDashboardDocumentList,
    previewDashboardDocument,
    createDashboardDocument,
}));

import { handleDashboardDocumentRoutes } from "./dashboard.route";

const env = {
    DASHBOARD_URL: "https://crm.example.com",
    AUTH_ALLOWED_ORIGINS: "https://crm.example.com",
    AUTH_SESSION_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
    AUTH_SESSION_TTL_SECONDS: "3600",
    AUTH_COOKIE_SAME_SITE: "None",
} as Env;
const user = (role: "admin" | "manager" | "sales") => ({
    user_id: `user-${role}`,
    lark_open_id: `open-${role}`,
    name: role,
    email: null,
    avatar_url: null,
    role,
    sales_owner_name: null,
});
async function requestFor(role: "admin" | "manager" | "sales", method: string, path: string, body?: object) {
    const session = await createAuthSession(env, user(role));
    return new Request(`https://api.example.com${path}`, {
        method,
        headers: {
            Origin: "https://crm.example.com",
            Cookie: `crm_session=${encodeURIComponent(session.token)}`,
            ...(body ? { "Content-Type": "application/json", "Idempotency-Key": "document-key-001" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

const detail = { document_id: "rec-order-001:quotation", document_number: "QT-001", document_type: "quotation" };

describe("Dashboard Documents routes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getDashboardDocumentList.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 10, total_pages: 1, updated_at: "2026-06-30T00:00:00.000Z" });
        getDashboardDocumentByNumber.mockResolvedValue(detail);
        previewDashboardDocument.mockResolvedValue(detail);
        createDashboardDocument.mockResolvedValue({ document: detail, idempotent: false });
    });

    it("ส่ง filter list รวม date และ order ไป service", async () => {
        const response = await handleDashboardDocumentRoutes(
            await requestFor("admin", "GET", "/dashboard/documents?type=invoice&status=ready&date_from=2026-06-01&date_to=2026-06-30&order_id=rec-1&page=2&page_size=20"),
            env,
            "/dashboard/documents",
        );
        expect(response?.status).toBe(200);
        expect(getDashboardDocumentList).toHaveBeenCalledWith(env, expect.objectContaining({
            type: "invoice", status: "ready", order_id: "rec-1", page: 2, page_size: 20,
            date_from_ms: expect.any(Number), date_to_ms: expect.any(Number),
        }));
    });


    it("เปิดรายละเอียดด้วย Document Number และไม่ต้องใส่ Order record ID ใน URL", async () => {
        const response = await handleDashboardDocumentRoutes(
            await requestFor("admin", "GET", "/dashboard/documents/number/QT-20260601-0001"),
            env,
            "/dashboard/documents/number/QT-20260601-0001",
        );
        expect(response?.status).toBe(200);
        expect(getDashboardDocumentByNumber).toHaveBeenCalledWith(
            env,
            "https://api.example.com/dashboard/documents/number/QT-20260601-0001",
            "QT-20260601-0001",
        );
    });

    it("คืน 404 เมื่อไม่พบ Document Number", async () => {
        getDashboardDocumentByNumber.mockResolvedValueOnce(null);
        const response = await handleDashboardDocumentRoutes(
            await requestFor("admin", "GET", "/dashboard/documents/number/INV-NOT-FOUND"),
            env,
            "/dashboard/documents/number/INV-NOT-FOUND",
        );
        expect(response?.status).toBe(404);
        await expect(response?.json()).resolves.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    });

    it("ปฏิเสธ Sales role ที่สร้างเอกสาร", async () => {
        const response = await handleDashboardDocumentRoutes(
            await requestFor("sales", "POST", "/dashboard/documents", { order_id: "rec-1", document_type: "quotation" }),
            env,
            "/dashboard/documents",
        );
        expect(response?.status).toBe(403);
        expect(createDashboardDocument).not.toHaveBeenCalled();
    });

    it("ส่ง actor และ idempotency key ไป create service", async () => {
        const response = await handleDashboardDocumentRoutes(
            await requestFor("admin", "POST", "/dashboard/documents", { order_id: "rec-1", document_type: "tax-invoice" }),
            env,
            "/dashboard/documents",
        );
        expect(response?.status).toBe(201);
        expect(createDashboardDocument).toHaveBeenCalledWith(expect.objectContaining({
            orderId: "rec-1", type: "tax-invoice", idempotencyKey: "document-key-001",
            actor: { userId: "user-admin", name: "admin", role: "admin" },
        }));
    });

    it("เปิดเผยเฉพาะรายชื่อ field ภาษีที่ขาดให้ UI", async () => {
        previewDashboardDocument.mockRejectedValueOnce(new AuthError(
            "TAX_DATA_INCOMPLETE",
            "Tax information is incomplete",
            422,
            { missing: ["tax_id", "tax_address"] },
        ));
        const response = await handleDashboardDocumentRoutes(
            await requestFor("admin", "POST", "/dashboard/documents/preview", { order_id: "rec-1", document_type: "tax-invoice" }),
            env,
            "/dashboard/documents/preview",
        );
        expect(response?.status).toBe(422);
        await expect(response?.json()).resolves.toMatchObject({
            code: "TAX_DATA_INCOMPLETE",
            details: { missing: ["tax_id", "tax_address"] },
        });
    });
});
