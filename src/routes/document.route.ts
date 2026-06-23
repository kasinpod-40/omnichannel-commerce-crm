import type { Env } from "../config/env";
import { buildOrderDocument } from "../modules/documents/document.service";
import { renderDocumentHtml } from "../modules/documents/document-html";
import {
    signDocumentLink,
    verifyDocumentLink,
} from "../modules/documents/document.signature";
import type { DocumentType } from "../modules/documents/document.types";
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

function linkSecret(env: Env): string {
    return (
        env.DOCUMENT_LINK_SECRET?.trim() ||
        env.NOTIFICATION_DISPATCH_TOKEN?.trim() ||
        ""
    );
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

async function render(
    env: Env,
    recordId: string,
    type: DocumentType
): Promise<Response> {
    try {
        const model = await buildOrderDocument(env, recordId, type);
        return htmlResponse(renderDocumentHtml(model));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message === "ORDER_NOT_FOUND") {
            return jsonResponse(
                { ok: false, code: "ORDER_NOT_FOUND", message: "ไม่พบ Order" },
                404
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

        throw error;
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

        const secret = linkSecret(env);
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

        const minutes = Math.min(
            1440,
            Math.max(1, Math.round(Number(body.expires_minutes) || 60))
        );
        const expiresAt = Date.now() + minutes * 60_000;
        const signature = await signDocumentLink(
            secret,
            recordId,
            type,
            expiresAt
        );
        const url = new URL(request.url);
        url.pathname = `/documents/order/${encodeURIComponent(recordId)}/${type}`;
        url.search = "";
        url.searchParams.set("expires", String(expiresAt));
        url.searchParams.set("signature", signature);

        return jsonResponse({
            ok: true,
            order_record_id: recordId,
            document_type: type,
            expires_at: expiresAt,
            url: url.toString(),
        });
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

        const secret = linkSecret(env);
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
