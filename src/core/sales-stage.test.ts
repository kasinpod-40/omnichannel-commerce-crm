import { describe, expect, it } from "vitest";

import {
    CLOSED_SALES_STAGE_VALUES,
    OPEN_SALES_STAGE_VALUES,
    SALES_STAGE_RANK,
    SALES_STAGE_VALUES,
    isClosedSalesStage,
    isOpenSalesStage,
    isSalesStage,
    normalizeOpenSalesStage,
    resolvePipelineStage,
} from "./sales-stage";

describe("canonical sales stage policy", () => {
    it("keeps the same stage order across AI, Customer, Pipeline, and Dashboard", () => {
        expect(SALES_STAGE_VALUES).toEqual([
            "New Lead",
            "Interested",
            "Negotiating",
            "Closing",
            "Won",
            "Lost",
        ]);
    });

    it("never ranks an active stage above Won/Lost", () => {
        expect(SALES_STAGE_RANK["New Lead"]).toBeLessThan(
            SALES_STAGE_RANK.Interested
        );
        expect(SALES_STAGE_RANK.Interested).toBeLessThan(
            SALES_STAGE_RANK.Negotiating
        );
        expect(SALES_STAGE_RANK.Negotiating).toBeLessThan(
            SALES_STAGE_RANK.Closing
        );
        expect(SALES_STAGE_RANK.Closing).toBeLessThan(
            SALES_STAGE_RANK.Won
        );
        expect(SALES_STAGE_RANK.Won).toBe(
            SALES_STAGE_RANK.Lost
        );
    });

    it("rejects unknown stage values", () => {
        expect(isSalesStage("New Lead")).toBe(true);
        expect(isSalesStage("Closed")).toBe(false);
        expect(isSalesStage(undefined)).toBe(false);
    });

    it("separates active and terminal stages", () => {
        expect(OPEN_SALES_STAGE_VALUES).toEqual([
            "New Lead",
            "Interested",
            "Negotiating",
            "Closing",
        ]);
        expect(CLOSED_SALES_STAGE_VALUES).toEqual(["Won", "Lost"]);
        expect(isOpenSalesStage("Closing")).toBe(true);
        expect(isOpenSalesStage("Won")).toBe(false);
        expect(isClosedSalesStage("Lost")).toBe(true);
        expect(isClosedSalesStage("Interested")).toBe(false);
    });

    it("normalizes persisted Pipeline stage using status as the source of truth", () => {
        expect(normalizeOpenSalesStage("Closing")).toBe("Closing");
        expect(normalizeOpenSalesStage("Won")).toBe("New Lead");
        expect(resolvePipelineStage("open", "Interested")).toBe("Interested");
        expect(resolvePipelineStage("open", "Won")).toBe("New Lead");
        expect(resolvePipelineStage("won", "Closing")).toBe("Won");
        expect(resolvePipelineStage("lost", "New Lead")).toBe("Lost");
    });
});
