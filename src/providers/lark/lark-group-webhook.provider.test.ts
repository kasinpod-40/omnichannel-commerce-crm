import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import {
    resolveLarkGroupWebhookTarget,
    sendLarkGroupReviewCard,
    sendLarkGroupText,
} from "./lark-group-webhook.provider";

const env = {
    LARK_GROUP_WEBHOOK_URL:
        "https://open.larksuite.com/open-apis/bot/v2/hook/crm-test",
    LARK_PC_GROUP_WEBHOOK_URL:
        "https://open.larksuite.com/open-apis/bot/v2/hook/pc-test",
    LARK_GROUP_WEBHOOK_KEYWORD: "CRM",
} as Env;

function successResponse(): Response {
    return new Response(
        JSON.stringify({ code: 0, msg: "success" }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json",
            },
        }
    );
}

describe("Lark group webhook keyword safety and routing", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("ส่ง Interactive Card พร้อม Keyword และปุ่มเปิด Payment Review URL ไปกลุ่ม CRM เดิม", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(successResponse());
        vi.stubGlobal("fetch", fetchMock);

        await sendLarkGroupReviewCard(env, {
            title: "มีการชำระเงินรอตรวจสอบ",
            markdown: "ลูกค้า: Test",
            button_text: "เปิดตรวจสอบ",
            button_url:
                "https://crm.example.com/orders/rec-order-001?review=1",
        });

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0] as [
            string,
            RequestInit,
        ];
        expect(url).toBe(env.LARK_GROUP_WEBHOOK_URL);
        const payload = JSON.parse(
            String(init.body)
        ) as {
            msg_type: string;
            card: {
                header: {
                    title: { content: string };
                };
                elements: Array<{
                    text?: { content?: string };
                    actions?: Array<{ url?: string }>;
                }>;
            };
        };
        expect(payload.msg_type).toBe("interactive");
        expect(
            payload.card.header.title.content
        ).toContain("CRM");
        expect(
            payload.card.elements[0]?.text?.content
        ).toContain("CRM");
        expect(
            payload.card.elements
                .flatMap(
                    (element) =>
                        element.actions ?? []
                )
                .find((action) => action.url)?.url
        ).toBe(
            "https://crm.example.com/orders/rec-order-001?review=1"
        );
    });

    it("ใส่ Keyword ในข้อความธรรมดาและคงการแจ้งเตือน CRM ไว้กลุ่มเดิม", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(successResponse());
        vi.stubGlobal("fetch", fetchMock);

        await sendLarkGroupText(
            env,
            "แจ้งเตือนทดสอบ"
        );

        const [url, init] = fetchMock.mock.calls[0] as [
            string,
            RequestInit,
        ];
        expect(url).toBe(env.LARK_GROUP_WEBHOOK_URL);
        const payload = JSON.parse(
            String(init.body)
        ) as {
            content: { text: string };
        };
        expect(payload.content.text).toContain("CRM");
    });

    it("ส่ง PC_STOCK_EXCEPTION ไปกลุ่ม Production & Stock ใหม่", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(successResponse());
        vi.stubGlobal("fetch", fetchMock);
        const text = [
            "[CRM] 📦 พบข้อยกเว้นด้านสต็อกสินค้า",
            "",
            "อ้างอิง: SKU-001",
        ].join("\n");

        expect(
            resolveLarkGroupWebhookTarget(text)
        ).toBe("production-control");

        await sendLarkGroupText(env, text);

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            env.LARK_PC_GROUP_WEBHOOK_URL
        );
    });

    it("ส่ง PC_MATERIAL_SHORTAGE ไปกลุ่ม Production & Stock ใหม่", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(successResponse());
        vi.stubGlobal("fetch", fetchMock);
        const text = [
            "[CRM] 🧵 วัตถุดิบไม่เพียงพอสำหรับแผนผลิต",
            "",
            "อ้างอิง: MAT-001",
        ].join("\n");

        expect(
            resolveLarkGroupWebhookTarget(text)
        ).toBe("production-control");

        await sendLarkGroupText(env, text);

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            env.LARK_PC_GROUP_WEBHOOK_URL
        );
    });

    it("ไม่ route ผิดจากข้อความรายละเอียดที่บังเอิญมีชื่อ PC alert", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(successResponse());
        vi.stubGlobal("fetch", fetchMock);
        const text = [
            "[CRM] 🔔 การแจ้งเตือนทั่วไป",
            "",
            "รายละเอียด: 📦 พบข้อยกเว้นด้านสต็อกสินค้า",
        ].join("\n");

        expect(
            resolveLarkGroupWebhookTarget(text)
        ).toBe("crm");

        await sendLarkGroupText(env, text);

        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            env.LARK_GROUP_WEBHOOK_URL
        );
    });

    it("หยุดแบบ fail-closed เมื่อไม่มี PC Webhook และไม่ fallback ไปกลุ่ม CRM เดิม", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(
            sendLarkGroupText(
                {
                    ...env,
                    LARK_PC_GROUP_WEBHOOK_URL:
                        undefined,
                },
                "[CRM] 📦 พบข้อยกเว้นด้านสต็อกสินค้า"
            )
        ).rejects.toMatchObject({
            code: "LARK_PC_GROUP_WEBHOOK_URL_NOT_CONFIGURED",
            retryable: false,
        });

        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("รายงาน Error 19024 เป็น Configuration Error ที่ไม่ควร Retry", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(
                new Response(
                    JSON.stringify({
                        code: 19024,
                        msg: "Key Words Not Found",
                    }),
                    {
                        status: 200,
                        headers: {
                            "Content-Type":
                                "application/json",
                        },
                    }
                )
            )
        );

        await expect(
            sendLarkGroupReviewCard(env, {
                title: "Review",
                markdown: "Test",
                button_text: "Open",
                button_url:
                    "https://crm.example.com/orders/1",
            })
        ).rejects.toMatchObject({
            code: "LARK_GROUP_WEBHOOK_KEYWORD_MISMATCH",
            retryable: false,
        });
    });

    it("ใช้ Keyword CRM เดิมเป็น fallback เมื่อ Environment ยังไม่ได้เพิ่มค่ารุ่นใหม่", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(successResponse());
        vi.stubGlobal("fetch", fetchMock);

        await sendLarkGroupText(
            {
                ...env,
                LARK_GROUP_WEBHOOK_KEYWORD: "",
            },
            "Test"
        );

        const [, init] = fetchMock.mock.calls[0] as [
            string,
            RequestInit,
        ];
        const payload = JSON.parse(
            String(init.body)
        ) as {
            content: { text: string };
        };
        expect(payload.content.text).toContain(
            "[CRM]"
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
                button_url:
                    "http://crm.example.com/orders/1",
            })
        ).rejects.toThrow("must start with https://");
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
