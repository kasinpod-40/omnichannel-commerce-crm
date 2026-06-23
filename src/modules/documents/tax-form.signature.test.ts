import { describe, expect, it } from "vitest";
import { signTaxFormLink, verifyTaxFormLink } from "./tax-form.signature";

describe("tax form signature", () => {
    it("accepts a valid unexpired link", async () => {
        const expiresAt = Date.now() + 60_000;
        const signature = await signTaxFormLink("secret", "rec123", expiresAt);
        await expect(
            verifyTaxFormLink("secret", "rec123", expiresAt, signature)
        ).resolves.toBe(true);
    });

    it("rejects tampered and expired links", async () => {
        const expiresAt = Date.now() + 60_000;
        const signature = await signTaxFormLink("secret", "rec123", expiresAt);
        await expect(
            verifyTaxFormLink("secret", "rec999", expiresAt, signature)
        ).resolves.toBe(false);
        await expect(
            verifyTaxFormLink("secret", "rec123", Date.now() - 1, signature)
        ).resolves.toBe(false);
    });
});
