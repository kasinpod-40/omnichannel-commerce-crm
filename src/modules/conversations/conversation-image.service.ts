import type { Env } from "../../config/env";
import { CONVERSATION_FIELDS } from "../../core/lark-fields";
import { downloadLarkMedia } from "../../providers/lark/lark-attachment.provider";
import { downloadLineMessageContent } from "../../providers/line/line.provider";
import { getLarkAttachmentTokens, getLarkText } from "../../utils/lark-field-value";
import { normalizeChannel } from "../dashboard-read/dashboard-read.shared";
import { getConversationByRecordId } from "./conversation.repository";

export type ConversationImage = {
    bytes: ArrayBuffer;
    mime_type: string;
};

const IMAGE_CACHE_TTL_SECONDS = 5 * 60;
const CACHE_ORIGIN = "https://conversation-image-cache.internal";

function cacheRequest(messageRecordId: string): Request {
    return new Request(`${CACHE_ORIGIN}/${encodeURIComponent(messageRecordId)}`, {
        method: "GET",
    });
}

async function readCachedImage(messageRecordId: string): Promise<ConversationImage | null> {
    if (typeof caches === "undefined") return null;
    const response = await caches.default.match(cacheRequest(messageRecordId));
    if (!response) return null;
    const mimeType = response.headers.get("content-type") ?? "";
    if (!mimeType.startsWith("image/")) return null;
    return { bytes: await response.arrayBuffer(), mime_type: mimeType };
}

async function cacheImage(messageRecordId: string, image: ConversationImage): Promise<void> {
    if (typeof caches === "undefined") return;
    const response = new Response(image.bytes.slice(0), {
        headers: {
            "Content-Type": image.mime_type,
            "Cache-Control": `public, max-age=${IMAGE_CACHE_TTL_SECONDS}`,
            "X-Content-Type-Options": "nosniff",
        },
    });
    await caches.default.put(cacheRequest(messageRecordId), response);
}

/**
 * โหลดรูปจาก Lark attachment ก่อน เพราะเป็นสำเนาถาวรที่ระบบบันทึกไว้ตอนรับ LINE webhook
 * หากข้อมูลเก่าไม่มี attachment จึงค่อย fallback ไปยัง LINE message content ด้วย message_id เดิม
 * ผลลัพธ์ถูก Cache ใน Worker หลัง Route ตรวจ Session แล้ว เพื่อลดการดาวน์โหลดซ้ำจาก Lark/LINE
 */
export async function getConversationImage(
    env: Env,
    messageRecordId: string
): Promise<ConversationImage | null> {
    const cached = await readCachedImage(messageRecordId);
    if (cached) return cached;

    const record = await getConversationByRecordId(env, messageRecordId);
    if (!record) return null;

    const messageType = getLarkText(
        record.fields[CONVERSATION_FIELDS.MESSAGE_TYPE],
        "text"
    ).trim().toLowerCase();
    const channel = normalizeChannel(record.fields[CONVERSATION_FIELDS.CHANNEL]);
    if (messageType !== "image" || channel !== "LINE") return null;

    const attachmentTokens = getLarkAttachmentTokens(
        record.fields[CONVERSATION_FIELDS.IMAGE_ATTACHMENT]
    );

    for (const fileToken of attachmentTokens) {
        try {
            const media = await downloadLarkMedia(env, fileToken);
            if (media.mime_type.startsWith("image/")) {
                const image = { bytes: media.bytes, mime_type: media.mime_type };
                await cacheImage(messageRecordId, image);
                return image;
            }
        } catch {
            // ลอง token ถัดไปหรือ fallback LINE สำหรับข้อมูลเก่าที่ attachment ใช้งานไม่ได้
        }
    }

    const externalMessageId = getLarkText(
        record.fields[CONVERSATION_FIELDS.EXTERNAL_MESSAGE_ID],
        ""
    ).trim();
    if (!externalMessageId) return null;

    const content = await downloadLineMessageContent(env, externalMessageId);
    if (!content.mime_type.startsWith("image/")) return null;

    const image = { bytes: content.bytes, mime_type: content.mime_type };
    await cacheImage(messageRecordId, image);
    return image;
}
