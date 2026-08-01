import type { Env } from "../../config/env";
import {
    ORDER_FIELDS,
    PC_MATERIAL_FIELDS,
    PC_PRODUCT_FIELDS,
    PC_PRODUCTION_FIELDS,
} from "../../core/lark-fields";
import {
    batchCreateLarkRecords,
    batchUpdateLarkRecords,
    createLarkRecord,
    getLarkRecord,
    listLarkRecords,
    searchLarkRecords,
    updateLarkRecord,
    type LarkBatchRecordInput,
} from "../../providers/lark/lark.provider";
import {
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import type {
    PcInventoryStatus,
    PcMaterial,
    PcMaterialCheckStatus,
    PcMaterialStatus,
    PcProduct,
    PcProductionBatch,
    PcProductionReason,
    PcProductionStatus,
    PcRecord,
    PcSourceType,
    PcStockStatus,
} from "./pc.types";

function normalizeRecord(result: unknown): PcRecord {
    const data = result as {
        record?: PcRecord;
        record_id?: string;
        id?: string;
        fields?: Record<string, unknown>;
    };

    if (data.record?.record_id) {
        return data.record;
    }

    const recordId = data.record_id ?? data.id;

    if (!recordId) {
        throw new Error(`Invalid Lark PC record: ${JSON.stringify(result)}`);
    }

    return {
        record_id: recordId,
        fields: data.fields ?? {},
    };
}

function pcAppToken(env: Env): string {
    return env.PC_BASE_APP_TOKEN?.trim() || env.LARK_APP_TOKEN;
}

function assertPcConfiguration(
    env: Env
): asserts env is Env & {
    PC_PRODUCTS_TABLE_ID: string;
    PC_MATERIALS_TABLE_ID: string;
    PC_PRODUCTION_TABLE_ID: string;
} {
    const missing = [
        ["PC_PRODUCTS_TABLE_ID", env.PC_PRODUCTS_TABLE_ID],
        ["PC_MATERIALS_TABLE_ID", env.PC_MATERIALS_TABLE_ID],
        ["PC_PRODUCTION_TABLE_ID", env.PC_PRODUCTION_TABLE_ID],
    ]
        .filter(([, value]) => !value?.trim())
        .map(([name]) => name);

    if (missing.length > 0) {
        throw new Error(`PC_CONFIGURATION_MISSING:${missing.join(",")}`);
    }
}

export function isPcInventoryEnabled(env: Env): boolean {
    return env.PC_INVENTORY_ENABLED?.trim().toLowerCase() === "true";
}

export function isPcInventoryConfigured(env: Env): boolean {
    return Boolean(
        env.PC_PRODUCTS_TABLE_ID?.trim() &&
        env.PC_MATERIALS_TABLE_ID?.trim() &&
        env.PC_PRODUCTION_TABLE_ID?.trim()
    );
}

function asStockStatus(value: unknown): PcStockStatus {
    const normalized = getLarkText(value, "NORMAL").trim();

    return normalized === "LOW_STOCK" || normalized === "OUT_OF_STOCK"
        ? normalized
        : "NORMAL";
}

function asMaterialStatus(value: unknown): PcMaterialStatus {
    const normalized = getLarkText(value, "NORMAL").trim();

    if (
        normalized === "LOW_STOCK" ||
        normalized === "REORDER_REQUIRED" ||
        normalized === "OUT_OF_STOCK"
    ) {
        return normalized;
    }

    return "NORMAL";
}

function asSourceType(value: unknown): PcSourceType {
    const normalized = getLarkText(value, "DOMESTIC").trim();

    if (normalized === "IN_HOUSE" || normalized === "IMPORT") {
        return normalized;
    }

    return "DOMESTIC";
}

function asMaterialCheckStatus(value: unknown): PcMaterialCheckStatus {
    const normalized = getLarkText(value, "BOM_MISSING").trim();

    if (normalized === "SUFFICIENT" || normalized === "INSUFFICIENT") {
        return normalized;
    }

    return "BOM_MISSING";
}

function asProductionStatus(value: unknown): PcProductionStatus {
    const normalized = getLarkText(value, "RECOMMENDED").trim();
    const allowed = new Set<PcProductionStatus>([
        "RECOMMENDED",
        "APPROVED",
        "IN_PROGRESS",
        "BLOCKED_MATERIAL",
        "COMPLETED",
        "CANCELLED",
    ]);

    return allowed.has(normalized as PcProductionStatus)
        ? (normalized as PcProductionStatus)
        : "RECOMMENDED";
}

function asProductionReason(value: unknown): PcProductionReason {
    const normalized = getLarkText(value, "MIN_STOCK").trim();

    if (normalized === "ORDER_SHORTAGE" || normalized === "MANUAL") {
        return normalized;
    }

    return "MIN_STOCK";
}

export function normalizePcProduct(result: unknown): PcProduct {
    const record = normalizeRecord(result);
    const fields = record.fields;

    return {
        record_id: record.record_id,
        sku: getLarkText(fields[PC_PRODUCT_FIELDS.SKU]).trim(),
        product_id: getLarkText(fields[PC_PRODUCT_FIELDS.PRODUCT_ID]).trim(),
        style_code: getLarkText(fields[PC_PRODUCT_FIELDS.STYLE_CODE]).trim(),
        product_name: getLarkText(fields[PC_PRODUCT_FIELDS.PRODUCT_NAME]).trim(),
        category: getLarkText(fields[PC_PRODUCT_FIELDS.CATEGORY]).trim(),
        color: getLarkText(fields[PC_PRODUCT_FIELDS.COLOR]).trim(),
        size: getLarkText(fields[PC_PRODUCT_FIELDS.SIZE]).trim(),
        sales_price_thb: getLarkNumber(
            fields[PC_PRODUCT_FIELDS.SALES_PRICE_THB]
        ),
        stock_on_hand: getLarkNumber(
            fields[PC_PRODUCT_FIELDS.STOCK_ON_HAND]
        ),
        min_stock: getLarkNumber(fields[PC_PRODUCT_FIELDS.MIN_STOCK]),
        target_stock: getLarkNumber(fields[PC_PRODUCT_FIELDS.TARGET_STOCK]),
        stock_status: asStockStatus(
            fields[PC_PRODUCT_FIELDS.STOCK_STATUS]
        ),
        recommended_production_qty: getLarkNumber(
            fields[PC_PRODUCT_FIELDS.RECOMMENDED_PRODUCTION_QTY]
        ),
        production_lead_days: getLarkNumber(
            fields[PC_PRODUCT_FIELDS.PRODUCTION_LEAD_DAYS]
        ),
        materials_json: getLarkText(
            fields[PC_PRODUCT_FIELDS.MATERIALS_JSON]
        ).trim(),
        active: getLarkBoolean(fields[PC_PRODUCT_FIELDS.ACTIVE], true),
    };
}

export function normalizePcMaterial(result: unknown): PcMaterial {
    const record = normalizeRecord(result);
    const fields = record.fields;
    const alert = getLarkText(
        fields[PC_MATERIAL_FIELDS.ALERT_LEVEL],
        "NONE"
    ).trim();

    return {
        record_id: record.record_id,
        material_sku: getLarkText(
            fields[PC_MATERIAL_FIELDS.MATERIAL_SKU]
        ).trim(),
        material_name: getLarkText(
            fields[PC_MATERIAL_FIELDS.MATERIAL_NAME]
        ).trim(),
        category: getLarkText(fields[PC_MATERIAL_FIELDS.CATEGORY]).trim(),
        unit: getLarkText(fields[PC_MATERIAL_FIELDS.UNIT]).trim(),
        source_type: asSourceType(
            fields[PC_MATERIAL_FIELDS.SOURCE_TYPE]
        ),
        supplier_name: getLarkText(
            fields[PC_MATERIAL_FIELDS.SUPPLIER_NAME]
        ).trim(),
        supplier_country: getLarkText(
            fields[PC_MATERIAL_FIELDS.SUPPLIER_COUNTRY]
        ).trim(),
        lead_time_days: getLarkNumber(
            fields[PC_MATERIAL_FIELDS.LEAD_TIME_DAYS]
        ),
        stock_on_hand: getLarkNumber(
            fields[PC_MATERIAL_FIELDS.STOCK_ON_HAND]
        ),
        min_stock: getLarkNumber(fields[PC_MATERIAL_FIELDS.MIN_STOCK]),
        target_stock: getLarkNumber(
            fields[PC_MATERIAL_FIELDS.TARGET_STOCK]
        ),
        planned_requirement: getLarkNumber(
            fields[PC_MATERIAL_FIELDS.PLANNED_REQUIREMENT]
        ),
        projected_stock: getLarkNumber(
            fields[PC_MATERIAL_FIELDS.PROJECTED_STOCK]
        ),
        shortage_qty: getLarkNumber(
            fields[PC_MATERIAL_FIELDS.SHORTAGE_QTY]
        ),
        material_status: asMaterialStatus(
            fields[PC_MATERIAL_FIELDS.MATERIAL_STATUS]
        ),
        recommended_reorder_qty: getLarkNumber(
            fields[PC_MATERIAL_FIELDS.RECOMMENDED_REORDER_QTY]
        ),
        alert_level:
            alert === "INFO" ||
            alert === "WARNING" ||
            alert === "CRITICAL"
                ? alert
                : "NONE",
        active: getLarkBoolean(fields[PC_MATERIAL_FIELDS.ACTIVE], true),
        notes: getLarkText(fields[PC_MATERIAL_FIELDS.NOTES]).trim(),
    };
}

export function normalizePcProduction(result: unknown): PcProductionBatch {
    const record = normalizeRecord(result);
    const fields = record.fields;

    return {
        record_id: record.record_id,
        production_id: getLarkText(
            fields[PC_PRODUCTION_FIELDS.PRODUCTION_ID]
        ).trim(),
        source_order_id: getLarkText(
            fields[PC_PRODUCTION_FIELDS.SOURCE_ORDER_ID]
        ).trim(),
        product_sku: getLarkText(
            fields[PC_PRODUCTION_FIELDS.PRODUCT_SKU]
        ).trim(),
        product_name: getLarkText(
            fields[PC_PRODUCTION_FIELDS.PRODUCT_NAME]
        ).trim(),
        reason: asProductionReason(fields[PC_PRODUCTION_FIELDS.REASON]),
        order_shortage_qty: getLarkNumber(
            fields[PC_PRODUCTION_FIELDS.ORDER_SHORTAGE_QTY]
        ),
        recommended_qty: getLarkNumber(
            fields[PC_PRODUCTION_FIELDS.RECOMMENDED_QTY]
        ),
        planned_qty: getLarkNumber(
            fields[PC_PRODUCTION_FIELDS.PLANNED_QTY]
        ),
        actual_qty: getLarkNumber(
            fields[PC_PRODUCTION_FIELDS.ACTUAL_QTY]
        ),
        material_check_status: asMaterialCheckStatus(
            fields[PC_PRODUCTION_FIELDS.MATERIAL_CHECK_STATUS]
        ),
        production_status: asProductionStatus(
            fields[PC_PRODUCTION_FIELDS.PRODUCTION_STATUS]
        ),
        material_requirement_summary: getLarkText(
            fields[PC_PRODUCTION_FIELDS.MATERIAL_REQUIREMENT_SUMMARY]
        ).trim(),
        material_risk_summary: getLarkText(
            fields[PC_PRODUCTION_FIELDS.MATERIAL_RISK_SUMMARY]
        ).trim(),
        due_date: getLarkNumber(fields[PC_PRODUCTION_FIELDS.DUE_DATE]),
        inventory_posted: getLarkBoolean(
            fields[PC_PRODUCTION_FIELDS.INVENTORY_POSTED]
        ),
        inventory_posting_state_json: getLarkText(
            fields[PC_PRODUCTION_FIELDS.INVENTORY_POSTING_STATE_JSON]
        ).trim(),
        created_at: getLarkNumber(
            fields[PC_PRODUCTION_FIELDS.CREATED_AT]
        ),
        completed_at: getLarkNumber(
            fields[PC_PRODUCTION_FIELDS.COMPLETED_AT]
        ),
        owner: getLarkText(fields[PC_PRODUCTION_FIELDS.OWNER]).trim(),
        notes: getLarkText(fields[PC_PRODUCTION_FIELDS.NOTES]).trim(),
    };
}

export async function listPcProducts(env: Env): Promise<PcProduct[]> {
    assertPcConfiguration(env);
    const records = await listLarkRecords(
        env,
        env.PC_PRODUCTS_TABLE_ID,
        pcAppToken(env)
    );

    return records.map(normalizePcProduct);
}

export async function listPcMaterials(env: Env): Promise<PcMaterial[]> {
    assertPcConfiguration(env);
    const records = await listLarkRecords(
        env,
        env.PC_MATERIALS_TABLE_ID,
        pcAppToken(env)
    );

    return records.map(normalizePcMaterial);
}

export async function listPcProduction(
    env: Env
): Promise<PcProductionBatch[]> {
    assertPcConfiguration(env);
    const records = await listLarkRecords(
        env,
        env.PC_PRODUCTION_TABLE_ID,
        pcAppToken(env)
    );

    return records.map(normalizePcProduction);
}

export async function getPcProductionByRecordId(
    env: Env,
    recordId: string
): Promise<PcProductionBatch | null> {
    assertPcConfiguration(env);
    const record = await getLarkRecord(
        env,
        env.PC_PRODUCTION_TABLE_ID,
        recordId,
        pcAppToken(env)
    );

    return record ? normalizePcProduction(record) : null;
}

export async function findPcProductionById(
    env: Env,
    productionId: string
): Promise<PcProductionBatch | null> {
    assertPcConfiguration(env);
    const records = await searchLarkRecords(
        env,
        env.PC_PRODUCTION_TABLE_ID,
        {
            conjunction: "and",
            conditions: [
                {
                    field_name: PC_PRODUCTION_FIELDS.PRODUCTION_ID,
                    operator: "is",
                    value: [productionId],
                },
            ],
        },
        pcAppToken(env)
    );

    return records[0] ? normalizePcProduction(records[0]) : null;
}

export async function createPcProduction(
    env: Env,
    fields: Record<string, unknown>
): Promise<PcProductionBatch> {
    assertPcConfiguration(env);
    const record = await createLarkRecord(
        env,
        env.PC_PRODUCTION_TABLE_ID,
        fields,
        pcAppToken(env)
    );

    return normalizePcProduction(record);
}

export async function batchCreatePcProduction(
    env: Env,
    fields: Array<Record<string, unknown>>
): Promise<void> {
    assertPcConfiguration(env);
    await batchCreateLarkRecords(
        env,
        env.PC_PRODUCTION_TABLE_ID,
        fields.map((item) => ({ fields: item })),
        pcAppToken(env)
    );
}

export async function updatePcProduction(
    env: Env,
    recordId: string,
    fields: Record<string, unknown>
): Promise<PcProductionBatch> {
    assertPcConfiguration(env);
    const record = await updateLarkRecord(
        env,
        env.PC_PRODUCTION_TABLE_ID,
        recordId,
        fields,
        pcAppToken(env)
    );

    return normalizePcProduction(record);
}

export async function batchUpdatePcProducts(
    env: Env,
    records: LarkBatchRecordInput[]
): Promise<void> {
    assertPcConfiguration(env);
    await batchUpdateLarkRecords(
        env,
        env.PC_PRODUCTS_TABLE_ID,
        records,
        pcAppToken(env)
    );
}

export async function batchUpdatePcMaterials(
    env: Env,
    records: LarkBatchRecordInput[]
): Promise<void> {
    assertPcConfiguration(env);
    await batchUpdateLarkRecords(
        env,
        env.PC_MATERIALS_TABLE_ID,
        records,
        pcAppToken(env)
    );
}

export async function batchUpdatePcProduction(
    env: Env,
    records: LarkBatchRecordInput[]
): Promise<void> {
    assertPcConfiguration(env);
    await batchUpdateLarkRecords(
        env,
        env.PC_PRODUCTION_TABLE_ID,
        records,
        pcAppToken(env)
    );
}

export async function updateOrderPcState(
    env: Env,
    orderRecordId: string,
    input: {
        status: PcInventoryStatus;
        state_json: string;
        updated_at?: number;
    }
): Promise<void> {
    await updateLarkRecord(
        env,
        env.ORDERS_TABLE_ID,
        orderRecordId,
        {
            [ORDER_FIELDS.PC_INVENTORY_STATUS]: input.status,
            [ORDER_FIELDS.PC_INVENTORY_STATE_JSON]: input.state_json,
            [ORDER_FIELDS.PC_INVENTORY_UPDATED_AT]:
                input.updated_at ?? Date.now(),
        }
    );
}
export async function updateOrderPcStatus(
    env: Env,
    orderRecordId: string,
    status: PcInventoryStatus
): Promise<void> {
    await updateLarkRecord(
        env,
        env.ORDERS_TABLE_ID,
        orderRecordId,
        {
            [ORDER_FIELDS.PC_INVENTORY_STATUS]: status,
            [ORDER_FIELDS.PC_INVENTORY_UPDATED_AT]: Date.now(),
        }
    );
}
