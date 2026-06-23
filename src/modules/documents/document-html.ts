import type { DocumentViewModel } from "./document.types";

function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function money(value: number, currency: string): string {
    return new Intl.NumberFormat("th-TH", {
        style: "currency",
        currency: currency || "THB",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(value);
}

function thaiDate(value?: number): string {
    if (!value) {
        return "-";
    }

    return new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeZone: "Asia/Bangkok",
    }).format(new Date(value));
}

function optionalRow(label: string, value?: string): string {
    if (!value) {
        return "";
    }

    return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

export function renderDocumentHtml(model: DocumentViewModel): string {
    const currency = model.order.currency || "THB";
    const itemRows = model.items
        .map(
            (item, index) => `
                <tr>
                    <td class="center">${index + 1}</td>
                    <td>
                        <strong>${escapeHtml(item.name)}</strong>
                        ${item.variant ? `<small>${escapeHtml(item.variant)}</small>` : ""}
                        ${item.sku ? `<small>SKU: ${escapeHtml(item.sku)}</small>` : ""}
                    </td>
                    <td class="right">${escapeHtml(item.quantity)}</td>
                    <td class="right">${money(item.unit_price, currency)}</td>
                    <td class="right">${money(item.line_total, currency)}</td>
                </tr>`
        )
        .join("");

    const adjustmentRow =
        Math.abs(model.adjustment) >= 0.01
            ? `<tr><td colspan="4" class="right muted">ค่าจัดส่ง / ส่วนลด / ปรับยอด</td><td class="right">${money(model.adjustment, currency)}</td></tr>`
            : "";

    const taxRows =
        model.type === "tax-invoice"
            ? `
                <tr><td colspan="4" class="right">มูลค่าก่อนภาษี</td><td class="right">${money(model.taxable_amount ?? 0, currency)}</td></tr>
                <tr><td colspan="4" class="right">ภาษีมูลค่าเพิ่ม ${escapeHtml(model.vat_rate ?? 0)}%</td><td class="right">${money(model.vat_amount ?? 0, currency)}</td></tr>`
            : "";

    return `<!doctype html>
<html lang="th">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(model.title_th)} ${escapeHtml(model.document_number)}</title>
    <style>
        :root { color-scheme: light; }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            background: #eef2f7;
            color: #172033;
            font-family: system-ui, -apple-system, "Noto Sans Thai", Tahoma, sans-serif;
            line-height: 1.45;
        }
        .toolbar {
            position: sticky;
            top: 0;
            display: flex;
            justify-content: center;
            gap: 12px;
            padding: 12px;
            background: rgba(255,255,255,.95);
            border-bottom: 1px solid #d9e1ec;
            z-index: 10;
        }
        button {
            border: 0;
            border-radius: 8px;
            padding: 10px 18px;
            background: #155eef;
            color: white;
            font: inherit;
            font-weight: 700;
            cursor: pointer;
        }
        .page {
            width: 210mm;
            min-height: 297mm;
            margin: 18px auto;
            padding: 16mm;
            background: white;
            box-shadow: 0 8px 30px rgba(26, 38, 64, .13);
        }
        header {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 28px;
            align-items: start;
            border-bottom: 3px solid #155eef;
            padding-bottom: 18px;
        }
        .brand { display: flex; gap: 14px; align-items: flex-start; }
        .logo { width: 60px; height: 60px; object-fit: contain; }
        h1, h2, p { margin: 0; }
        .company-name { font-size: 20px; font-weight: 800; }
        .company-meta { margin-top: 5px; color: #4d5b73; font-size: 12px; white-space: pre-line; }
        .document-title { text-align: right; }
        .document-title h1 { color: #155eef; font-size: 28px; }
        .document-title p { color: #667085; font-weight: 700; letter-spacing: .08em; }
        .document-number { margin-top: 8px; font-size: 13px; font-weight: 800; }
        .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 18px;
            margin: 20px 0;
        }
        .card {
            border: 1px solid #d9e1ec;
            border-radius: 10px;
            padding: 14px;
        }
        .card h2 { font-size: 14px; margin-bottom: 8px; color: #155eef; }
        .card div { display: grid; grid-template-columns: 125px 1fr; gap: 8px; font-size: 12px; margin: 4px 0; }
        .card span { color: #667085; }
        .card strong { white-space: pre-line; overflow-wrap: anywhere; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { background: #eef4ff; color: #1849a9; }
        th, td { border: 1px solid #d9e1ec; padding: 10px 8px; vertical-align: top; }
        small { display: block; color: #667085; margin-top: 3px; }
        .right { text-align: right; }
        .center { text-align: center; }
        .muted { color: #667085; }
        .grand-total td { background: #155eef; color: white; font-size: 14px; font-weight: 800; }
        .note { margin-top: 16px; padding: 12px; border-radius: 8px; background: #f8fafc; font-size: 12px; white-space: pre-line; }
        footer { margin-top: 36px; display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
        .signature { text-align: center; padding-top: 48px; border-top: 1px solid #98a2b3; font-size: 12px; }
        .generated { margin-top: 24px; text-align: center; color: #98a2b3; font-size: 10px; }
        @page { size: A4; margin: 0; }
        @media print {
            body { background: white; }
            .toolbar { display: none; }
            .page { margin: 0; box-shadow: none; width: 210mm; min-height: 297mm; }
        }
        @media (max-width: 850px) {
            .page { width: 100%; min-height: auto; margin: 0; padding: 22px; }
            .grid, header { grid-template-columns: 1fr; }
            .document-title { text-align: left; }
        }
    </style>
</head>
<body>
    <div class="toolbar"><button onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button></div>
    <main class="page">
        <header>
            <section class="brand">
                ${model.company.logo_url ? `<img class="logo" src="${escapeHtml(model.company.logo_url)}" alt="logo" />` : ""}
                <div>
                    <div class="company-name">${escapeHtml(model.company.name)}</div>
                    <div class="company-meta">${escapeHtml(model.company.address)}</div>
                    <div class="company-meta">
                        ${model.company.tax_id ? `เลขประจำตัวผู้เสียภาษี ${escapeHtml(model.company.tax_id)}` : ""}
                        ${model.company.branch ? ` (${escapeHtml(model.company.branch)})` : ""}
                        ${model.company.phone ? `<br>โทร. ${escapeHtml(model.company.phone)}` : ""}
                        ${model.company.email ? `<br>${escapeHtml(model.company.email)}` : ""}
                    </div>
                </div>
            </section>
            <section class="document-title">
                <h1>${escapeHtml(model.title_th)}</h1>
                <p>${escapeHtml(model.title_en)}</p>
                <div class="document-number">เลขที่ ${escapeHtml(model.document_number)}</div>
            </section>
        </header>

        <section class="grid">
            <div class="card">
                <h2>ข้อมูลลูกค้า</h2>
                ${optionalRow("ชื่อ", model.customer.name)}
                ${optionalRow("ที่อยู่", model.customer.address)}
                ${optionalRow("โทรศัพท์", model.customer.phone)}
                ${optionalRow("เลขผู้เสียภาษี", model.customer.tax_id)}
                ${optionalRow("สาขา", model.customer.branch)}
            </div>
            <div class="card">
                <h2>ข้อมูลเอกสาร</h2>
                ${optionalRow("วันที่ออกเอกสาร", thaiDate(model.issue_at))}
                ${model.valid_until ? optionalRow("ใช้ได้ถึง", thaiDate(model.valid_until)) : ""}
                ${optionalRow("เลขที่คำสั่งซื้อ", model.order.order_number)}
                ${optionalRow("เลข Marketplace", model.order.external_order_id)}
                ${optionalRow("ช่องทาง", model.order.channel)}
                ${optionalRow("สถานะ Order", model.order.order_status)}
                ${optionalRow("สถานะชำระเงิน", model.order.payment_status)}
                ${optionalRow("ผู้ดูแล", model.order.sales_owner)}
                ${optionalRow("ขนส่ง", model.order.shipping_provider)}
                ${optionalRow("เลขติดตาม", model.order.tracking_number)}
            </div>
        </section>

        <table>
            <thead>
                <tr>
                    <th style="width:7%">#</th>
                    <th>รายการ</th>
                    <th style="width:10%">จำนวน</th>
                    <th style="width:18%">ราคาต่อหน่วย</th>
                    <th style="width:18%">รวม</th>
                </tr>
            </thead>
            <tbody>
                ${itemRows}
                ${adjustmentRow}
                ${taxRows}
                <tr class="grand-total">
                    <td colspan="4" class="right">ยอดรวมสุทธิ</td>
                    <td class="right">${money(model.grand_total, currency)}</td>
                </tr>
            </tbody>
        </table>

        ${model.note ? `<div class="note"><strong>หมายเหตุ</strong><br>${escapeHtml(model.note)}</div>` : ""}

        <footer>
            <div class="signature">ผู้จัดทำ / ผู้มีอำนาจลงนาม</div>
            <div class="signature">ผู้รับเอกสาร</div>
        </footer>
        <div class="generated">เอกสารสร้างจาก Omnichannel Commerce CRM</div>
    </main>
</body>
</html>`;
}
