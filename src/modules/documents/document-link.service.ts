import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { updateLarkRecord } from "../../providers/lark/lark.provider";
import { buildOrderDocument } from "./document.service";
import { signDocumentLink } from "./document.signature";
import type { DocumentType } from "./document.types";

const DOCUMENT_FIELD_NAMES: Record<DocumentType, string> = {
    quotation: ORDER_FIELDS.QUOTATION_URL,
    invoice: ORDER_FIELDS.INVOICE_URL,
    "tax-invoice": ORDER_FIELDS.TAX_INVOICE_URL,
};

const DOCUMENT_LINK_LABELS: Record<DocumentType, string> = {
    quotation: "เปิดใบเสนอราคา",
    invoice: "เปิดใบแจ้งหนี้",
    "tax-invoice": "เปิดใบกำกับภาษี",
};

export type GeneratedDocumentLink = {
    order_record_id: string;
    document_type: DocumentType;
    field_name: string;
    expires_at: number;
    url: string;
};

export function documentLinkSecret(env: Env): string {
    return (
        env.DOCUMENT_LINK_SECRET?.trim() ||
        env.NOTIFICATION_DISPATCH_TOKEN?.trim() ||
        ""
    );
}

export function documentWorkflowToken(env: Env): string {
    return (
        env.DOCUMENT_WORKFLOW_TOKEN?.trim() ||
        env.NOTIFICATION_DISPATCH_TOKEN?.trim() ||
        ""
    );
}

export function documentUrlFieldName(type: DocumentType): string {
    return DOCUMENT_FIELD_NAMES[type];
}

export function toLarkHyperlinkValue(type: DocumentType, url: string): {
    text: string;
    link: string;
} {
    return {
        text: DOCUMENT_LINK_LABELS[type],
        link: url,
    };
}

export async function createSignedDocumentLink(input: {
    env: Env;
    requestUrl: string;
    orderRecordId: string;
    documentType: DocumentType;
    expiresMinutes?: number;
    validateDocument?: boolean;
}): Promise<GeneratedDocumentLink> {
    const secret = documentLinkSecret(input.env);

    if (!secret) {
        throw new Error("DOCUMENT_LINK_SECRET_MISSING");
    }

    if (input.validateDocument !== false) {
        await buildOrderDocument(
            input.env,
            input.orderRecordId,
            input.documentType
        );
    }

    const minutes = Math.min(
        1440,
        Math.max(1, Math.round(Number(input.expiresMinutes) || 60))
    );
    const expiresAt = Date.now() + minutes * 60_000;
    const signature = await signDocumentLink(
        secret,
        input.orderRecordId,
        input.documentType,
        expiresAt
    );
    const url = new URL(input.requestUrl);
    url.pathname = `/documents/order/${encodeURIComponent(
        input.orderRecordId
    )}/${input.documentType}`;
    url.search = "";
    url.searchParams.set("expires", String(expiresAt));
    url.searchParams.set("signature", signature);

    return {
        order_record_id: input.orderRecordId,
        document_type: input.documentType,
        field_name: documentUrlFieldName(input.documentType),
        expires_at: expiresAt,
        url: url.toString(),
    };
}

export async function saveDocumentLinkToOrder(
    env: Env,
    generated: GeneratedDocumentLink
): Promise<void> {
    await updateLarkRecord(
        env,
        env.ORDERS_TABLE_ID,
        generated.order_record_id,
        {
            [generated.field_name]: toLarkHyperlinkValue(
                generated.document_type,
                generated.url
            ),
            [ORDER_FIELDS.UPDATED_AT]: Date.now(),
        }
    );
}

export async function generateAndSaveDocumentLink(input: {
    env: Env;
    requestUrl: string;
    orderRecordId: string;
    documentType: DocumentType;
    expiresMinutes?: number;
}): Promise<GeneratedDocumentLink> {
    const generated = await createSignedDocumentLink({
        env: input.env,
        requestUrl: input.requestUrl,
        orderRecordId: input.orderRecordId,
        documentType: input.documentType,
        expiresMinutes: input.expiresMinutes,
        validateDocument: true,
    });

    await saveDocumentLinkToOrder(input.env, generated);
    return generated;
}
