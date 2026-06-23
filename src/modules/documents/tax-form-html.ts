import type { TaxFormViewModel, TaxFormSubmission } from "./tax-form.service";

function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function layout(title: string, body: string): string {
    return `<!doctype html>
<html lang="th">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #f3f6fb; color: #172033; font-family: system-ui,-apple-system,"Noto Sans Thai",Tahoma,sans-serif; }
        main { width: min(680px, calc(100% - 28px)); margin: 28px auto; background: #fff; border-radius: 16px; padding: 28px; box-shadow: 0 12px 40px rgba(23,32,51,.12); }
        h1 { margin: 0 0 8px; color: #155eef; font-size: 26px; }
        p { margin: 0 0 18px; color: #667085; line-height: 1.55; }
        .meta { padding: 12px 14px; border-radius: 10px; background: #eef4ff; margin-bottom: 20px; font-size: 14px; }
        label { display: block; margin: 14px 0 6px; font-weight: 700; }
        input, textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 9px; padding: 11px 12px; font: inherit; color: inherit; background: #fff; }
        textarea { min-height: 110px; resize: vertical; }
        .consent { display: flex; gap: 10px; align-items: flex-start; margin: 18px 0; font-size: 13px; color: #475467; }
        .consent input { width: auto; margin-top: 3px; }
        button { width: 100%; border: 0; border-radius: 9px; padding: 12px 18px; background: #155eef; color: #fff; font: inherit; font-weight: 800; cursor: pointer; }
        .note { margin-top: 16px; font-size: 12px; color: #667085; }
        .success { text-align: center; padding: 28px 0; }
        .success .icon { font-size: 54px; }
        .error { padding: 12px 14px; border-radius: 9px; background: #fff1f2; color: #b42318; margin-bottom: 14px; }
    </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function renderTaxFormHtml(input: {
    model: TaxFormViewModel;
    actionUrl: string;
    errorMessage?: string;
}): string {
    const { model } = input;
    return layout(
        "ข้อมูลสำหรับออกใบกำกับภาษี",
        `${input.errorMessage ? `<div class="error">${escapeHtml(input.errorMessage)}</div>` : ""}
        <h1>ข้อมูลสำหรับออกใบกำกับภาษี</h1>
        <p>กรุณาตรวจสอบและกรอกข้อมูลให้ถูกต้อง ข้อมูลนี้จะใช้สำหรับออกเอกสารของคำสั่งซื้อรายการนี้เท่านั้น</p>
        <div class="meta"><strong>เลขที่คำสั่งซื้อ:</strong> ${escapeHtml(model.order_number)}<br><strong>ช่องทาง:</strong> ${escapeHtml(model.channel)}</div>
        <form method="post" action="${escapeHtml(input.actionUrl)}">
            <label for="tax_name">ชื่อบุคคล / ชื่อบริษัท *</label>
            <input id="tax_name" name="tax_name" maxlength="200" required value="${escapeHtml(model.tax_name)}" />

            <label for="tax_address">ที่อยู่สำหรับออกใบกำกับภาษี *</label>
            <textarea id="tax_address" name="tax_address" maxlength="2000" required>${escapeHtml(model.tax_address)}</textarea>

            <label for="tax_id">เลขประจำตัวผู้เสียภาษี 13 หลัก *</label>
            <input id="tax_id" name="tax_id" inputmode="numeric" pattern="[0-9]{13}" maxlength="13" required value="${escapeHtml(model.tax_id)}" />

            <label for="tax_branch">สาขา</label>
            <input id="tax_branch" name="tax_branch" maxlength="100" value="${escapeHtml(model.tax_branch)}" placeholder="สำนักงานใหญ่" />

            <label class="consent"><input type="checkbox" name="consent" value="accepted" required /><span>ข้าพเจ้ายืนยันว่าข้อมูลถูกต้อง และยินยอมให้ร้านค้านำข้อมูลนี้ไปใช้เพื่อจัดทำเอกสารภาษีสำหรับคำสั่งซื้อนี้</span></label>
            <button type="submit">บันทึกข้อมูล</button>
        </form>
        <div class="note">เพื่อความปลอดภัย ลิงก์นี้มีวันหมดอายุ และไม่ควรส่งต่อให้บุคคลอื่น</div>`
    );
}

export function renderTaxFormSuccessHtml(
    model: TaxFormViewModel,
    submission: TaxFormSubmission
): string {
    return layout(
        "บันทึกข้อมูลสำเร็จ",
        `<div class="success">
            <div class="icon">✅</div>
            <h1>บันทึกข้อมูลสำเร็จ</h1>
            <p>ระบบบันทึกข้อมูลสำหรับออกใบกำกับภาษีของคำสั่งซื้อ <strong>${escapeHtml(model.order_number)}</strong> เรียบร้อยแล้ว</p>
            <div class="meta"><strong>ชื่อ:</strong> ${escapeHtml(submission.tax_name)}<br><strong>เลขผู้เสียภาษี:</strong> ${escapeHtml(submission.tax_id)}<br><strong>สาขา:</strong> ${escapeHtml(submission.tax_branch)}</div>
            <p>สามารถปิดหน้านี้ได้</p>
        </div>`
    );
}
