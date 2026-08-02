import type { Env } from "../../config/env";
import { AuthError, isAuthError } from "../../modules/auth/auth.error";
import {
    verifyPcWorkflowActionToken,
    type PcWorkflowAction,
} from "../../modules/production-control/pc.action-token";
import { refreshPcDerivedState } from "../../modules/production-control/pc.derived-state";
import { markPcProductionBlocked } from "../../modules/production-control/pc.service";
import { runPcWorkflowAction } from "../../modules/production-control/pc.workflow.service";
import { OperationalError } from "../../utils/errors";
import { assertDashboardSession } from "../shared/dashboard-api";

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function htmlResponse(
    title: string,
    body: string,
    status = 200,
    script = ""
): Response {
    const nonce = crypto.randomUUID().replace(/-/g, "");
    const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style nonce="${nonce}">
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Noto Sans Thai", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f7f3ed; color: #1c1917; }
    main { width: min(560px, 100%); padding: 30px; border: 1px solid rgba(28,25,23,.12); border-radius: 24px; background: #fff; box-shadow: 0 22px 60px rgba(47,38,28,.12); }
    h1 { margin: 0 0 12px; font-size: 25px; }
    p { color: #625b54; line-height: 1.7; }
    .status { margin: 18px 0; padding: 16px; border-radius: 16px; background: #f4efe8; line-height: 1.7; }
    a { display: inline-flex; justify-content: center; align-items: center; min-height: 44px; padding: 0 18px; border: 1px solid rgba(28,25,23,.16); border-radius: 999px; color: #1c1917; font: inherit; font-weight: 700; text-decoration: none; }
    ul { padding-left: 20px; color: #625b54; line-height: 1.7; }
  </style>
</head>
<body>
  <main>${body}</main>
  ${script ? `<script nonce="${nonce}">${script}</script>` : ""}
</body>
</html>`;

    return new Response(html, {
        status,
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": [
                "default-src 'none'",
                `style-src 'nonce-${nonce}'`,
                `script-src 'nonce-${nonce}'`,
                "form-action 'self'",
                "base-uri 'none'",
                "frame-ancestors 'self'",
            ].join("; "),
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "SAMEORIGIN",
        },
    });
}

function actionLabel(action: PcWorkflowAction): string {
    if (action === "approve-production") return "อนุมัติผลิตสินค้า";
    if (action === "purchase-materials") return "อนุมัติสั่งซื้อวัตถุดิบ";
    return "ยืนยันผลิตเสร็จและรับสินค้าเข้าสต็อก";
}

function requestReturnPath(request: Request): string {
    const url = new URL(request.url);
    return `${url.pathname}${url.search}`;
}

function loginRedirect(request: Request): Response {
    const url = new URL("/auth/lark/login", request.url);
    url.searchParams.set("return_to", requestReturnPath(request));
    return new Response(null, {
        status: 302,
        headers: {
            Location: url.toString(),
            "Cache-Control": "no-store",
        },
    });
}

async function requireOperator(request: Request, env: Env) {
    const session = await assertDashboardSession(request, env);
    if (session.user.role !== "admin" && session.user.role !== "manager") {
        throw new AuthError(
            "PC_PERMISSION_DENIED",
            "บัญชีนี้ไม่มีสิทธิ์อนุมัติการผลิตหรือสต็อก",
            403
        );
    }
    return session;
}

function hasSameOriginUrl(value: string, requestOrigin: string): boolean {
    try {
        return new URL(value).origin === requestOrigin;
    } catch {
        return false;
    }
}

/**
 * Browser บางตัวไม่ส่ง Origin มากับ same-origin form POST หลังเปิดจาก Lark
 * จึงยอมรับหลักฐานจาก Origin, Referer หรือ Sec-Fetch-Site ตามลำดับ
 * โดยยังปฏิเสธ cross-site และ request ที่ไม่มีหลักฐาน same-origin แบบ fail-closed
 */
function assertSameOriginPost(request: Request): void {
    const requestOrigin = new URL(request.url).origin;
    const origin = request.headers.get("Origin")?.trim() ?? "";

    if (origin && origin !== "null") {
        if (origin === requestOrigin) return;
        throw new AuthError(
            "PC_ACTION_ORIGIN_FORBIDDEN",
            "คำขออนุมัติต้องมาจากหน้าระบบเดียวกัน",
            403
        );
    }

    const referer = request.headers.get("Referer")?.trim() ?? "";
    if (referer && hasSameOriginUrl(referer, requestOrigin)) {
        return;
    }

    const fetchSite =
        request.headers.get("Sec-Fetch-Site")?.trim().toLowerCase() ?? "";
    if (fetchSite === "same-origin") {
        return;
    }

    throw new AuthError(
        "PC_ACTION_ORIGIN_FORBIDDEN",
        "คำขออนุมัติต้องมาจากหน้าระบบเดียวกัน",
        403
    );
}

function errorResponse(error: unknown): Response {
    const status =
        isAuthError(error) || error instanceof OperationalError
            ? error.status ?? 500
            : 500;
    const message =
        status >= 500
            ? "ระบบไม่สามารถดำเนินการได้ในขณะนี้ กรุณาลองใหม่"
            : error instanceof Error
              ? error.message
              : String(error);

    return htmlResponse(
        "ดำเนินการไม่สำเร็จ",
        [
            "<h1>ดำเนินการไม่สำเร็จ</h1>",
            `<div class="status">${escapeHtml(message)}</div>`,
            '<a href="/demo-shop">กลับไป Demo Shop</a>',
        ].join(""),
        status
    );
}

function isCompletionMaterialShortage(
    action: PcWorkflowAction,
    error: unknown
): error is OperationalError {
    return (
        action === "complete-production" &&
        error instanceof OperationalError &&
        error.code === "PC_PRODUCTION_MATERIAL_INSUFFICIENT"
    );
}

async function handleCompletionMaterialShortage(input: {
    env: Env;
    production_record_id: string;
    error: OperationalError;
}): Promise<Response> {
    // คำนวณ Material Plan และ Reconcile สถานะอนุพันธ์ก่อนสร้าง Card
    // เพื่อให้ Dashboard, Product และ Production อ่านเหตุการณ์เดียวกัน
    await refreshPcDerivedState(input.env);
    await markPcProductionBlocked(input.env, {
        production_record_id: input.production_record_id,
        code: input.error.code,
        message: input.error.message,
    });

    return htmlResponse(
        "รอวัตถุดิบ",
        [
            "<h1>ยังรับสินค้าเข้าสต็อกไม่ได้</h1>",
            `<div class="status">${escapeHtml(input.error.message)}</div>`,
            "<p>ระบบเปลี่ยนแผนเป็นรอวัตถุดิบ อัปเดต Dashboard และส่งแจ้งเตือนไปยังกลุ่ม Lark เพื่ออนุมัติสั่งซื้อแล้ว</p>",
            "<p>Stock สินค้าสำเร็จรูปยังไม่เพิ่ม และวัตถุดิบยังไม่ถูกหัก</p>",
            '<a href="/demo-shop">กลับไป Demo Shop</a>',
        ].join("")
    );
}

export async function handlePcWorkflowActionPage(
    request: Request,
    env: Env,
    productionRecordId: string,
    action: PcWorkflowAction
): Promise<Response> {
    const recordId = decodeURIComponent(productionRecordId).trim();
    const token = new URL(request.url).searchParams.get("token") ?? "";

    try {
        await verifyPcWorkflowActionToken(env, token, {
            action,
            production_record_id: recordId,
        });
    } catch (error) {
        return errorResponse(error);
    }

    if (request.method === "GET") {
        try {
            await requireOperator(request, env);
        } catch (error) {
            if (isAuthError(error) && error.status === 401) {
                return loginRedirect(request);
            }
            return errorResponse(error);
        }

        const label = actionLabel(action);
        return htmlResponse(
            label,
            [
                `<h1>${escapeHtml(label)}</h1>`,
                "<p>ระบบตรวจสอบสิทธิ์แล้ว และจะดำเนินการให้อัตโนมัติเพียงครั้งเดียว</p>",
                '<div class="status" id="action-status">กำลังดำเนินการ กรุณาอย่าปิดหรือรีเฟรชหน้านี้…</div>',
                `<form id="action-form" method="post" action="${escapeHtml(requestReturnPath(request))}" hidden></form>`,
                "<noscript><p>กรุณาเปิด JavaScript แล้วเปิดคำสั่งจาก Lark ใหม่อีกครั้ง</p></noscript>",
            ].join(""),
            200,
            `window.setTimeout(() => {
  const form = document.getElementById("action-form");
  const status = document.getElementById("action-status");
  if (window.__pcActionSubmitted === true) return;
  window.__pcActionSubmitted = true;
  if (form instanceof HTMLFormElement) {
    if (status) status.textContent = "กำลังบันทึกผล กรุณาอย่าปิดหรือรีเฟรชหน้านี้";
    form.requestSubmit();
  }
}, 350);`
        );
    }

    if (request.method !== "POST") {
        return new Response("Method not allowed", {
            status: 405,
            headers: { Allow: "GET, POST" },
        });
    }

    try {
        assertSameOriginPost(request);
        const session = await requireOperator(request, env);
        if (action === "approve-production") {
            // คำนวณ Material Plan ด้วย Business key กลางและซ่อมสถานะเก่าก่อนอนุมัติ
            // เพื่อให้ Dashboard, Product และ Production ตรงกันก่อนส่ง Card
            await refreshPcDerivedState(env);
        }
        const result = await runPcWorkflowAction(env, {
            action,
            production_record_id: recordId,
            actor_name: session.user.name,
        });
        const replenishment = result.materials_replenished.length
            ? `<ul>${result.materials_replenished
                  .map(
                      (item) =>
                          `<li>${escapeHtml(item.material_sku)} เพิ่ม ${escapeHtml(String(item.added_qty))} ${escapeHtml(item.unit)} — คงเหลือ ${escapeHtml(String(item.stock_after))}</li>`
                  )
                  .join("")}</ul>`
            : "";
        const productStock =
            result.product_stock_on_hand === undefined
                ? ""
                : `<p><strong>Stock สินค้าปัจจุบัน:</strong> ${escapeHtml(String(result.product_stock_on_hand))} ชิ้น</p>`;

        return htmlResponse(
            "ดำเนินการสำเร็จ",
            [
                "<h1>ดำเนินการสำเร็จ</h1>",
                `<div class="status">${escapeHtml(result.message)}</div>`,
                `<p><strong>แผนผลิต:</strong> ${escapeHtml(result.production_id)}</p>`,
                `<p><strong>สถานะ:</strong> ${escapeHtml(result.production_status)}</p>`,
                productStock,
                replenishment,
                '<a href="/demo-shop">กลับไป Demo Shop</a>',
            ].join("")
        );
    } catch (error) {
        if (isAuthError(error) && error.status === 401) {
            return loginRedirect(request);
        }
        if (isCompletionMaterialShortage(action, error)) {
            try {
                return await handleCompletionMaterialShortage({
                    env,
                    production_record_id: recordId,
                    error,
                });
            } catch (markError) {
                console.error("PC_COMPLETION_SHORTAGE_ALERT_FAILED", {
                    production_record_id: recordId,
                    error:
                        markError instanceof Error
                            ? markError.message
                            : String(markError),
                });
            }
        }
        return errorResponse(error);
    }
}
