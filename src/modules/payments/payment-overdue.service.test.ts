import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_FIELDS } from "../../core/lark-fields";

const {
    getOrderByRecordId,
    listOrders,
    updateOrder,
    recordActivityOnce,
    recordAndDispatchNotificationOnce,
} = vi.hoisted(() => ({
    getOrderByRecordId: vi.fn(),
    listOrders: vi.fn(),
    updateOrder: vi.fn(),
    recordActivityOnce: vi.fn(),
    recordAndDispatchNotificationOnce: vi.fn(),
}));

vi.mock("../orders/order.repository", () => ({
    getOrderByRecordId,
    listOrders,
    updateOrder,
}));

vi.mock("../activities/activity.service", () => ({
    recordActivityOnce,
}));

vi.mock("../notifications/notification.service", () => ({
    recordAndDispatchNotificationOnce,
}));

import {
    markOrderPaymentOverdue,
    runPaymentOverdueSweep,
} from "./payment-overdue.service";

const env = {} as any;

function order(
    id: string,
    fields: Record<string, unknown>
) {
    return {
        record_id: id,
        fields: {
            [ORDER_FIELDS.PAYMENT_STATUS]: "Waiting Payment",
            [ORDER_FIELDS.ORDER_STATUS]: "Waiting Payment",
            [ORDER_FIELDS.PAYMENT_VERIFIED]: false,
            [ORDER_FIELDS.CUSTOMER]: ["cus1"],
            ...fields,
        },
    };
}

describe("payment overdue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        updateOrder.mockResolvedValue({
            record_id: "order1",
            fields: {},
        });
        recordActivityOnce.mockResolvedValue({
            duplicate: false,
            record: { record_id: "a1", fields: {} },
        });
        recordAndDispatchNotificationOnce.mockResolvedValue({
            duplicate: false,
            record: { record_id: "n1", fields: {} },
            delivery: null,
        });
    });

    it("marks only the Lark-triggered order overdue", async () => {
        getOrderByRecordId.mockResolvedValue(
            order("order1", {
                [ORDER_FIELDS.PAYMENT_DUE_AT]: 1_000,
            })
        );

        const result = await markOrderPaymentOverdue(
            env,
            "order1",
            2_000
        );

        expect(result).toMatchObject({
            order_record_id: "order1",
            updated: true,
            skipped: false,
            reason: "UPDATED",
            activity_recorded: true,
            notification_recorded: true,
        });
        expect(getOrderByRecordId).toHaveBeenCalledWith(
            env,
            "order1"
        );
        expect(listOrders).not.toHaveBeenCalled();
        expect(updateOrder).toHaveBeenCalledWith(
            env,
            "order1",
            { payment_status: "Overdue" }
        );
        expect(recordActivityOnce).toHaveBeenCalledWith(
            env,
            expect.objectContaining({
                event_id: "payment-overdue:order1",
                action: "PAYMENT_OVERDUE",
            })
        );
        expect(
            recordAndDispatchNotificationOnce
        ).toHaveBeenCalledWith(
            env,
            expect.objectContaining({
                event_id: "payment-overdue:order1",
                notification_type: "PAYMENT_OVERDUE",
            })
        );
    });

    it("is idempotent when the order is already overdue", async () => {
        getOrderByRecordId.mockResolvedValue(
            order("order1", {
                [ORDER_FIELDS.PAYMENT_DUE_AT]: 1_000,
                [ORDER_FIELDS.PAYMENT_STATUS]: "Overdue",
            })
        );

        const result = await markOrderPaymentOverdue(
            env,
            "order1",
            2_000
        );

        expect(result).toMatchObject({
            updated: false,
            skipped: true,
            reason: "ALREADY_OVERDUE",
        });
        expect(updateOrder).not.toHaveBeenCalled();
        expect(recordActivityOnce).not.toHaveBeenCalled();
        expect(
            recordAndDispatchNotificationOnce
        ).not.toHaveBeenCalled();
    });

    it("does not mark an order that is no longer eligible", async () => {
        getOrderByRecordId.mockResolvedValue(
            order("order1", {
                [ORDER_FIELDS.PAYMENT_DUE_AT]: 1_000,
                [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
            })
        );

        const result = await markOrderPaymentOverdue(
            env,
            "order1",
            2_000
        );

        expect(result).toMatchObject({
            updated: false,
            skipped: true,
            reason: "PAYMENT_VERIFIED",
        });
        expect(updateOrder).not.toHaveBeenCalled();
    });

    it("throws when the triggered order record does not exist", async () => {
        getOrderByRecordId.mockResolvedValue(null);

        await expect(
            markOrderPaymentOverdue(
                env,
                "missing-order",
                2_000
            )
        ).rejects.toThrow(
            "ORDER_RECORD_NOT_FOUND:missing-order"
        );
    });

    it("marks an expired waiting-payment order during a manual sweep", async () => {
        listOrders.mockResolvedValue([
            order("order1", {
                [ORDER_FIELDS.PAYMENT_DUE_AT]: 1_000,
            }),
        ]);

        const result = await runPaymentOverdueSweep(
            env,
            2_000
        );

        expect(result.updated).toBe(1);
        expect(result.notifications_recorded).toBe(1);
        expect(updateOrder).toHaveBeenCalledWith(
            env,
            "order1",
            { payment_status: "Overdue" }
        );
    });

    it("skips paid, future-due and verified orders during a manual sweep", async () => {
        listOrders.mockResolvedValue([
            order("future", {
                [ORDER_FIELDS.PAYMENT_DUE_AT]: 3_000,
            }),
            order("paid", {
                [ORDER_FIELDS.PAYMENT_DUE_AT]: 1_000,
                [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
            }),
            order("verified", {
                [ORDER_FIELDS.PAYMENT_DUE_AT]: 1_000,
                [ORDER_FIELDS.PAYMENT_VERIFIED]: true,
            }),
        ]);

        const result = await runPaymentOverdueSweep(
            env,
            2_000
        );

        expect(result.updated).toBe(0);
        expect(result.skipped).toBe(3);
        expect(updateOrder).not.toHaveBeenCalled();
    });
});
