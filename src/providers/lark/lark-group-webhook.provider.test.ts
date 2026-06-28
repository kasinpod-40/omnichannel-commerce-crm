import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import { sendLarkGroupReviewCard } from "./lark-group-webhook.provider";

const env = {
    LARK_GROUP_WEBHOOK_URL: "https://open.larksuite.com/open-apis/bot/v2/hook/test",
} as Env;

describe("Lark payment review card", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("ส่ง Interactive Card พร้อมปุ่มเปิด Payment Review URL", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ code: 0, msg: "success" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        );
        vi.stubGlobal("fetch", fetchMock);

        await sendLarkGroupReviewCard(env, {
            title: "มีการชำระเงินรอตรวจสอบ",
            markdown: "ลูกค้า: Test",
            button_text: "เปิดตรวจสอบ",
            button_url: "https://crm.example.com/orders/rec-order-001?review=1",
        });

        expect(fetchMock).toHaveBeenCalledOnce();
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const payload = JSON.parse(String(init.body)) as {
            msg_type: string;
            card: { elements: Array<{ actions?: Array<{ url?: string }> }> };
        };
        expect(payload.msg_type).toBe("interactive");
        expect(payload.card.elements[1]?.actions?.[0]?.url).toBe(
            "https://crm.example.com/orders/rec-order-001?review=1"
        );
    });

    it("ปฏิเสธ URL ที่ไม่ใช่ HTTPS ก่อนยิง Webhook", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            sendLarkGroupReviewCard(env, {
                title: "Review",
                markdown: "Test",
                button_text: "Open",
                button_url: "http://crm.example.com/orders/1",
            })
        ).rejects.toThrow("must start with https://");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
