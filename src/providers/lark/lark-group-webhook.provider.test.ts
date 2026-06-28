import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import {
    sendLarkGroupReviewCard,
    sendLarkGroupText,
} from "./lark-group-webhook.provider";

const env = {
    LARK_GROUP_WEBHOOK_URL: "https://open.larksuite.com/open-apis/bot/v2/hook/test",
    LARK_GROUP_WEBHOOK_KEYWORD: "CRM",
} as Env;

describe("Lark group webhook keyword safety", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("ส่ง Interactive Card พร้อม Keyword และปุ่มเปิด Payment Review URL", async () => {
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
            card: {
                header: { title: { content: string } };
                elements: Array<{
                    text?: { content?: string };
                    actions?: Array<{ url?: string }>;
                }>;
            };
        };
        expect(payload.msg_type).toBe("interactive");
        expect(payload.card.header.title.content).toContain("CRM");
        expect(payload.card.elements[0]?.text?.content).toContain("CRM");
        expect(
            payload.card.elements
                .flatMap((element) => element.actions ?? [])
                .find((action) => action.url)?.url
        ).toBe("https://crm.example.com/orders/rec-order-001?review=1");
    });

    it("ใส่ Keyword ในข้อความธรรมดาด้วย เพื่อให้ Notification ประเภทอื่นไม่ถูก Bot ปฏิเสธ", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ code: 0, msg: "success" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        );
        vi.stubGlobal("fetch", fetchMock);

        await sendLarkGroupText(env, "แจ้งเตือนทดสอบ");

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const payload = JSON.parse(String(init.body)) as { content: { text: string } };
        expect(payload.content.text).toContain("CRM");
    });

    it("รายงาน Error 19024 เป็น Configuration Error ที่ไม่ควร Retry", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(JSON.stringify({ code: 19024, msg: "Key Words Not Found" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                })
            )
        );

        await expect(
            sendLarkGroupReviewCard(env, {
                title: "Review",
                markdown: "Test",
                button_text: "Open",
                button_url: "https://crm.example.com/orders/1",
            })
        ).rejects.toMatchObject({
            code: "LARK_GROUP_WEBHOOK_KEYWORD_MISMATCH",
            retryable: false,
        });
    });

    it("ใช้ Keyword CRM เดิมเป็น fallback เมื่อ Environment ยังไม่ได้เพิ่มค่ารุ่นใหม่", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ code: 0, msg: "success" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        );
        vi.stubGlobal("fetch", fetchMock);

        await sendLarkGroupText(
            { ...env, LARK_GROUP_WEBHOOK_KEYWORD: "" },
            "Test"
        );

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const payload = JSON.parse(String(init.body)) as { content: { text: string } };
        expect(payload.content.text).toContain("[CRM]");
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
