import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { NOTIFICATION_FIELDS } from "../../core/lark-fields";

const mocks = vi.hoisted(() => ({
    recordNotificationOnce: vi.fn(),
    sendNotificationByRecordId: vi.fn(),
    sendLarkGroupText: vi.fn(),
    sendPcLarkActionCard: vi.fn(),
    buildPcNotificationActionCard: vi.fn(),
    updateNotificationDelivery: vi.fn(),
    enqueueNotificationDelivery: vi.fn(),
    classifyOperationalError: vi.fn(),
}));

vi.mock("../notifications/notification.service", () => ({
    recordNotificationOnce: mocks.recordNotificationOnce,
    sendNotificationByRecordId: mocks.sendNotificationByRecordId,
}));

vi.mock("../notifications/notification.repository", () => ({
    updateNotificationDelivery: mocks.updateNotificationDelivery,
}));

vi.mock("../../providers/lark/lark-group-webhook.provider", () => ({
    sendLarkGroupText: mocks.sendLarkGroupText,
}));

vi.mock("./pc.lark-card", () => ({
    sendPcLarkActionCard: mocks.sendPcLarkActionCard,
}));

vi.mock("./pc.workflow-card", () => ({
    buildPcNotificationActionCard: mocks.buildPcNotificationActionCard,
}));

vi.mock("../../queues/notification.producer", () => ({
    enqueueNotificationDelivery: mocks.enqueueNotificationDelivery,
}));

vi.mock("../../utils/errors", () => ({
    classifyOperationalError: mocks.classifyOperationalError,
}));

import { notifyPcExceptionOnce } from "./pc.alerts";

const alertInput = {
    event_id: "pc:low-stock:order-1:fp-1:SKU-1",
    type: "PC_STOCK_EXCEPTION" as const,
    reference_id: "SKU-1",
    product_name: "Demo Product",
    detail: [
        "สี / ไซซ์: Ivory / L",
        "SKU: SKU-1",
        "คงเหลือ: 5 ชิ้น",
        "ขั้นต่ำ: 7 ชิ้น",
        "ควรเติม: 13 ชิ้น",
        "เป้าหมาย: 18 ชิ้น",
    ].join("\n"),
    next_action: "ตรวจสอบวัตถุดิบและยืนยันแผนผลิตที่ระบบสร้างไว้",
    lark_text: [
        "[CRM] 📦 สินค้าใกล้หมด",
        "",
        "สินค้า: Demo Product",
        "สี / ไซซ์: Ivory / L",
        "SKU: SKU-1",
        "คงเหลือ: 5 ชิ้น",
        "ขั้นต่ำ: 7 ชิ้น",
        "ควรเติม: 13 ชิ้น",
        "เป้าหมาย: 18 ชิ้น",
        "",
        "การดำเนินการ: ตรวจสอบวัตถุดิบและยืนยันแผนผลิตที่ระบบสร้างไว้",
    ].join("\n"),
};

function notificationRecord(status = "Pending", attemptCount = 0) {
    return {
        record_id: "notification-rec-1",
        fields: {
            [NOTIFICATION_FIELDS.STATUS]: status,
            [NOTIFICATION_FIELDS.ATTEMPT_COUNT]: attemptCount,
        },
    };
}

describe("PC alert delivery", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.recordNotificationOnce.mockResolvedValue({
            record: notificationRecord(),
            duplicate: false,
        });
        mocks.sendLarkGroupText.mockResolvedValue({ ok: true, response: {} });
        mocks.sendPcLarkActionCard.mockResolvedValue({ ok: true, response: {} });
        mocks.buildPcNotificationActionCard.mockResolvedValue(null);
        mocks.updateNotificationDelivery.mockResolvedValue(
            notificationRecord("Sent", 1)
        );
        mocks.enqueueNotificationDelivery.mockResolvedValue(undefined);
        mocks.classifyOperationalError.mockReturnValue({
            code: "TRANSIENT_INTEGRATION_ERROR",
            message: "temporary network failure",
            retryable: true,
        });
    });

    it("sends the readable low-stock text and marks the record Sent", async () => {
        await expect(
            notifyPcExceptionOnce({} as Env, alertInput)
        ).resolves.toBe(true);

        expect(mocks.sendLarkGroupText).toHaveBeenCalledWith(
            expect.anything(),
            alertInput.lark_text
        );
        expect(mocks.updateNotificationDelivery).toHaveBeenCalledWith(
            expect.anything(),
            "notification-rec-1",
            expect.objectContaining({
                status: "Sent",
                attempt_count: 1,
                error_message: "",
            })
        );
        expect(mocks.sendNotificationByRecordId).not.toHaveBeenCalled();
        expect(mocks.enqueueNotificationDelivery).not.toHaveBeenCalled();
    });

    it("sends an actionable card instead of duplicate text when a production batch is available", async () => {
        mocks.buildPcNotificationActionCard.mockResolvedValue({
            title: "📦 สินค้าใกล้หมด",
            markdown: "Low stock",
            actions: [
                {
                    text: "อนุมัติผลิตสินค้า",
                    url: "https://worker.example.com/action",
                },
            ],
        });

        await expect(
            notifyPcExceptionOnce({} as Env, alertInput)
        ).resolves.toBe(true);

        expect(mocks.sendPcLarkActionCard).toHaveBeenCalledTimes(1);
        expect(mocks.sendLarkGroupText).not.toHaveBeenCalled();
        expect(mocks.updateNotificationDelivery).toHaveBeenCalledWith(
            expect.anything(),
            "notification-rec-1",
            expect.objectContaining({ status: "Sent" })
        );
    });

    it("does not resend an idempotent readable alert already marked Sent", async () => {
        mocks.recordNotificationOnce.mockResolvedValue({
            record: notificationRecord("Sent", 1),
            duplicate: true,
        });

        await expect(
            notifyPcExceptionOnce({} as Env, alertInput)
        ).resolves.toBe(true);

        expect(mocks.sendLarkGroupText).not.toHaveBeenCalled();
        expect(mocks.updateNotificationDelivery).not.toHaveBeenCalled();
        expect(mocks.enqueueNotificationDelivery).not.toHaveBeenCalled();
    });

    it("queues a readable alert after a retryable Webhook failure", async () => {
        mocks.sendLarkGroupText.mockRejectedValue(
            new Error("temporary network failure")
        );

        await expect(
            notifyPcExceptionOnce({} as Env, alertInput)
        ).resolves.toBe(true);

        expect(mocks.updateNotificationDelivery).toHaveBeenCalledWith(
            expect.anything(),
            "notification-rec-1",
            expect.objectContaining({
                status: "Failed",
                attempt_count: 1,
                error_message: "temporary network failure",
            })
        );
        expect(mocks.enqueueNotificationDelivery).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                schema_version: 1,
                notification_record_id: "notification-rec-1",
                event_id: alertInput.event_id,
            })
        );
    });

    it("returns false for a permanent readable-alert failure", async () => {
        mocks.sendLarkGroupText.mockRejectedValue(
            new Error("keyword mismatch")
        );
        mocks.classifyOperationalError.mockReturnValue({
            code: "LARK_GROUP_WEBHOOK_KEYWORD_MISMATCH",
            message: "keyword mismatch",
            retryable: false,
        });

        await expect(
            notifyPcExceptionOnce({} as Env, alertInput)
        ).resolves.toBe(false);

        expect(mocks.enqueueNotificationDelivery).not.toHaveBeenCalled();
    });

    it("keeps the generic delivery path for PC stock alerts without custom text", async () => {
        mocks.sendNotificationByRecordId.mockResolvedValue({
            ok: true,
        });

        const { lark_text: _larkText, ...genericInput } = alertInput;

        await expect(
            notifyPcExceptionOnce({} as Env, genericInput)
        ).resolves.toBe(true);

        expect(mocks.sendNotificationByRecordId).toHaveBeenCalledWith(
            expect.anything(),
            "notification-rec-1"
        );
        expect(mocks.sendLarkGroupText).not.toHaveBeenCalled();
    });

    it("defers an automatic material-plan alert until it can be linked to an approved production batch", async () => {
        const materialInput = {
            event_id: "pc:material:FAB-IV:18:24",
            type: "PC_MATERIAL_SHORTAGE" as const,
            reference_id: "FAB-IV",
            product_name: "ผ้าสีไอวอรี่",
            detail: "วัตถุดิบขาด 6 m สำหรับแผนผลิตปัจจุบัน",
            next_action: "จัดหาวัตถุดิบก่อนอนุมัติ",
        };

        await expect(
            notifyPcExceptionOnce({} as Env, materialInput)
        ).resolves.toBe(true);

        expect(mocks.buildPcNotificationActionCard).toHaveBeenCalledTimes(1);
        expect(mocks.recordNotificationOnce).not.toHaveBeenCalled();
        expect(mocks.sendPcLarkActionCard).not.toHaveBeenCalled();
        expect(mocks.sendLarkGroupText).not.toHaveBeenCalled();
    });

    it("delivers the material purchase card after an approved batch is specifically blocked", async () => {
        mocks.buildPcNotificationActionCard.mockResolvedValue({
            title: "🧵 วัตถุดิบไม่เพียงพอ",
            markdown: "FAB-IV ขาด 6 m",
            actions: [
                {
                    text: "อนุมัติสั่งซื้อวัตถุดิบ",
                    url: "https://worker.example.com/purchase",
                },
            ],
        });
        const materialInput = {
            event_id: "pc:production-blocked:PROD-1:PC_PRODUCTION_MATERIAL_BLOCKED",
            type: "PC_MATERIAL_SHORTAGE" as const,
            reference_id: "PROD-1",
            product_name: "Demo Product",
            detail: "FAB-IV ขาด 6 m",
            next_action: "อนุมัติสั่งซื้อวัตถุดิบ",
        };

        await expect(
            notifyPcExceptionOnce({} as Env, materialInput)
        ).resolves.toBe(true);

        expect(mocks.recordNotificationOnce).toHaveBeenCalledTimes(1);
        expect(mocks.sendPcLarkActionCard).toHaveBeenCalledTimes(1);
        expect(mocks.sendLarkGroupText).not.toHaveBeenCalled();
    });
});
