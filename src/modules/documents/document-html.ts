import type { DocumentViewModel } from "./document.types";

function escapeHtml(value: unknown): string {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function safeColor(value: string | undefined, fallback: string): string {
    const normalized = value?.trim() ?? "";
    return /^#[0-9a-f]{6}$/i.test(normalized) ? normalized : fallback;
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
    if (!value) return "-";
    return new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeZone: "Asia/Bangkok",
    }).format(new Date(value));
}

function optionalRow(label: string, value?: string): string {
    if (!value?.trim()) return "";
    return `<div class="info-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function orderStatusLabel(value: string): string {
    const normalized = value.trim().toLocaleLowerCase("en-US");
    if (["waiting payment", "pending payment"].includes(normalized)) return "รอชำระเงิน";
    if (["payment review", "waiting payment review"].includes(normalized)) return "รอตรวจสอบการชำระเงิน";
    if (["waiting new slip", "rejected"].includes(normalized)) return "รอสลิปใหม่";
    if (["ready to ship", "ready_to_ship"].includes(normalized)) return "พร้อมจัดส่ง";
    if (["confirmed", "processing"].includes(normalized)) return "กำลังดำเนินการ";
    if (["shipped"].includes(normalized)) return "จัดส่งแล้ว";
    if (["completed", "delivered"].includes(normalized)) return "เสร็จสมบูรณ์";
    if (["cancelled", "canceled"].includes(normalized)) return "ยกเลิกแล้ว";
    if (["returned"].includes(normalized)) return "คืนสินค้าแล้ว";
    return value.trim() || "-";
}

function paymentStatusLabel(value: string): string {
    const normalized = value.trim().toLocaleLowerCase("en-US");
    if (["paid", "verified"].includes(normalized)) return "ชำระแล้ว";
    if (["overdue"].includes(normalized)) return "เกินกำหนดชำระ";
    if (["payment review", "review"].includes(normalized)) return "รอตรวจสอบ";
    if (["pending", "waiting payment", "unpaid"].includes(normalized)) return "ยังไม่ชำระ";
    return value.trim() || "-";
}

export function renderDocumentHtml(model: DocumentViewModel): string {
    const currency = model.order.currency || "THB";
    const primary = safeColor(model.company.primary_color, "#15865A");
    const accent = safeColor(model.company.accent_color, "#E8FAF2");
    const showExternalOrder = Boolean(
        model.order.external_order_id &&
        model.order.external_order_id !== model.order.order_number
    );
    const itemRows = model.items.map((item, index) => `
        <tr>
            <td class="center">${index + 1}</td>
            <td>
                <strong class="item-name">${escapeHtml(item.name)}</strong>
                ${item.variant ? `<small>${escapeHtml(item.variant)}</small>` : ""}
                ${item.sku ? `<small>SKU: ${escapeHtml(item.sku)}</small>` : ""}
            </td>
            <td class="right">${escapeHtml(item.quantity)}</td>
            <td class="right">${money(item.unit_price, currency)}</td>
            <td class="right">${money(item.line_total, currency)}</td>
        </tr>`).join("");

    const adjustmentRow = Math.abs(model.adjustment) >= 0.01
        ? `<tr class="summary-row"><td colspan="4" class="right muted">ค่าจัดส่ง / ส่วนลด / ปรับยอด</td><td class="right">${money(model.adjustment, currency)}</td></tr>`
        : "";
    const taxRows = model.type === "tax-invoice"
        ? `<tr class="summary-row"><td colspan="4" class="right">มูลค่าก่อนภาษี</td><td class="right">${money(model.taxable_amount ?? 0, currency)}</td></tr>
           <tr class="summary-row"><td colspan="4" class="right">ภาษีมูลค่าเพิ่ม ${escapeHtml(model.vat_rate ?? 0)}%</td><td class="right">${money(model.vat_amount ?? 0, currency)}</td></tr>`
        : "";

    return `<!doctype html>
<html lang="th">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(model.title_th)} ${escapeHtml(model.document_number)}</title>
    <style>
        :root { color-scheme: light; --primary: ${primary}; --accent: ${accent}; }
        * { box-sizing: border-box; }
        body { margin: 0; background: #f2f7f5; color: #24323d; font-family: "Kanit", "Noto Sans Thai", Tahoma, Arial, sans-serif; line-height: 1.5; }
        .toolbar { position: sticky; top: 0; z-index: 10; display: flex; justify-content: center; padding: 12px; border-bottom: 1px solid #dce8e3; background: rgba(255,255,255,.96); backdrop-filter: blur(10px); }
        .print-button { min-height: 42px; padding: 0 20px; border: 1px solid color-mix(in srgb, var(--primary) 82%, #000); border-radius: 12px; color: #fff; background: var(--primary); box-shadow: 0 7px 18px color-mix(in srgb, var(--primary) 22%, transparent); font: inherit; font-weight: 600; cursor: pointer; }
        .print-button:hover { filter: brightness(.96); }
        .page { width: 210mm; min-height: 297mm; margin: 18px auto; padding: 15mm 16mm 14mm; background: #fff; box-shadow: 0 18px 45px rgba(28,58,47,.12); }
        .top-accent { height: 5px; margin: -15mm -16mm 13mm; background: linear-gradient(90deg, var(--primary), color-mix(in srgb, var(--primary) 55%, #bdf4dd)); }
        header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 28px; align-items: start; padding-bottom: 18px; border-bottom: 1px solid color-mix(in srgb, var(--primary) 22%, #e7efeb); }
        .brand { display: flex; min-width: 0; gap: 14px; align-items: flex-start; }
        .logo { width: 64px; height: 64px; object-fit: contain; border-radius: 12px; }
        h1, h2, p { margin: 0; }
        .company-name { color: #1f3029; font-size: 21px; font-weight: 700; }
        .company-meta { margin-top: 5px; color: #62716a; font-size: 11.5px; white-space: pre-line; }
        .document-title { min-width: 225px; text-align: right; }
        .document-title h1 { color: var(--primary); font-size: 27px; line-height: 1.2; }
        .document-title p { margin-top: 2px; color: #7a8882; font-size: 11px; font-weight: 600; letter-spacing: .12em; }
        .document-number { margin-top: 12px; color: #24323d; font-size: 12px; font-weight: 700; overflow-wrap: anywhere; }
        .meta-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 18px 0; overflow: hidden; border: 1px solid #dde9e4; border-radius: 12px; background: #dde9e4; }
        .meta-strip div { padding: 10px 12px; background: var(--accent); }
        .meta-strip span { display: block; color: #738179; font-size: 10px; }
        .meta-strip strong { display: block; margin-top: 2px; color: #26362e; font-size: 11.5px; overflow-wrap: anywhere; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
        .card { min-width: 0; padding: 14px; border: 1px solid #dde9e4; border-radius: 12px; background: #fff; }
        .card h2 { margin-bottom: 9px; color: var(--primary); font-size: 13px; }
        .info-row { display: grid; grid-template-columns: 108px minmax(0,1fr); gap: 8px; margin: 4px 0; font-size: 11px; }
        .info-row span { color: #7b8882; }
        .info-row strong { color: #2c3a34; font-weight: 600; white-space: pre-line; overflow-wrap: anywhere; }
        table { width: 100%; border-collapse: separate; border-spacing: 0; overflow: hidden; border: 1px solid #dbe7e2; border-radius: 12px; font-size: 11px; }
        thead th { color: color-mix(in srgb, var(--primary) 90%, #10251c); background: var(--accent); font-weight: 600; }
        th, td { padding: 9px 8px; border-right: 1px solid #e2ebe7; border-bottom: 1px solid #e2ebe7; vertical-align: top; }
        th:last-child, td:last-child { border-right: 0; }
        tbody tr:last-child td { border-bottom: 0; }
        small { display: block; margin-top: 2px; color: #7b8882; }
        .item-name { color: #27372f; }
        .right { text-align: right; }
        .center { text-align: center; }
        .muted { color: #77847e; }
        .summary-row td { background: #fbfdfc; }
        .grand-total td { border-color: var(--primary); color: #fff; background: var(--primary); font-size: 13px; font-weight: 700; }
        .note { margin-top: 15px; padding: 12px 14px; border: 1px solid #dfe9e5; border-radius: 10px; color: #5f6d67; background: #f7faf9; font-size: 11px; white-space: pre-line; }
        footer { display: grid; grid-template-columns: 1fr 1fr; gap: 42px; margin-top: 38px; }
        .signature { padding-top: 48px; border-top: 1px solid #9eaaa5; color: #56645e; font-size: 11px; text-align: center; }
        .footer-note { margin-top: 22px; color: #98a39e; font-size: 9.5px; text-align: center; }
        @page { size: A4; margin: 0; }
        @media print { body { background: #fff; } .toolbar { display: none; } .page { width: 210mm; min-height: 297mm; margin: 0; box-shadow: none; } }
        @media (max-width: 850px) { .page { width: 100%; min-height: auto; margin: 0; padding: 22px; } .top-accent { margin: -22px -22px 20px; } header, .grid { grid-template-columns: 1fr; } .document-title { min-width: 0; text-align: left; } .meta-strip { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="toolbar"><button class="print-button" onclick="window.print()">พิมพ์ / บันทึกเป็น PDF</button></div>
    <main class="page">
        <div class="top-accent"></div>
        <header>
            <section class="brand">
                ${model.company.logo_url ? `<img class="logo" src="${escapeHtml(model.company.logo_url)}" alt="โลโก้บริษัท" />` : ""}
                <div>
                    <div class="company-name">${escapeHtml(model.company.name)}</div>
                    <div class="company-meta">${escapeHtml(model.company.address)}</div>
                    <div class="company-meta">${model.company.tax_id ? `เลขประจำตัวผู้เสียภาษี ${escapeHtml(model.company.tax_id)}` : ""}${model.company.branch ? ` (${escapeHtml(model.company.branch)})` : ""}${model.company.phone ? `<br>โทร. ${escapeHtml(model.company.phone)}` : ""}${model.company.email ? `<br>อีเมล ${escapeHtml(model.company.email)}` : ""}</div>
                </div>
            </section>
            <section class="document-title">
                <h1>${escapeHtml(model.title_th)}</h1>
                <p>${escapeHtml(model.title_en)}</p>
                <div class="document-number">เลขที่ ${escapeHtml(model.document_number)}</div>
            </section>
        </header>

        <section class="meta-strip">
            <div><span>วันที่ออกเอกสาร</span><strong>${thaiDate(model.issue_at)}</strong></div>
            <div><span>${model.valid_until ? "ใช้ได้ถึง" : "เลขที่คำสั่งซื้อ"}</span><strong>${model.valid_until ? thaiDate(model.valid_until) : escapeHtml(model.order.order_number)}</strong></div>
            <div><span>ช่องทาง</span><strong>${escapeHtml(model.order.channel)}</strong></div>
        </section>

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
                ${optionalRow("เลขที่คำสั่งซื้อ", model.order.order_number)}
                ${showExternalOrder ? optionalRow("เลข Marketplace", model.order.external_order_id) : ""}
                ${optionalRow("สถานะคำสั่งซื้อ", orderStatusLabel(model.order.order_status))}
                ${optionalRow("การชำระเงิน", paymentStatusLabel(model.order.payment_status))}
                ${optionalRow("ผู้ดูแล", model.order.sales_owner)}
                ${optionalRow("ขนส่ง", model.order.shipping_provider)}
                ${optionalRow("เลขติดตาม", model.order.tracking_number)}
            </div>
        </section>

        <table>
            <thead><tr><th style="width:7%">#</th><th>รายการ</th><th style="width:10%">จำนวน</th><th style="width:18%">ราคาต่อหน่วย</th><th style="width:18%">รวม</th></tr></thead>
            <tbody>${itemRows}${adjustmentRow}${taxRows}<tr class="grand-total"><td colspan="4" class="right">ยอดรวมสุทธิ</td><td class="right">${money(model.grand_total, currency)}</td></tr></tbody>
        </table>

        ${model.note ? `<div class="note"><strong>หมายเหตุ</strong><br>${escapeHtml(model.note)}</div>` : ""}
        <footer><div class="signature">ผู้จัดทำ / ผู้มีอำนาจลงนาม</div><div class="signature">ผู้รับเอกสาร</div></footer>
        <div class="footer-note">เอกสารฉบับนี้จัดทำในรูปแบบอิเล็กทรอนิกส์</div>
    </main>
</body>
</html>`;
}
