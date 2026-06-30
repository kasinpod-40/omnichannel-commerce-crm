import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";

const mocks = vi.hoisted(() => ({
    findActivityByEventId: vi.fn(),
    listActivities: vi.fn(),
    recordActivityOnce: vi.fn(),
    clearDashboardReadCache: vi.fn(),
    getDashboardOrders: vi.fn(),
    getOrderByRecordId: vi.fn(),
    createSignedDocumentLink: vi.fn(),
    generateAndSaveDocumentLink: vi.fn(),
    buildDocumentViewModelFromRecord: vi.fn(),
}));
vi.mock("../activities/activity.repository", () => ({
    findActivityByEventId: mocks.findActivityByEventId,
    listActivities: mocks.listActivities,
}));
vi.mock("../activities/activity.service", () => ({ recordActivityOnce: mocks.recordActivityOnce }));
vi.mock("../dashboard-read/dashboard-read.cache", () => ({ clearDashboardReadCache: mocks.clearDashboardReadCache }));
vi.mock("../dashboard-read/dashboard-read.records", () => ({ getDashboardOrders: mocks.getDashboardOrders }));
vi.mock("../orders/order.repository", () => ({ getOrderByRecordId: mocks.getOrderByRecordId }));
vi.mock("./document-link.service", () => ({
    createSignedDocumentLink: mocks.createSignedDocumentLink,
    generateAndSaveDocumentLink: mocks.generateAndSaveDocumentLink,
}));
vi.mock("./document.service", () => ({ buildDocumentViewModelFromRecord: mocks.buildDocumentViewModelFromRecord }));

import {
    createDashboardDocument,
    getDashboardDocumentList,
} from "./document-dashboard.service";

const env = {} as Env;
const order = {
    record_id: "rec-order-001",
    fields: {
        [ORDER_FIELDS.CUSTOMER]: ["rec-customer-001"],
        [ORDER_FIELDS.QUOTATION_URL]: "https://api.example.com/documents/order/rec-order-001/quotation?expires=9999999999999",
        [ORDER_FIELDS.CREATED_AT]: Date.parse("2026-06-01T00:00:00.000Z"),
        [ORDER_FIELDS.UPDATED_AT]: Date.parse("2026-06-02T00:00:00.000Z"),
    },
};
const model = {
    type: "quotation" as const,
    title_th: "ใบเสนอราคา",
    title_en: "Quotation",
    document_number: "QT-20260601-0001",
    issue_at: Date.parse("2026-06-01T00:00:00.000Z"),
    company: { name: "Company", address: "Bangkok" },
    customer: { name: "Customer A", address: "Bangkok" },
    order: {
        record_id: "rec-order-001", order_number: "ORD-001", channel: "LINE",
        order_status: "Waiting Payment", payment_status: "Pending", currency: "THB",
    },
    items: [{ name: "Product", quantity: 1, unit_price: 1000, line_total: 1000 }],
    subtotal: 1000,
    adjustment: 0,
    grand_total: 1000,
};

describe("document-dashboard.service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getDashboardOrders.mockResolvedValue([order]);
        mocks.listActivities.mockResolvedValue([]);
        mocks.getOrderByRecordId.mockResolvedValue(order);
        mocks.buildDocumentViewModelFromRecord.mockReturnValue(model);
        mocks.createSignedDocumentLink.mockResolvedValue({ url: "https://api.example.com/preview", expires_at: Date.now() + 60_000 });
        mocks.generateAndSaveDocumentLink.mockResolvedValue({ url: "https://api.example.com/saved", expires_at: Date.now() + 60_000 });
        mocks.findActivityByEventId.mockResolvedValue(null);
        mocks.recordActivityOnce.mockResolvedValue(undefined);
    });

    it("สร้าง list จาก URL field เดิมและกรองตาม Order", async () => {
        const result = await getDashboardDocumentList(env, {
            search: "QT-2026", type: "quotation", status: "ready",
            date_from_ms: null, date_to_ms: null, order_id: "rec-order-001", page: 1, page_size: 10,
        });
        expect(result.total).toBe(1);
        expect(result.items[0]).toMatchObject({
            document_number: "QT-20260601-0001",
            order_id: "rec-order-001",
            amount: 1000,
        });
    });

    it("ใช้ activity event เดิมเป็น idempotency guard และไม่สร้าง URL ซ้ำ", async () => {
        mocks.findActivityByEventId.mockResolvedValue({ record_id: "activity-existing", fields: {} });
        const result = await createDashboardDocument({
            env,
            requestUrl: "https://api.example.com/dashboard/documents",
            orderId: "rec-order-001",
            type: "quotation",
            idempotencyKey: "document-key-001",
            actor: { userId: "user-admin", name: "Admin", role: "admin" },
        });
        expect(result.idempotent).toBe(true);
        expect(mocks.generateAndSaveDocumentLink).not.toHaveBeenCalled();
        expect(mocks.recordActivityOnce).not.toHaveBeenCalled();
    });

    it("บันทึกลิงก์ Activity linkage และล้าง cache หลังสร้างเอกสาร", async () => {
        const result = await createDashboardDocument({
            env,
            requestUrl: "https://api.example.com/dashboard/documents",
            orderId: "rec-order-001",
            type: "quotation",
            idempotencyKey: "document-key-002",
            actor: { userId: "user-admin", name: "Admin", role: "admin" },
        });
        expect(result.idempotent).toBe(false);
        expect(mocks.generateAndSaveDocumentLink).toHaveBeenCalledWith(expect.objectContaining({
            orderRecordId: "rec-order-001", documentType: "quotation",
        }));
        expect(mocks.recordActivityOnce).toHaveBeenCalledWith(env, expect.objectContaining({
            event_id: "document-create:document-key-002",
            customer_record_id: "rec-customer-001",
            action: "DOCUMENT_CREATED",
            new_value: expect.objectContaining({ order_record_id: "rec-order-001", document_type: "quotation" }),
        }));
        expect(mocks.clearDashboardReadCache).toHaveBeenCalled();
    });
});
