import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_FIELDS } from "../../core/lark-fields";

const {
    findNotificationByEventId,
    createNotification,
    enqueueNotificationDelivery,
} = vi.hoisted(() => ({
    findNotificationByEventId: vi.fn(),
    createNotification: vi.fn(),
    enqueueNotificationDelivery: vi.fn(),
}));

vi.mock("./notification.repository", async (importOriginal) => {
    const original = await importOriginal<typeof import("./notification.repository")>();
    return {
        ...original,
        findNotificationByEventId,
        createNotification,
    };
});

vi.mock("../../queues/notification.producer", () => ({
    enqueueNotificationDelivery,
}));

import { recordAndDispatchNotificationOnce } from "./notification.service";

describe("notification idempotency", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        enqueueNotificationDelivery.mockResolvedValue(undefined);
    });

    it("does not enqueue a duplicate notification that is already Sent", async () => {
        findNotificationByEventId.mockResolvedValue({
            record_id: "noti1",
            fields: {
                [NOTIFICATION_FIELDS.STATUS]: "Sent",
            },
        });

        const result = await recordAndDispatchNotificationOnce(
            {} as any,
            {
                event_id: "SALE_WON:pipe1",
                notification_type: "SALE_WON",
                customer_record_id: "cus1",
                message: "done",
            }
        );

        expect(result.duplicate).toBe(true);
        expect(enqueueNotificationDelivery).not.toHaveBeenCalled();
        expect(createNotification).not.toHaveBeenCalled();
    });

    it("re-enqueues a duplicate Pending notification for recovery", async () => {
        findNotificationByEventId.mockResolvedValue({
            record_id: "noti1",
            fields: {
                [NOTIFICATION_FIELDS.STATUS]: "Pending",
            },
        });

        await recordAndDispatchNotificationOnce(
            {} as any,
            {
                event_id: "PAYMENT_REVIEW:order1",
                notification_type: "PAYMENT_REVIEW",
                customer_record_id: "cus1",
                message: "review",
            }
        );

        expect(enqueueNotificationDelivery).toHaveBeenCalledOnce();
    });
});
