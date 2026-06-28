import { describe, expect, it } from "vitest";
import { shouldSendHotLeadNotification } from "./incoming-message-notification.rules";

describe("incoming message HOT_LEAD notification", () => {
    it("does not notify when Customer hot_lead is stale but current AI is not hot", () => {
        expect(
            shouldSendHotLeadNotification({
                current_hot_lead: false,
                previous_hot_lead: true,
                starting_new_sales_cycle: false,
            })
        ).toBe(false);
    });

    it("notifies when the current message becomes hot in the same sales cycle", () => {
        expect(
            shouldSendHotLeadNotification({
                current_hot_lead: true,
                previous_hot_lead: false,
                starting_new_sales_cycle: false,
            })
        ).toBe(true);
    });

    it("notifies a real hot lead again when a new sales cycle starts", () => {
        expect(
            shouldSendHotLeadNotification({
                current_hot_lead: true,
                previous_hot_lead: true,
                starting_new_sales_cycle: true,
            })
        ).toBe(true);
    });
});
