import { describe, expect, it } from "vitest";
import {
    PC_MATERIAL_FIELDS,
    PC_PRODUCT_FIELDS,
    PC_PRODUCTION_FIELDS,
} from "../../core/lark-fields";
import contract from "./pc-field-descriptions.json";

function values(record: Record<string, string>): string[] {
    return Object.values(record).sort();
}

describe("PC Thai field-description contract", () => {
    it("covers every field in all three Production Control tables exactly once", () => {
        const expectedByTable = new Map<string, string[]>([
            ["PC_Products", values(PC_PRODUCT_FIELDS)],
            ["PC_Materials", values(PC_MATERIAL_FIELDS)],
            ["PC_Production", values(PC_PRODUCTION_FIELDS)],
        ]);

        expect(contract.contract_version).toBe("pc_field_descriptions_v1");
        expect(contract.tables).toHaveLength(3);

        for (const table of contract.tables) {
            const expected = expectedByTable.get(table.table);
            expect(expected, `Unexpected table ${table.table}`).toBeDefined();
            const actual = table.fields
                .map((field) => field.field_name)
                .sort();

            expect(new Set(actual).size).toBe(actual.length);
            expect(actual).toEqual(expected);
        }

        expect(
            contract.tables.reduce(
                (sum, table) => sum + table.fields.length,
                0
            )
        ).toBe(55);
    });

    it("uses readable Thai descriptions and marks system-derived fields clearly", () => {
        for (const table of contract.tables) {
            expect(table.description).toMatch(/[ก-๙]/);
            for (const field of table.fields) {
                expect(field.description.trim().length).toBeGreaterThan(20);
                expect(field.description).toMatch(/[ก-๙]/);
            }
        }

        const derivedFields = new Set([
            "stock_status",
            "recommended_production_qty",
            "planned_requirement",
            "projected_stock",
            "shortage_qty",
            "material_status",
            "recommended_reorder_qty",
            "inventory_posting_state_json",
        ]);

        for (const table of contract.tables) {
            for (const field of table.fields) {
                if (derivedFields.has(field.field_name)) {
                    expect(field.description).toContain("ไม่ควรแก้ด้วยมือ");
                }
            }
        }
    });
});
