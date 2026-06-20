export type ActivityAction =
    | "MESSAGE_RECEIVED"
    | "PIPELINE_CREATED"
    | "PIPELINE_UPDATED"
    | "ORDER_CREATED"
    | "ORDER_QUANTITY_UPDATED"
    | "ADDRESS_UPDATED"
    | "PAYMENT_SLIP_RECEIVED"
    | "PAYMENT_VERIFIED"
    | "SALE_WON"
    | "SALE_LOST"
    | "ORDER_CANCELLED";

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