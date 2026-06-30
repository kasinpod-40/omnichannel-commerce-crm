export type ActivityAction =
    | "MESSAGE_RECEIVED"
    | "PIPELINE_CREATED"
    | "PIPELINE_UPDATED"
    | "ORDER_CREATED"
    | "ORDER_QUANTITY_UPDATED"
    | "ADDRESS_UPDATED"
    | "PHONE_UPDATED"
    | "PAYMENT_SLIP_RECEIVED"
    | "PENDING_PAYMENT_SAVED"
    | "PENDING_PAYMENT_ATTACHED"
    | "PAYMENT_VERIFIED"
    | "PAYMENT_REVIEW_APPROVED"
    | "PAYMENT_REVIEW_REJECTED"
    | "SALE_WON"
    | "SALE_LOST"
    | "ORDER_CANCELLED"
    | "SALES_ASSIGNED"
    | "PAYMENT_OVERDUE"
    | "MARKETPLACE_ORDER_CREATED"
    | "MARKETPLACE_ORDER_UPDATED"
    | "ORDER_AMOUNT_UPDATED"
    | "ORDER_AMOUNT_UPDATE_FAILED"
    | "DOCUMENT_CREATED"
    | "DOCUMENT_DELETED";

export type ActivityValue =
    | string
    | number
    | boolean
    | null
    | Record<string, unknown>
    | unknown[];

export interface Activity {
    event_id: string;
    customer_record_id: string;
    action: ActivityAction;
    old_value?: ActivityValue;
    new_value?: ActivityValue;
    created_at?: number;
}