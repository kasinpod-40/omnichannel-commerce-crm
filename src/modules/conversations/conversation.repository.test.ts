import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "./conversation.types";

const { createLarkRecord } = vi.hoisted(() => ({
    createLarkRecord: vi.fn(),
}));

vi.mock("../../providers/lark/lark.provider", () => ({
    createLarkRecord,
    searchLarkRecords: vi.fn(),
    updateLarkRecord: vi.fn(),
}));

vi.mock("../../providers/lark/lark-attachment.provider", () => ({
    toLarkAttachmentFieldValue: vi.fn((tokens: string[]) =>
        tokens.map((fileToken) => ({ file_token: fileToken }))
    ),
}));

import { createConversation } from "./conversation.repository";

function createInput(overrides: Partial<Conversation> = {}): Conversation {
    return {
        channel: "LINE",
        external_message_id: "line-message-1",
        message_type: "text",
        message: "hello",
        intent: "greeting",
        buyer_intent: "Just Browsing",
        lead_score: 10,
        hot_lead: false,
        process_status: "processing",
        created_at: 1_750_000_000_000,
        ...overrides,
    };
}

describe("conversation URL field serialization", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createLarkRecord.mockResolvedValue({
            record: {
                record_id: "conversation-record-1",
                fields: {},
            },
        });
    });

    it("omits image_url when no URL is available", async () => {
        await createConversation(
            { CONVERSATIONS_TABLE_ID: "table-1" } as any,
            createInput()
        );

        const fields = createLarkRecord.mock.calls[0][2] as Record<string, unknown>;
        expect(fields).not.toHaveProperty("image_url");
    });

    it("writes image_url using the Lark hyperlink object shape", async () => {
        await createConversation(
            { CONVERSATIONS_TABLE_ID: "table-1" } as any,
            createInput({ image_url: "https://example.com/image.jpg" })
        );

        const fields = createLarkRecord.mock.calls[0][2] as Record<string, unknown>;
        expect(fields.image_url).toEqual({
            link: "https://example.com/image.jpg",
            text: "Open image",
        });
    });
});
