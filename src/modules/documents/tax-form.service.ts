import type { Env } from "../../config/env";
import { ORDER_FIELDS } from "../../core/lark-fields";
import { updateLarkRecord } from "../../providers/lark/lark.provider";
import { getLarkText } from "../../utils/lark-field-value";
import { getOrderByRecordId } from "../orders/order.repository";
import { documentLinkSecret } from "./document-link.service";
import { signTaxFormLink } from "./tax-form.signature";

export type TaxFormViewModel = {
    order_record_id: string;
    order_number: string;
    channel: string;
    customer_name: string;
    tax_name: string;
    tax_address: string;
    tax_id: string;
    tax_branch: string;
};

export type GeneratedTaxFormLink = {
    order_record_id: string;
    field_name: string;
    expires_at: number;
    url: string;
};

export type TaxFormSubmission = {
    tax_name: string;
    tax_address: string;
    tax_id: string;
    tax_branch: string;
};

function finiteMinutes(value: unknown, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value: unknown, maxLength: number): string {
    return String(value ?? "").trim().slice(0, maxLength);
}

export async function getTaxFormViewModel(
    env: Env,
    orderRecordId: string
): Promise<TaxFormViewModel> {
    const record = await getOrderByRecordId(env, orderRecordId);
    if (!record) {
        throw new Error("ORDER_NOT_FOUND");
    }

    const customerName = getLarkText(
        record.fields[ORDER_FIELDS.CUSTOMER_NAME],
        ""
    );
    const address = getLarkText(record.fields[ORDER_FIELDS.ADDRESS], "");

    return {
        order_record_id: record.record_id,
        order_number:
            getLarkText(record.fields[ORDER_FIELDS.ORDER_NUMBER], "") ||
            record.record_id,
        channel: getLarkText(record.fields[ORDER_FIELDS.CHANNEL], "-"),
        customer_name: customerName,
        tax_name:
            getLarkText(record.fields[ORDER_FIELDS.TAX_NAME], "") ||
            customerName,
        tax_address:
            getLarkText(record.fields[ORDER_FIELDS.TAX_ADDRESS], "") ||
            address,
        tax_id: getLarkText(record.fields[ORDER_FIELDS.TAX_ID], ""),
        tax_branch:
            getLarkText(record.fields[ORDER_FIELDS.TAX_BRANCH], "") ||
            "สำนักงานใหญ่",
    };
}

export async function createAndSaveTaxFormLink(input: {
    env: Env;
    requestUrl: string;
    orderRecordId: string;
    expiresMinutes?: number;
}): Promise<GeneratedTaxFormLink> {
    const secret = documentLinkSecret(input.env);
    if (!secret) {
        throw new Error("DOCUMENT_LINK_SECRET_MISSING");
    }

    await getTaxFormViewModel(input.env, input.orderRecordId);

    const configuredDefault = finiteMinutes(
        input.env.DOCUMENT_TAX_FORM_EXPIRES_MINUTES,
        10_080
    );
    const minutes = Math.min(
        43_200,
        Math.max(1, Math.round(finiteMinutes(input.expiresMinutes, configuredDefault)))
    );
    const expiresAt = Date.now() + minutes * 60_000;
    const signature = await signTaxFormLink(
        secret,
        input.orderRecordId,
        expiresAt
    );
    const url = new URL(input.requestUrl);
    url.pathname = `/forms/tax/order/${encodeURIComponent(input.orderRecordId)}`;
    url.search = "";
    url.searchParams.set("expires", String(expiresAt));
    url.searchParams.set("signature", signature);

    const generated: GeneratedTaxFormLink = {
        order_record_id: input.orderRecordId,
        field_name: ORDER_FIELDS.TAX_FORM_URL,
        expires_at: expiresAt,
        url: url.toString(),
    };

    try {
        await updateLarkRecord(
            input.env,
            input.env.ORDERS_TABLE_ID,
            input.orderRecordId,
            {
                [ORDER_FIELDS.TAX_FORM_URL]: {
                    text: "กรอกข้อมูลใบกำกับภาษี",
                    link: generated.url,
                },
                [ORDER_FIELDS.UPDATED_AT]: Date.now(),
            }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("FieldNameNotFound")) {
            throw new Error("TAX_FORM_URL_FIELD_MISSING");
        }
        if (message.includes("URLFieldConvFail")) {
            throw new Error("TAX_FORM_URL_FIELD_INVALID");
        }
        throw error;
    }

    return generated;
}

export function validateTaxFormSubmission(
    value: Record<string, unknown>
): TaxFormSubmission {
    const taxName = cleanText(value.tax_name, 200);
    const taxAddress = cleanText(value.tax_address, 2_000);
    const rawTaxId = cleanText(value.tax_id, 30);
    const taxId = rawTaxId.replace(/[^0-9]/g, "");
    const taxBranch = cleanText(value.tax_branch, 100) || "สำนักงานใหญ่";
    const consent = cleanText(value.consent, 20);

    const missing: string[] = [];
    if (!taxName) missing.push("tax_name");
    if (!taxAddress) missing.push("tax_address");
    if (!taxId) missing.push("tax_id");
    if (consent !== "accepted") missing.push("consent");

    if (missing.length > 0) {
        throw new Error(`TAX_FORM_INCOMPLETE:${missing.join(",")}`);
    }

    if (!/^\d{13}$/.test(taxId)) {
        throw new Error("TAX_ID_INVALID");
    }

    return {
        tax_name: taxName,
        tax_address: taxAddress,
        tax_id: taxId,
        tax_branch: taxBranch,
    };
}

export async function saveTaxFormSubmission(
    env: Env,
    orderRecordId: string,
    submission: TaxFormSubmission
): Promise<void> {
    const record = await getOrderByRecordId(env, orderRecordId);
    if (!record) {
        throw new Error("ORDER_NOT_FOUND");
    }

    try {
        await updateLarkRecord(env, env.ORDERS_TABLE_ID, orderRecordId, {
            [ORDER_FIELDS.TAX_NAME]: submission.tax_name,
            [ORDER_FIELDS.TAX_ADDRESS]: submission.tax_address,
            [ORDER_FIELDS.TAX_ID]: submission.tax_id,
            [ORDER_FIELDS.TAX_BRANCH]: submission.tax_branch,
            [ORDER_FIELDS.UPDATED_AT]: Date.now(),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("FieldNameNotFound")) {
            throw new Error("TAX_FIELDS_MISSING");
        }
        throw error;
    }
}
