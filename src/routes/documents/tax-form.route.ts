import type { Env } from "../../config/env";
import { documentLinkSecret } from "../../modules/documents/document-link.service";
import {
    renderTaxFormHtml,
    renderTaxFormSuccessHtml,
} from "../../modules/documents/tax-form-html";
import {
    createAndSaveTaxFormLink,
    getTaxFormViewModel,
    saveTaxFormSubmission,
    validateTaxFormSubmission,
} from "../../modules/documents/tax-form.service";
import { verifyTaxFormLink } from "../../modules/documents/tax-form.signature";
import { jsonResponse } from "../../utils/response";
import {
    documentErrorResponse,
    isDocumentWorkflowAuthorized,
    secureHtmlResponse,
} from "./document-route.shared";

export async function handleTaxFormRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
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

    const taxFormMatch = pathname.match(/^\/forms\/tax\/order\/([^/]+)$/);

    if (!taxFormMatch) {
        return null;
    }

    const secret = documentLinkSecret(env);
    const url = new URL(request.url);
    const expiresAt = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature") ?? "";
    const recordId = decodeURIComponent(taxFormMatch[1]);
    const valid =
        Boolean(secret) &&
        (await verifyTaxFormLink(secret, recordId, expiresAt, signature));

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
            return secureHtmlResponse(
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
            return secureHtmlResponse(
                renderTaxFormSuccessHtml(model, submission)
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const friendly =
                message === "TAX_ID_INVALID"
                    ? "เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก"
                    : "กรุณากรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ และยืนยันความถูกต้อง";

            return secureHtmlResponse(
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
                422
            );
        }
    } catch (error) {
        return documentErrorResponse(error);
    }
}
