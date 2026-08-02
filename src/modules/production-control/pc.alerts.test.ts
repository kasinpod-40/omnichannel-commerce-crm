import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { NOTIFICATION_FIELDS } from "../../core/lark-fields";

const mocks = vi.hoisted(() => ({
    recordNotificationOnce: vi.fn(),
    sendNotificationByRecordId: vi.fn(),
    sendLarkGroupText: vi.fn(),
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

    it("keeps the generic delivery path for PC alerts without custom text", async () => {
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
});
