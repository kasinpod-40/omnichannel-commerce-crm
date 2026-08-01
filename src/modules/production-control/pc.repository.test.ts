import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import { OperationalError } from "../../utils/errors";
import {
    assertPcInventoryEnabled,
    isPcInventoryEnabled,
} from "./pc.repository";

function env(enabled?: string): Env {
    return { PC_INVENTORY_ENABLED: enabled } as unknown as Env;
}

describe("PC inventory feature flag", () => {
    it("allows mutations only when the flag is explicitly true", () => {
        expect(isPcInventoryEnabled(env("true"))).toBe(true);
        expect(isPcInventoryEnabled(env(" TRUE "))).toBe(true);
        expect(() => assertPcInventoryEnabled(env("true"))).not.toThrow();
    });

    it.each([undefined, "", "false", "1", "yes"])(
        "fails closed for %s",
        (value) => {
            expect(isPcInventoryEnabled(env(value))).toBe(false);

            try {
                assertPcInventoryEnabled(env(value));
                throw new Error("expected PC_INVENTORY_DISABLED");
            } catch (error) {
                expect(error).toBeInstanceOf(OperationalError);
                expect(error).toMatchObject({
                    code: "PC_INVENTORY_DISABLED",
                    retryable: false,
                    status: 503,
                });
            }
        }
    );
});
