import type { Env } from "../../config/env";
import { documentLinkSecret } from "../../modules/documents/document-link.service";
import { verifyDocumentLink } from "../../modules/documents/document.signature";
import type { DocumentType } from "../../modules/documents/document.types";
import { jsonResponse } from "../../utils/response";
import {
    isDocumentAdmin,
    renderOrderDocument,
} from "./document-route.shared";

export async function handleDocumentViewRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    const adminMatch = pathname.match(
        /^\/admin\/documents\/order\/([^/]+)\/(quotation|invoice|tax-invoice)$/
    );

    if (adminMatch) {
        if (request.method !== "GET") {
            return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
        }

        if (!isDocumentAdmin(request, env)) {
            return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 401);
        }

        return renderOrderDocument(
            env,
            decodeURIComponent(adminMatch[1]),
            adminMatch[2] as DocumentType
        );
    }

    const publicMatch = pathname.match(
        /^\/documents\/order\/([^/]+)\/(quotation|invoice|tax-invoice)$/
    );

    if (!publicMatch) {
        return null;
    }

    if (request.method !== "GET") {
        return jsonResponse({ ok: false, message: "Method not allowed" }, 405);
    }

    const secret = documentLinkSecret(env);
    const url = new URL(request.url);
    const expiresAt = Number(url.searchParams.get("expires"));
    const signature = url.searchParams.get("signature") ?? "";
    const recordId = decodeURIComponent(publicMatch[1]);
    const type = publicMatch[2] as DocumentType;
    const valid =
        Boolean(secret) &&
        (await verifyDocumentLink(
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

    return renderOrderDocument(env, recordId, type);
}
