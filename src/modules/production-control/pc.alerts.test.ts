import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";

const mocks = vi.hoisted(() => ({
    recordNotificationOnce: vi.fn(),
    sendNotificationByRecordId: vi.fn(),
    enqueueNotificationDelivery: vi.fn(),
}));

vi.mock("../notifications/notification.service", () => ({
    recordNotificationOnce: mocks.recordNotificationOnce,
    sendNotificationByRecordId: mocks.sendNotificationByRecordId,
}));

vi.mock("../../queues/notification.producer", () => ({
    enqueueNotificationDelivery: mocks.enqueueNotificationDelivery,
}));

import { notifyPcExceptionOnce } from "./pc.alerts";

const alertInput = {
    event_id: "pc:low-stock:order-1:fp-1:SKU-1",
    type: "PC_STOCK_EXCEPTION" as const,
    reference_id: "SKU-1",
    product_name: "Demo Product · Ivory L",
    detail: "สินค้าใกล้หมด: คงเหลือ 5 ชิ้น",
    next_action: "เติม Stock ให้ถึงเป้าหมาย 18 ชิ้น",
};

describe("PC alert delivery", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.recordNotificationOnce.mockResolvedValue({
            record: {
                record_id: "notification-rec-1",
                fields: {},
            },
            duplicate: false,
        });
    });

    it("returns success when direct Lark delivery succeeds", async () => {
        mocks.sendNotificationByRecordId.mockResolvedValue({
            ok: true,
            duplicate: false,
        });

        await expect(
            notifyPcExceptionOnce({} as Env, alertInput)
        ).resolves.toBe(true);

        expect(mocks.sendNotificationByRecordId).toHaveBeenCalledWith(
            expect.anything(),
            "notification-rec-1"
        );
        expect(mocks.enqueueNotificationDelivery).not.toHaveBeenCalled();
    });

    it("queues a retryable direct-delivery failure", async () => {
        mocks.sendNotificationByRecordId.mockResolvedValue({
            ok: false,
            duplicate: false,
            retryable: true,
            error_code: "TRANSIENT_INTEGRATION_ERROR",
            error_message: "temporary network failure",
        });
        mocks.enqueueNotificationDelivery.mockResolvedValue(undefined);

        await expect(
            notifyPcExceptionOnce({} as Env, alertInput)
        ).resolves.toBe(true);

        expect(mocks.enqueueNotificationDelivery).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                schema_version: 1,
                notification_record_id: "notification-rec-1",
                event_id: alertInput.event_id,
            })
        );
    });

    it("returns false for a permanent Lark delivery failure", async () => {
        mocks.sendNotificationByRecordId.mockResolvedValue({
            ok: false,
            duplicate: false,
            retryable: false,
            error_code: "LARK_GROUP_WEBHOOK_KEYWORD_MISMATCH",
            error_message: "keyword mismatch",
        });

        await expect(
            notifyPcExceptionOnce({} as Env, alertInput)
        ).resolves.toBe(false);

        expect(mocks.enqueueNotificationDelivery).not.toHaveBeenCalled();
    });

    it("returns false when direct delivery and Queue fallback both fail", async () => {
        mocks.sendNotificationByRecordId.mockResolvedValue({
            ok: false,
            duplicate: false,
            retryable: true,
            error_code: "TRANSIENT_INTEGRATION_ERROR",
            error_message: "temporary network failure",
        });
        mocks.enqueueNotificationDelivery.mockRejectedValue(
            new Error("queue unavailable")
        );

        await expect(
            notifyPcExceptionOnce({} as Env, alertInput)
        ).resolves.toBe(false);
    });
});
