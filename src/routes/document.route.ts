import type { Env } from "../config/env";
import { buildOrderDocument } from "../modules/documents/document.service";
import { renderDocumentHtml } from "../modules/documents/document-html";
import { verifyDocumentLink } from "../modules/documents/document.signature";
import {
    createSignedDocumentLink,
    documentLinkSecret,
    documentWorkflowToken,
    generateAndSaveDocumentLink,
} from "../modules/documents/document-link.service";
import type { DocumentType } from "../modules/documents/document.types";
import { renderTaxFormHtml, renderTaxFormSuccessHtml } from "../modules/documents/tax-form-html";
import {
    createAndSaveTaxFormLink,
    getTaxFormViewModel,
    saveTaxFormSubmission,
    validateTaxFormSubmission,
} from "../modules/documents/tax-form.service";
import { verifyTaxFormLink } from "../modules/documents/tax-form.signature";
import { jsonResponse } from "../utils/response";

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

function isAdmin(request: Request, env: Env): boolean {
    const configured = env.NOTIFICATION_DISPATCH_TOKEN?.trim() ?? "";
    return Boolean(configured) && bearerToken(request) === configured;
}

function isDocumentWorkflowAuthorized(request: Request, env: Env): boolean {
    const configured = documentWorkflowToken(env);
    const provided =
        bearerToken(request) ||
        request.headers.get("X-Document-Workflow-Token")?.trim() ||
        "";

    return Boolean(configured) && provided === configured;
}


function documentType(value: string): DocumentType | null {
    return DOCUMENT_TYPES.has(value as DocumentType)
        ? (value as DocumentType)
        : null;
}

function htmlResponse(html: string): Response {
    return new Response(html, {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "private, no-store, max-age=0",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    });
}

function documentErrorResponse(error: unknown): Response {
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

async function render(
    env: Env,
    recordId: string,
    type: DocumentType
): Promise<Response> {
    try {
        const model = await buildOrderDocument(env, recordId, type);
        return htmlResponse(renderDocumentHtml(model));
    } catch (error) {
        return documentErrorResponse(error);
    }
}

export async function handleDocumentRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname === "/admin/documents/link") {
        if (request.method !== "POST") {
            return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
        }

        if (!isAdmin(request, env)) {
            return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
        }

        const secret = documentLinkSecret(env);
        if (!secret) {
            return jsonResponse(
                {
                    ok: false,
                    code: "DOCUMENT_LINK_SECRET_MISSING",
                    message: "ยังไม่ได้ตั้ง DOCUMENT_LINK_SECRET",
                },
                503
            );
        }

        const body = (await request.json()) as {
            order_record_id?: string;
            document_type?: string;
            expires_minutes?: number;
        };
        const recordId = body.order_record_id?.trim() ?? "";
        const type = documentType(body.document_type?.trim() ?? "");

        if (!recordId || !type) {
            return jsonResponse(
                {
                    ok: false,
                    code: "INVALID_DOCUMENT_REQUEST",
                    message:
                        "ต้องมี order_record_id และ document_type: quotation, invoice หรือ tax-invoice",
                },
                400
            );
        }

        try {
            const generated = await createSignedDocumentLink({
                env,
                requestUrl: request.url,
                orderRecordId: recordId,
                documentType: type,
                expiresMinutes: body.expires_minutes,
                validateDocument: true,
            });

            return jsonResponse({ ok: true, ...generated });
        } catch (error) {
            return documentErrorResponse(error);
        }
    }

    if (
        pathname === "/webhooks/lark/document-generate" ||
        pathname === "/admin/documents/generate-and-save"
    ) {
        if (request.method !== "POST") {
            return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
        }

        if (!isDocumentWorkflowAuthorized(request, env)) {
            return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
        }

        const body = (await request.json()) as {
            order_record_id?: string;
            document_type?: string;
            expires_minutes?: number;
        };
        const recordId = body.order_record_id?.trim() ?? "";
        const type = documentType(body.document_type?.trim() ?? "");

        if (!recordId || !type) {
            return jsonResponse(
                {
                    ok: false,
                    code: "INVALID_DOCUMENT_REQUEST",
                    message:
                        "ต้องมี order_record_id และ document_type: quotation, invoice หรือ tax-invoice",
                },
                400
            );
        }

        try {
            const generated = await generateAndSaveDocumentLink({
                env,
                requestUrl: request.url,
                orderRecordId: recordId,
                documentType: type,
                expiresMinutes: body.expires_minutes ?? 1440,
            });

            return jsonResponse({
                ok: true,
                saved_to_order: true,
                ...generated,
            });
        } catch (error) {
            return documentErrorResponse(error);
        }
    }

    if (
        pathname === "/webhooks/lark/tax-form-generate" ||
        pathname === "/admin/documents/tax-form-link"
    ) {
        if (request.method !== "POST") {
            return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
        }

        if (!isDocumentWorkflowAuthorized(request, env)) {
            return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
        }

        const body = (await request.json()) as {
            order_record_id?: string;
            expires_minutes?: number;
        };
        const recordId = body.order_record_id?.trim() ?? "";
        if (!recordId) {
            return jsonResponse(
                {
                    ok: false,
                    code: "INVALID_TAX_FORM_REQUEST",
                    message: "ต้องมี order_record_id",
                },
                400
            );
        }

        try {
            const generated = await createAndSaveTaxFormLink({
                env,
                requestUrl: request.url,
                orderRecordId: recordId,
                expiresMinutes: body.expires_minutes,
            });

            return jsonResponse({
                ok: true,
                saved_to_order: true,
                ...generated,
            });
        } catch (error) {
            return documentErrorResponse(error);
        }
    }

    const taxFormMatch = pathname.match(
        /^\/forms\/tax\/order\/([^/]+)$/
    );

    if (taxFormMatch) {
        const secret = documentLinkSecret(env);
        const url = new URL(request.url);
        const expiresAt = Number(url.searchParams.get("expires"));
        const signature = url.searchParams.get("signature") ?? "";
        const recordId = decodeURIComponent(taxFormMatch[1]);
        const valid = Boolean(secret) && (await verifyTaxFormLink(
            secret,
            recordId,
            expiresAt,
            signature
        ));

        if (!valid) {
            return jsonResponse(
                {
                    ok: false,
                    code: "TAX_FORM_LINK_INVALID_OR_EXPIRED",
                    message: "ลิงก์แบบฟอร์มไม่ถูกต้องหรือหมดอายุแล้ว",
                },
                401
            );
        }

        try {
            const model = await getTaxFormViewModel(env, recordId);
            if (request.method === "GET") {
                return htmlResponse(
                    renderTaxFormHtml({ model, actionUrl: request.url })
                );
            }

            if (request.method !== "POST") {
                return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
            }

            const formData = await request.formData();
            const raw = Object.fromEntries(formData.entries());
            try {
                const submission = validateTaxFormSubmission(raw);
                await saveTaxFormSubmission(env, recordId, submission);
                return htmlResponse(renderTaxFormSuccessHtml(model, submission));
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const friendly = message === "TAX_ID_INVALID"
                    ? "เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก"
                    : "กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ และยืนยันความถูกต้อง";
                return new Response(
                    renderTaxFormHtml({
                        model: {
                            ...model,
                            tax_name: String(raw.tax_name ?? ""),
                            tax_address: String(raw.tax_address ?? ""),
                            tax_id: String(raw.tax_id ?? ""),
                            tax_branch: String(raw.tax_branch ?? ""),
                        },
                        actionUrl: request.url,
                        errorMessage: friendly,
                    }),
                    {
                        status: 422,
                        headers: {
                            "Content-Type": "text/html; charset=utf-8",
                            "Cache-Control": "private, no-store, max-age=0",
                            "X-Content-Type-Options": "nosniff",
                            "Referrer-Policy": "no-referrer",
                        },
                    }
                );
            }
        } catch (error) {
            return documentErrorResponse(error);
        }
    }

    const adminMatch = pathname.match(
        /^\/admin\/documents\/order\/([^/]+)\/(quotation|invoice|tax-invoice)$/
    );

    if (adminMatch) {
        if (request.method !== "GET") {
            return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
        }
        if (!isAdmin(request, env)) {
            return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
        }
        return await render(env, decodeURIComponent(adminMatch[1]), adminMatch[2] as DocumentType);
    }

    const publicMatch = pathname.match(
        /^\/documents\/order\/([^/]+)\/(quotation|invoice|tax-invoice)$/
    );

    if (publicMatch) {
        if (request.method !== "GET") {
            return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
        }

        const secret = documentLinkSecret(env);
        const url = new URL(request.url);
        const expiresAt = Number(url.searchParams.get("expires"));
        const signature = url.searchParams.get("signature") ?? "";
        const recordId = decodeURIComponent(publicMatch[1]);
        const type = publicMatch[2] as DocumentType;
        const valid = Boolean(secret) && (await verifyDocumentLink(
            secret,
            recordId,
            type,
            expiresAt,
            signature
        ));

        if (!valid) {
            return jsonResponse(
                {
                    ok: false,
                    code: "DOCUMENT_LINK_INVALID_OR_EXPIRED",
                    message: "ลิงก์เอกสารไม่ถูกต้องหรือหมดอายุแล้ว",
                },
                401
            );
        }

        return await render(env, recordId, type);
    }

    return null;
}
