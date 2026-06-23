import { describe, expect, it } from "vitest";
import {
    signDocumentLink,
    verifyDocumentLink,
} from "./document.signature";

describe("document link signature", () => {
    it("accepts a valid unexpired link", async () => {
        const expiresAt = Date.now() + 60_000;
        const signature = await signDocumentLink(
            "secret",
            "rec123",
            "invoice",
            expiresAt
        );

        await expect(
            verifyDocumentLink(
                "secret",
                "rec123",
                "invoice",
                expiresAt,
                signature
            )
        ).resolves.toBe(true);
    });

    it("rejects tampering and expired links", async () => {
        const expiresAt = Date.now() + 60_000;
        const signature = await signDocumentLink(
            "secret",
            "rec123",
            "quotation",
            expiresAt
        );

        await expect(
            verifyDocumentLink(
                "secret",
                "rec999",
                "quotation",
                expiresAt,
                signature
            )
        ).resolves.toBe(false);

        await expect(
            verifyDocumentLink(
                "secret",
                "rec123",
                "quotation",
                Date.now() - 1,
                signature
            )
        ).resolves.toBe(false);
    });
});
