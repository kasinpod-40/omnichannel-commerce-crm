import type { Env } from "../../config/env";
import {
    createSignedDocumentLink,
    documentLinkSecret,
    generateAndSaveDocumentLink,
} from "../../modules/documents/document-link.service";
import { jsonResponse } from "../../utils/response";
import {
    documentErrorResponse,
    isDocumentAdmin,
    isDocumentWorkflowAuthorized,
    parseDocumentType,
} from "./document-route.shared";

export async function handleDocumentLinkRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname === "/admin/documents/link") {
        if (request.method !== "POST") {
            return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
        }

        if (!isDocumentAdmin(request, env)) {
            return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
        }

        if (!documentLinkSecret(env)) {
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
        const type = parseDocumentType(body.document_type?.trim() ?? "");

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
        const type = parseDocumentType(body.document_type?.trim() ?? "");

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

    return null;
}
