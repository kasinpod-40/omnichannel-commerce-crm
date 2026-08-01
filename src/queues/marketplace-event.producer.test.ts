import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../config/env";

const { updateOrderPcStatus } = vi.hoisted(() => ({
    updateOrderPcStatus: vi.fn(),
}));

vi.mock("../modules/production-control/pc.repository", () => ({
    updateOrderPcStatus,
}));

import {
    enqueuePcOrderSync,
    enqueuePcOrderSyncAfterBusinessWrite,
} from "./marketplace-event.producer";

function env(send = vi.fn()): Env {
    return {
        MARKETPLACE_EVENTS_QUEUE: { send },
    } as unknown as Env;
}

describe("PC queue producer", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("keeps manual reconcile fail-closed when the Queue send fails", async () => {
        const queueError = new Error("queue unavailable");
        const runtime = env(vi.fn().mockRejectedValue(queueError));

        await expect(
            enqueuePcOrderSync(runtime, {
                order_record_id: "rec-order-1",
                source: "dashboard",
                event_id: "event-1",
            })
        ).rejects.toThrow("queue unavailable");

        expect(updateOrderPcStatus).not.toHaveBeenCalled();
    });

    it("does not fail an already-persisted business operation when Queue send fails", async () => {
        const runtime = env(
            vi.fn().mockRejectedValue(new Error("queue unavailable"))
        );
        updateOrderPcStatus.mockResolvedValue(undefined);

        await expect(
            enqueuePcOrderSyncAfterBusinessWrite(runtime, {
                order_record_id: "rec-order-1",
                source: "payment",
                event_id: "event-1",
            })
        ).resolves.toBe(false);

        expect(updateOrderPcStatus).toHaveBeenCalledWith(
            runtime,
            "rec-order-1",
            "BLOCKED"
        );
    });

    it("returns success after Queue delivery and does not mark the Order blocked", async () => {
        const send = vi.fn().mockResolvedValue(undefined);
        const runtime = env(send);

        await expect(
            enqueuePcOrderSyncAfterBusinessWrite(runtime, {
                order_record_id: "rec-order-1",
                source: "marketplace",
                event_id: "event-1",
            })
        ).resolves.toBe(true);

        expect(send).toHaveBeenCalledOnce();
        expect(updateOrderPcStatus).not.toHaveBeenCalled();
    });
});
