export type PcStockStatus =
    | "NORMAL"
    | "LOW_STOCK"
    | "OUT_OF_STOCK";

export type PcMaterialStatus =
    | "NORMAL"
    | "LOW_STOCK"
    | "REORDER_REQUIRED"
    | "OUT_OF_STOCK";

export type PcAlertLevel =
    | "NONE"
    | "INFO"
    | "WARNING"
    | "CRITICAL";

export type PcMaterialCheckStatus =
    | "SUFFICIENT"
    | "INSUFFICIENT"
    | "BOM_MISSING";

export type PcProductionStatus =
    | "RECOMMENDED"
    | "APPROVED"
    | "IN_PROGRESS"
    | "BLOCKED_MATERIAL"
    | "COMPLETED"
    | "CANCELLED";

export type PcInventoryStatus =
    | "NOT_REQUIRED"
    | "QUEUED"
    | "PREPARED"
    | "APPLIED"
    | "RELEASED"
    | "BLOCKED";

export type PcProductionReason =
    | "ORDER_SHORTAGE"
    | "MIN_STOCK"
    | "MANUAL";

export type PcSourceType =
    | "IN_HOUSE"
    | "DOMESTIC"
    | "IMPORT";

export type PcRecord = {
    record_id: string;
    fields: Record<string, unknown>;
};

export type PcProduct = {
    record_id: string;
    sku: string;
    product_id: string;
    style_code: string;
    product_name: string;
    category: string;
    color: string;
    size: string;
    sales_price_thb: number;
    stock_on_hand: number;
    min_stock: number;
    target_stock: number;
    stock_status: PcStockStatus;
    recommended_production_qty: number;
    production_lead_days: number;
    materials_json: string;
    active: boolean;
};

export type PcMaterial = {
    record_id: string;
    material_sku: string;
    material_name: string;
    category: string;
    unit: string;
    source_type: PcSourceType;
    supplier_name: string;
    supplier_country: string;
    lead_time_days: number;
    stock_on_hand: number;
    min_stock: number;
    target_stock: number;
    planned_requirement: number;
    projected_stock: number;
    shortage_qty: number;
    material_status: PcMaterialStatus;
    recommended_reorder_qty: number;
    alert_level: PcAlertLevel;
    active: boolean;
    notes: string;
};

export type PcProductionBatch = {
    record_id: string;
    production_id: string;
    source_order_id: string;
    product_sku: string;
    product_name: string;
    reason: PcProductionReason;
    order_shortage_qty: number;
    recommended_qty: number;
    planned_qty: number;
    actual_qty: number;
    material_check_status: PcMaterialCheckStatus;
    production_status: PcProductionStatus;
    material_requirement_summary: string;
    material_risk_summary: string;
    due_date: number;
    inventory_posted: boolean;
    inventory_posting_state_json: string;
    created_at: number;
    completed_at: number;
    owner: string;
    notes: string;
};

export type PcBomItem = {
    material_sku: string;
    quantity_per_unit: number;
    unit: string;
};

export type PcOrderAllocation = {
    sku: string;
    quantity: number;
};

export type PcProductTransition = {
    record_id: string;
    sku: string;
    previous_allocated_qty: number;
    target_allocated_qty: number;
    delta_allocated_qty: number;
    old_stock_on_hand: number;
    new_stock_on_hand: number;
};

export type PcOrderInventoryState = {
    version: 1;
    phase: "prepared" | "applied" | "released" | "blocked";
    fingerprint: string;
    order_record_id: string;
    order_number: string;
    allocations: PcOrderAllocation[];
    previous_allocations?: PcOrderAllocation[];
    transitions: PcProductTransition[];
    prepared_at: number;
    completed_at?: number;
    error_code?: string;
    error_message?: string;
};

export type PcMaterialTransition = {
    record_id: string;
    material_sku: string;
    required_qty: number;
    old_stock_on_hand: number;
    new_stock_on_hand: number;
};

export type PcProductionPostingState = {
    version: 1;
    phase: "prepared" | "posted" | "blocked";
    idempotency_key: string;
    production_record_id: string;
    production_id: string;
    product: {
        record_id: string;
        sku: string;
        actual_qty: number;
        old_stock_on_hand: number;
        new_stock_on_hand: number;
    };
    materials: PcMaterialTransition[];
    prepared_at: number;
    completed_at?: number;
    error_code?: string;
    error_message?: string;
};

export type PcOrderInventoryResult = {
    status: PcInventoryStatus;
    order_record_id: string;
    fingerprint: string;
    allocations: PcOrderAllocation[];
    production_ids: string[];
    duplicate: boolean;
};

export type PcProductionCompletionResult = {
    production_record_id: string;
    production_id: string;
    actual_qty: number;
    duplicate: boolean;
    inventory_posted: true;
};
