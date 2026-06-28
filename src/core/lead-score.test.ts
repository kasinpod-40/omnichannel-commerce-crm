import { describe, expect, it } from "vitest";
import { normalizeLeadScore } from "./lead-score";

describe("lead score policy", () => {
    it.each([
        [-10, 0],
        [0, 0],
        [34.6, 35],
        [100, 100],
        [140, 100],
        ["82", 82],
    ])("normalizes %s to %s", (input, expected) => {
        expect(normalizeLeadScore(input)).toBe(expected);
    });

    it("uses a safe normalized fallback for invalid values", () => {
        expect(normalizeLeadScore("bad", 45.4)).toBe(45);
        expect(normalizeLeadScore(undefined, 140)).toBe(100);
    });
});
