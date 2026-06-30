export type DocumentType = "quotation" | "invoice" | "tax-invoice";

export type DocumentLineItem = {
    sku?: string;
    name: string;
    variant?: string;
    quantity: number;
    unit_price: number;
    line_total: number;
};

export type DocumentCompany = {
    name: string;
    address: string;
    tax_id?: string;
    branch?: string;
    phone?: string;
    email?: string;
    logo_url?: string;
    primary_color?: string;
    accent_color?: string;
};

export type DocumentCustomer = {
    name: string;
    address: string;
    phone?: string;
    tax_id?: string;
    branch?: string;
};

export type DocumentViewModel = {
    type: DocumentType;
    title_th: string;
    title_en: string;
    document_number: string;
    issue_at: number;
    valid_until?: number;
    company: DocumentCompany;
    customer: DocumentCustomer;
    order: {
        record_id: string;
        order_number: string;
        external_order_id?: string;
        channel: string;
        order_status: string;
        payment_status: string;
        currency: string;
        created_at?: number;
        paid_at?: number;
        sales_owner?: string;
        tracking_number?: string;
        shipping_provider?: string;
    };
    items: DocumentLineItem[];
    subtotal: number;
    adjustment: number;
    taxable_amount?: number;
    vat_rate?: number;
    vat_amount?: number;
    grand_total: number;
    note?: string;
};
