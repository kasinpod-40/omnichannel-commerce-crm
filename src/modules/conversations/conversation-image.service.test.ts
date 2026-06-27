import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONVERSATION_FIELDS } from "../../core/lark-fields";

const { getConversationByRecordId, downloadLarkMedia, downloadLineMessageContent } = vi.hoisted(() => ({
    getConversationByRecordId: vi.fn(),
    downloadLarkMedia: vi.fn(),
    downloadLineMessageContent: vi.fn(),
}));

vi.mock("./conversation.repository", () => ({ getConversationByRecordId }));
vi.mock("../../providers/lark/lark-attachment.provider", () => ({ downloadLarkMedia }));
vi.mock("../../providers/line/line.provider", () => ({ downloadLineMessageContent }));

import { getConversationImage } from "./conversation-image.service";

const env = {} as any;
const bytes = new Uint8Array([1, 2, 3]).buffer;

beforeEach(async () => {
    vi.clearAllMocks();
    await Promise.all([
        "rec_message_1",
        "rec_message_2",
    ].map((recordId) => caches.default.delete(
        new Request(`https://conversation-image-cache.internal/${recordId}`)
    )));
    getConversationByRecordId.mockResolvedValue({
        record_id: "rec_message_1",
        fields: {
            [CONVERSATION_FIELDS.MESSAGE_TYPE]: "image",
            [CONVERSATION_FIELDS.CHANNEL]: "LINE",
            [CONVERSATION_FIELDS.IMAGE_ATTACHMENT]: [{ file_token: "file-token-1" }],
            [CONVERSATION_FIELDS.EXTERNAL_MESSAGE_ID]: "line-message-1",
        },
    });
});

describe("conversation image service", () => {
    it("downloads the permanent Lark attachment before using LINE fallback", async () => {
        downloadLarkMedia.mockResolvedValue({ bytes, mime_type: "image/png", size_bytes: 3 });

        await expect(getConversationImage(env, "rec_message_1")).resolves.toEqual({
            bytes,
            mime_type: "image/png",
        });
        expect(downloadLineMessageContent).not.toHaveBeenCalled();
    });

    it("falls back to LINE content when the Lark attachment is unavailable", async () => {
        downloadLarkMedia.mockRejectedValue(new Error("expired"));
        downloadLineMessageContent.mockResolvedValue({ bytes, mime_type: "image/jpeg" });

        await expect(getConversationImage(env, "rec_message_1")).resolves.toEqual({
            bytes,
            mime_type: "image/jpeg",
        });
        expect(downloadLineMessageContent).toHaveBeenCalledWith(env, "line-message-1");
    });

    it("uses Worker cache on repeated image requests", async () => {
        const recordId = `rec_cache_${Date.now()}`;
        getConversationByRecordId.mockResolvedValue({
            record_id: recordId,
            fields: {
                [CONVERSATION_FIELDS.MESSAGE_TYPE]: "image",
                [CONVERSATION_FIELDS.CHANNEL]: "LINE",
                [CONVERSATION_FIELDS.IMAGE_ATTACHMENT]: [{ file_token: "file-token-cache" }],
                [CONVERSATION_FIELDS.EXTERNAL_MESSAGE_ID]: "line-message-cache",
            },
        });
        downloadLarkMedia.mockResolvedValue({ bytes, mime_type: "image/png", size_bytes: 3 });

        await getConversationImage(env, recordId);
        await getConversationImage(env, recordId);

        expect(getConversationByRecordId).toHaveBeenCalledTimes(1);
        expect(downloadLarkMedia).toHaveBeenCalledTimes(1);
    });

    it("does not proxy non-image or non-LINE records", async () => {
        getConversationByRecordId.mockResolvedValue({
            record_id: "rec_message_2",
            fields: {
                [CONVERSATION_FIELDS.MESSAGE_TYPE]: "text",
                [CONVERSATION_FIELDS.CHANNEL]: "LINE",
            },
        });

        await expect(getConversationImage(env, "rec_message_2")).resolves.toBeNull();
        expect(downloadLarkMedia).not.toHaveBeenCalled();
    });
});
