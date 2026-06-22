import { describe, expect, it } from "vitest";
import {
    classifyOperationalError,
    createHttpOperationalError,
    OperationalError,
} from "./errors";

describe("operational error classification", () => {
    it.each([429, 500, 502, 503, 504])(
        "classifies HTTP %s as retryable",
        (status) => {
            const error = createHttpOperationalError(
                "Gemini",
                "image analysis",
                status,
                "temporary"
            );

            expect(classifyOperationalError(error).retryable).toBe(true);
        }
    );

    it.each([400, 401, 403, 404, 422])(
        "classifies HTTP %s as permanent",
        (status) => {
            const error = createHttpOperationalError(
                "Lark",
                "update record",
                status,
                "invalid request"
            );

            expect(classifyOperationalError(error).retryable).toBe(false);
        }
    );

    it("keeps an explicit operational classification", () => {
        const error = new OperationalError(
            "TEST_TRANSIENT",
            "temporary dependency failure",
            { retryable: true }
        );

        expect(classifyOperationalError(error)).toMatchObject({
            code: "TEST_TRANSIENT",
            retryable: true,
        });
    });

    it("does not retry data invariant violations", () => {
        expect(
            classifyOperationalError(
                new Error("PIPELINE_INVARIANT_MULTIPLE_OPEN")
            ).retryable
        ).toBe(false);
    });
});
