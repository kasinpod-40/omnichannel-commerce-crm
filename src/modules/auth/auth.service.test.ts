import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    exchangeLarkAuthorizationCode: vi.fn(),
    getLarkLoginIdentity: vi.fn(),
}));

vi.mock("../../providers/lark/lark-auth.provider", () => ({
    exchangeLarkAuthorizationCode: mocks.exchangeLarkAuthorizationCode,
    getLarkLoginIdentity: mocks.getLarkLoginIdentity,
}));

import type { Env } from "../../config/env";
import { authenticateWithLarkCode } from "./auth.service";

const env = {
    AUTH_SESSION_SECRET: "test-secret-that-is-longer-than-thirty-two-characters",
    AUTH_SESSION_TTL_SECONDS: "3600",
    LARK_ALLOWED_TENANT_KEY: "tenant_001",
} as Env;

const identity = {
    open_id: "ou_001",
    union_id: "on_001",
    user_id: "u_001",
    tenant_key: "tenant_001",
    name: "Lark User",
    email: "user@example.com",
    avatar_url: null,
};

describe("authenticateWithLarkCode", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.exchangeLarkAuthorizationCode.mockResolvedValue("u-token");
        mocks.getLarkLoginIdentity.mockResolvedValue(identity);
    });

    it("สร้าง Session จากบัญชี Lark โดยไม่ค้นตารางสิทธิ์เพิ่มเติม", async () => {
        const result = await authenticateWithLarkCode(
            env,
            "temporary-code",
            1_000_000
        );

        expect(result.response.user).toMatchObject({
            user_id: "u_001",
            lark_open_id: "ou_001",
            name: "Lark User",
            email: "user@example.com",
            role: "admin",
            sales_owner_name: null,
        });
        expect(result.token).toContain(".");
        expect(mocks.exchangeLarkAuthorizationCode).toHaveBeenCalledWith(
            env,
            "temporary-code"
        );
    });

    it("อนุญาตผู้ใช้ตาม Lark App Availability เมื่อยังไม่ตั้ง Tenant Key", async () => {
        const result = await authenticateWithLarkCode(
            {
                ...env,
                LARK_ALLOWED_TENANT_KEY: undefined,
            },
            "temporary-code"
        );

        expect(result.response.user.lark_open_id).toBe("ou_001");
    });

    it("ปฏิเสธบัญชีจาก Tenant อื่นเมื่อเปิดใช้ Tenant Check", async () => {
        mocks.getLarkLoginIdentity.mockResolvedValue({
            ...identity,
            tenant_key: "tenant_other",
        });

        await expect(
            authenticateWithLarkCode(env, "temporary-code")
        ).rejects.toMatchObject({
            code: "AUTH_TENANT_FORBIDDEN",
            status: 403,
        });
    });

    it("ปฏิเสธเมื่อ Lark ไม่คืน tenant_key แต่ระบบบังคับตรวจ Tenant", async () => {
        mocks.getLarkLoginIdentity.mockResolvedValue({
            ...identity,
            tenant_key: null,
        });

        await expect(
            authenticateWithLarkCode(env, "temporary-code")
        ).rejects.toMatchObject({
            code: "AUTH_TENANT_MISSING",
            status: 403,
        });
    });

    it("fallback user_id เป็น open_id เมื่อ Lark ไม่คืน user_id และ union_id", async () => {
        mocks.getLarkLoginIdentity.mockResolvedValue({
            ...identity,
            user_id: null,
            union_id: null,
        });

        const result = await authenticateWithLarkCode(
            env,
            "temporary-code"
        );

        expect(result.response.user.user_id).toBe("ou_001");
    });
});
