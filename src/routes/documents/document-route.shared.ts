import type { Env } from "../../config/env";
import { renderDocumentHtml } from "../../modules/documents/document-html";
import {
    documentWorkflowToken,
} from "../../modules/documents/document-link.service";
import { buildOrderDocument } from "../../modules/documents/document.service";
import type { DocumentType } from "../../modules/documents/document.types";
import { jsonResponse } from "../../utils/response";

const DOCUMENT_TYPES = new Set<DocumentType>([
    "quotation",
    "invoice",
    "tax-invoice",
]);

function bearerToken(request: Request): string {
    const authorization = request.headers.get("Authorization") ?? "";
    return /^Bearer\s+/i.test(authorization)
        ? authorization.replace(/^Bearer\s+/i, "").trim()
        : request.headers.get("X-Admin-Token")?.trim() ?? "";
}

export function isDocumentAdmin(request: Request, env: Env): boolean {
    const configured = env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "";
    return Boolean(configured) && bearerToken(request) === configured;
}

export function isDocumentWorkflowAuthorized(
    request: Request,
    env: Env
): boolean {
    const configured = documentWorkflowToken(env);
    const provided =
        bearerToken(request) ||
        request.headers.get("X-Document-Workflow-Token")?.trim() ||
        "";

    return Boolean(configured) && provided === configured;
}

export function parseDocumentType(value: string): DocumentType | null {
    return DOCUMENT_TYPES.has(value as DocumentType)
        ? (value as DocumentType)
        : null;
}

export function secureHtmlResponse(
    html: string,
    status = 200
): Response {
    return new Response(html, {
        status,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    });
}

export function documentErrorResponse(error: unknown): Response {
    const message = error instanceof Error ? error.message : String(error);

    if (message === "ORDER_NOT_FOUND") {
        return jsonResponse(
            { ok: false, code: "ORDER_NOT_FOUND", message: "ไม่พบ Order" },
            404
        );
    }

    if (message === "DOCUMENT_LINK_SECRET_MISSING") {
        return jsonResponse(
            {
                ok: false,
                code: "DOCUMENT_LINK_SECRET_MISSING",
                message: "ยังไม่ได้ตั้ง DOCUMENT_LINK_SECRET",
            },
            503
        );
    }

    if (message.startsWith("TAX_DATA_INCOMPLETE:")) {
        return jsonResponse(
            {
                ok: false,
                code: "TAX_DATA_INCOMPLETE",
                message: "ข้อมูลสำหรับใบกำกับภาษียังไม่ครบ",
                missing: message
                    .slice("TAX_DATA_INCOMPLETE:".length)
                    .split(","),
            },
            422
        );
    }

    if (message.startsWith("TAX_FORM_INCOMPLETE:")) {
        return jsonResponse(
            {
                ok: false,
                code: "TAX_FORM_INCOMPLETE",
                message: "กรอกข้อมูลสำหรับใบกำกับภาษียังไม่ครบ",
                missing: message
                    .slice("TAX_FORM_INCOMPLETE:".length)
                    .split(","),
            },
            422
        );
    }

    if (message === "TAX_ID_INVALID") {
        return jsonResponse(
            {
                ok: false,
                code: "TAX_ID_INVALID",
                message: "เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก",
            },
            422
        );
    }

    if (message === "TAX_FIELDS_MISSING") {
        return jsonResponse(
            {
                ok: false,
                code: "TAX_FIELDS_MISSING",
                message: "Orders ต้องมี tax_name, tax_address, tax_id และ tax_branch",
            },
            422
        );
    }

    if (message === "TAX_FORM_URL_FIELD_MISSING") {
        return jsonResponse(
            {
                ok: false,
                code: "TAX_FORM_URL_FIELD_MISSING",
                message: "ยังไม่มี Field tax_form_url ใน Orders",
            },
            422
        );
    }

    if (message === "TAX_FORM_URL_FIELD_INVALID") {
        return jsonResponse(
            {
                ok: false,
                code: "TAX_FORM_URL_FIELD_INVALID",
                message: "Field tax_form_url ต้องเป็นประเภท URL/Hyperlink",
            },
            422
        );
    }

    if (message.includes("FieldNameNotFound")) {
        return jsonResponse(
            {
                ok: false,
                code: "DOCUMENT_URL_FIELD_MISSING",
                message:
                    "ยังไม่มี Field URL เอกสารใน Orders โปรดเพิ่ม quotation_url, invoice_url และ tax_invoice_url",
            },
            422
        );
    }

    if (message.includes("URLFieldConvFail")) {
        return jsonResponse(
            {
                ok: false,
                code: "DOCUMENT_URL_FIELD_INVALID",
                message:
                    "Field quotation_url, invoice_url และ tax_invoice_url ต้องเป็นประเภท URL/Hyperlink",
            },
            422
        );
    }

    throw error;
}

export async function renderOrderDocument(
    env: Env,
    recordId: string,
    type: DocumentType
): Promise<Response> {
    try {
        const model = await buildOrderDocument(env, recordId, type);
        return secureHtmlResponse(renderDocumentHtml(model));
    } catch (error) {
        return documentErrorResponse(error);
    }
}
