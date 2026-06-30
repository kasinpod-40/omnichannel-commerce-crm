import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { getOrderByRecordId, type LarkOrderRecord } from "../orders/order.repository";
import { resolveOrderBusinessIdentity } from "../orders/order-business-identity";
import { getLarkNumber, getLarkText } from "../../utils/lark-field-value";
import type {
    DocumentCustomer,
    DocumentLineItem,
    DocumentType,
    DocumentViewModel,
} from "./document.types";

const TITLES: Record<DocumentType, { th: string; en: string; prefix: string }> = {
    quotation: { th: "ใบเสนอราคา", en: "QUOTATION", prefix: "QT" },
    invoice: { th: "ใบแจ้งหนี้", en: "INVOICE", prefix: "INV" },
    "tax-invoice": {
        th: "ใบกำกับภาษี",
        en: "TAX INVOICE",
        prefix: "TAX",
    },
};

function sanitizeNumber(value: string): string {
    return value
        .trim()
        .replace(/[^A-Za-z0-9ก-๙_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
}

function finiteNumber(value: unknown, fallback = 0): number {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseMarketplaceItems(raw: unknown): Array<{
    sku?: string;
    name?: string;
    variant?: string;
    quantity?: number;
    unit_price?: number;
}> {
    const text = getLarkText(raw, "").trim();

    if (!text) {
        return [];
    }

    try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function buildItems(record: LarkOrderRecord, grandTotal: number): DocumentLineItem[] {
    const rawItems = parseMarketplaceItems(
        record.fields[ORDER_FIELDS.MARKETPLACE_ITEMS_JSON]
    );

    if (rawItems.length > 0) {
        return rawItems.map((item, index) => {
            const quantity = Math.max(1, finiteNumber(item.quantity, 1));
            const unitPrice = Math.max(0, finiteNumber(item.unit_price, 0));
            return {
                sku: item.sku?.trim() || undefined,
                name: item.name?.trim() || `รายการที่ ${index + 1}`,
                variant: item.variant?.trim() || undefined,
                quantity,
                unit_price: roundMoney(unitPrice),
                line_total: roundMoney(quantity * unitPrice),
            };
        });
    }

    const quantity = Math.max(
        1,
        getLarkNumber(record.fields[ORDER_FIELDS.QUANTITY], 1)
    );
    const unitPrice = quantity > 0 ? grandTotal / quantity : grandTotal;

    return [
        {
            name:
                getLarkText(
                    record.fields[ORDER_FIELDS.PRODUCT_NAME],
                    "สินค้า/บริการ"
                ) || "สินค้า/บริการ",
            variant:
                getLarkText(record.fields[ORDER_FIELDS.PRODUCT_SIZE], "") ||
                undefined,
            quantity,
            unit_price: roundMoney(unitPrice),
            line_total: roundMoney(grandTotal),
        },
    ];
}

function isPlaceholderCompanyValue(value?: string): boolean {
    const normalized = value?.trim() ?? "";
    return (
        !normalized ||
        normalized === "-" ||
        normalized === "ชื่อบริษัท / ร้านค้า" ||
        normalized.startsWith("กรุณาแก้ไข")
    );
}

function companyFromEnv(env: Env) {
    return {
        name: env.DOCUMENT_COMPANY_NAME?.trim() || "ชื่อบริษัท / ร้านค้า",
        address: env.DOCUMENT_COMPANY_ADDRESS?.trim() || "-",
        tax_id: env.DOCUMENT_COMPANY_TAX_ID?.trim() || undefined,
        branch: env.DOCUMENT_COMPANY_BRANCH?.trim() || undefined,
        phone: env.DOCUMENT_COMPANY_PHONE?.trim() || undefined,
        email: env.DOCUMENT_COMPANY_EMAIL?.trim() || undefined,
        logo_url: env.DOCUMENT_LOGO_URL?.trim() || undefined,
    };
}

function customerFromRecord(record: LarkOrderRecord): DocumentCustomer {
    return {
        name:
            getLarkText(record.fields[ORDER_FIELDS.TAX_NAME], "") ||
            getLarkText(record.fields[ORDER_FIELDS.CUSTOMER_NAME], "-") ||
            "-",
        address:
            getLarkText(record.fields[ORDER_FIELDS.TAX_ADDRESS], "") ||
            getLarkText(record.fields[ORDER_FIELDS.ADDRESS], "-") ||
            "-",
        phone:
            getLarkText(record.fields[ORDER_FIELDS.PHONE], "") || undefined,
        tax_id: getLarkText(record.fields[ORDER_FIELDS.TAX_ID], "") || undefined,
        branch:
            getLarkText(record.fields[ORDER_FIELDS.TAX_BRANCH], "") || undefined,
    };
}

function documentNumber(type: DocumentType, orderNumber: string): string {
    const title = TITLES[type];
    const safeOrder = sanitizeNumber(orderNumber) || "ORDER";
    return `${title.prefix}-${safeOrder}`;
}

/** สร้างเลขเอกสารจาก Business Order Number โดยไม่บังคับ validate ข้อมูลภาษี เพื่อให้ค้นหา/ลบเอกสารเสียได้ */
export function buildDocumentNumberFromRecord(
    record: LarkOrderRecord,
    type: DocumentType
): string {
    const orderNumber = resolveOrderBusinessIdentity(
        record.fields,
        getLarkText(record.fields[ORDER_FIELDS.CHANNEL], "LINE")
    ).displayOrderNumber || "ORDER";
    return documentNumber(type, orderNumber);
}

function calculateTax(
    type: DocumentType,
    grandTotal: number,
    env: Env
): Pick<DocumentViewModel, "taxable_amount" | "vat_rate" | "vat_amount"> & { calculated_grand_total?: number } {
    if (type !== "tax-invoice") {
        return {};
    }

    const vatRate = Math.max(0, finiteNumber(env.DOCUMENT_VAT_RATE, 7));
    const includesVat =
        (env.DOCUMENT_PRICE_INCLUDES_VAT?.trim().toLowerCase() ?? "true") !==
        "false";

    if (vatRate === 0) {
        return {
            taxable_amount: roundMoney(grandTotal),
            vat_rate: 0,
            vat_amount: 0,
        };
    }

    if (includesVat) {
        const taxableAmount = grandTotal / (1 + vatRate / 100);
        return {
            taxable_amount: roundMoney(taxableAmount),
            vat_rate: vatRate,
            vat_amount: roundMoney(grandTotal - taxableAmount),
        };
    }

    const vatAmount = roundMoney((grandTotal * vatRate) / 100);
    return {
        taxable_amount: roundMoney(grandTotal),
        vat_rate: vatRate,
        vat_amount: vatAmount,
        calculated_grand_total: roundMoney(grandTotal + vatAmount),
    };
}

export function buildDocumentViewModelFromRecord(
    env: Env,
    record: LarkOrderRecord,
    type: DocumentType,
    now = Date.now()
): DocumentViewModel {
    const title = TITLES[type];
    const orderNumber = resolveOrderBusinessIdentity(
        record.fields,
        getLarkText(record.fields[ORDER_FIELDS.CHANNEL], "LINE")
    ).displayOrderNumber || "ORDER";
    const grandTotal = roundMoney(
        Math.max(0, getLarkNumber(record.fields[ORDER_FIELDS.TOTAL_AMOUNT], 0))
    );
    const items = buildItems(record, grandTotal);
    const itemSubtotal = roundMoney(
        items.reduce((sum, item) => sum + item.line_total, 0)
    );
    const adjustment = roundMoney(grandTotal - itemSubtotal);
    const company = companyFromEnv(env);
    const customer = customerFromRecord(record);

    if (type === "tax-invoice") {
        const missing: string[] = [];
        if (isPlaceholderCompanyValue(company.name)) {
            missing.push("DOCUMENT_COMPANY_NAME");
        }
        if (isPlaceholderCompanyValue(company.address)) {
            missing.push("DOCUMENT_COMPANY_ADDRESS");
        }
        if (isPlaceholderCompanyValue(company.tax_id)) {
            missing.push("DOCUMENT_COMPANY_TAX_ID");
        }
        if (!customer.tax_id) {
            missing.push("Orders.tax_id");
        }

        if (missing.length > 0) {
            throw new Error(`TAX_DATA_INCOMPLETE:${missing.join(",")}`);
        }
    }

    const validDays = Math.max(
        1,
        Math.round(finiteNumber(env.DOCUMENT_QUOTATION_VALID_DAYS, 7))
    );
    const tax = calculateTax(type, grandTotal, env);
    const createdAt = getLarkNumber(
        record.fields[ORDER_FIELDS.CREATED_AT],
        0
    );
    const paidAt = getLarkNumber(record.fields[ORDER_FIELDS.PAID_AT], 0);

    return {
        type,
        title_th: title.th,
        title_en: title.en,
        document_number: buildDocumentNumberFromRecord(record, type),
        issue_at: now,
        valid_until:
            type === "quotation" ? now + validDays * 86_400_000 : undefined,
        company,
        customer,
        order: {
            record_id: record.record_id,
            order_number: orderNumber,
            external_order_id:
                getLarkText(
                    record.fields[ORDER_FIELDS.EXTERNAL_ORDER_ID],
                    ""
                ) || undefined,
            channel: getLarkText(record.fields[ORDER_FIELDS.CHANNEL], "-"),
            order_status: getLarkText(
                record.fields[ORDER_FIELDS.ORDER_STATUS],
                "-"
            ),
            payment_status: getLarkText(
                record.fields[ORDER_FIELDS.PAYMENT_STATUS],
                "-"
            ),
            currency:
                getLarkText(record.fields[ORDER_FIELDS.CURRENCY], "THB") ||
                "THB",
            created_at: createdAt || undefined,
            paid_at: paidAt || undefined,
            sales_owner:
                getLarkText(record.fields[ORDER_FIELDS.SALES_OWNER], "") ||
                undefined,
            tracking_number:
                getLarkText(
                    record.fields[ORDER_FIELDS.TRACKING_NUMBER],
                    ""
                ) || undefined,
            shipping_provider:
                getLarkText(
                    record.fields[ORDER_FIELDS.SHIPPING_PROVIDER],
                    ""
                ) || undefined,
        },
        items,
        subtotal: itemSubtotal,
        adjustment,
        taxable_amount: tax.taxable_amount,
        vat_rate: tax.vat_rate,
        vat_amount: tax.vat_amount,
        grand_total: tax.calculated_grand_total ?? grandTotal,
        note: env.DOCUMENT_NOTE?.trim() || undefined,
    };
}

export async function buildOrderDocument(
    env: Env,
    orderRecordId: string,
    type: DocumentType,
    now = Date.now()
): Promise<DocumentViewModel> {
    const record = await getOrderByRecordId(env, orderRecordId);

    if (!record) {
        throw new Error("ORDER_NOT_FOUND");
    }

    return buildDocumentViewModelFromRecord(env, record, type, now);
}
