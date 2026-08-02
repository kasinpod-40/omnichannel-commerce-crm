#!/usr/bin/env node
import assert from "node:assert/strict";
import {
    buildFieldDescription,
    buildFieldUpdatePayload,
    normalizeFieldDescription,
    summarizeFieldUpdatePayload,
} from "./lib/pc-field-description-payload.mjs";

const primaryText = {
    field_id: "fld-primary",
    field_name: "sku",
    type: 1,
    ui_type: "Text",
    property: {},
};

assert.deepEqual(buildFieldDescription("  รหัสสินค้า  "), {
    disable_sync: false,
    text: "รหัสสินค้า",
});

assert.deepEqual(buildFieldUpdatePayload(primaryText, "รหัสสินค้า"), {
    field_name: "sku",
    type: 1,
    description: {
        disable_sync: false,
        text: "รหัสสินค้า",
    },
});

const number = {
    field_id: "fld-number",
    field_name: "stock_on_hand",
    type: 2,
    ui_type: "Number",
    property: { formatter: "0.0" },
};

assert.deepEqual(buildFieldUpdatePayload(number, "จำนวนคงเหลือ"), {
    field_name: "stock_on_hand",
    type: 2,
    description: {
        disable_sync: false,
        text: "จำนวนคงเหลือ",
    },
    property: { formatter: "0.0" },
});

const select = {
    field_id: "fld-select",
    field_name: "stock_status",
    type: 3,
    ui_type: "SingleSelect",
    property: {
        options: [
            { id: "opt-normal", name: "NORMAL", color: 0 },
            { id: "opt-low", name: "LOW_STOCK", color: 1 },
        ],
    },
};

const selectPayload = buildFieldUpdatePayload(select, "สถานะสต็อก");
assert.equal(selectPayload.ui_type, undefined);
assert.deepEqual(selectPayload.property, select.property);
assert.notEqual(selectPayload.property, select.property);

const currency = {
    field_id: "fld-currency",
    field_name: "sales_price_thb",
    type: 2,
    ui_type: "Currency",
    property: { formatter: "0.00", currency_code: "THB" },
};

assert.deepEqual(buildFieldUpdatePayload(currency, "ราคาขาย"), {
    field_name: "sales_price_thb",
    type: 2,
    description: {
        disable_sync: false,
        text: "ราคาขาย",
    },
    ui_type: "Currency",
    property: { formatter: "0.00", currency_code: "THB" },
});

assert.equal(normalizeFieldDescription("  คำอธิบาย  "), "คำอธิบาย");
assert.equal(
    normalizeFieldDescription({
        disable_sync: true,
        text: "  คำอธิบายจาก API  ",
    }),
    "คำอธิบายจาก API"
);
assert.equal(
    normalizeFieldDescription([
        { text: "ส่วนแรก", type: "text" },
        { text: " ส่วนที่สอง ", type: "text" },
    ]),
    "ส่วนแรก ส่วนที่สอง"
);

assert.throws(() => buildFieldDescription("   "), /description is empty/);
assert.throws(
    () =>
        buildFieldUpdatePayload(
            {
                field_id: "fld-lookup",
                field_name: "lookup_value",
                type: 19,
            },
            "คำอธิบาย"
        ),
    /cannot be updated/
);

assert.deepEqual(
    summarizeFieldUpdatePayload(primaryText, {
        field_name: "sku",
        type: 1,
        description: {
            disable_sync: false,
            text: "รหัสสินค้า",
        },
    }),
    {
        field_name: "sku",
        field_id: "fld-primary",
        type: 1,
        ui_type: null,
        payload_keys: ["description", "field_name", "type"],
        property_keys: [],
        description_shape: "object",
        description_keys: ["disable_sync", "text"],
        description_length: 10,
    }
);

assert.equal(
    summarizeFieldUpdatePayload(primaryText, {
        field_name: "sku",
        type: 1,
        description: "invalid-string",
    }).description_shape,
    "invalid"
);

console.log("PC field-description payload tests passed.");
