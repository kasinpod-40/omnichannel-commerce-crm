const DEFAULT_UI_TYPE_BY_FIELD_TYPE = new Map([
    [1, "Text"],
    [2, "Number"],
    [3, "SingleSelect"],
    [4, "MultiSelect"],
    [5, "DateTime"],
    [7, "Checkbox"],
    [11, "User"],
    [13, "Phone"],
    [15, "Url"],
    [17, "Attachment"],
    [18, "SingleLink"],
    [20, "Formula"],
    [21, "DuplexLink"],
    [22, "Location"],
    [23, "GroupChat"],
    [1001, "CreatedTime"],
    [1002, "ModifiedTime"],
    [1003, "CreatedUser"],
    [1004, "ModifiedUser"],
    [1005, "AutoNumber"],
]);

const NON_WRITABLE_FIELD_TYPES = new Set([19, 24, 3001]);

function isPlainObject(value) {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
    );
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

export function normalizeFieldDescription(value) {
    if (typeof value === "string") return value.trim();
    if (isPlainObject(value) && typeof value.text === "string") {
        return value.text.trim();
    }
    return "";
}

export function buildFieldUpdatePayload(field, description) {
    const type = Number(field?.type);
    const fieldName = String(field?.field_name ?? "").trim();
    const normalizedDescription = String(description ?? "").trim();

    if (!fieldName) throw new Error("Lark field_name is missing");
    if (!Number.isInteger(type)) {
        throw new Error(`Lark field ${fieldName} has invalid type`);
    }
    if (NON_WRITABLE_FIELD_TYPES.has(type)) {
        throw new Error(
            `Lark field ${fieldName} type ${type} cannot be updated through the field API`
        );
    }
    if (!normalizedDescription) {
        throw new Error(`Lark field ${fieldName} description is empty`);
    }

    const payload = {
        field_name: fieldName,
        type,
        description: normalizedDescription,
    };

    const uiType = String(field?.ui_type ?? "").trim();
    const defaultUiType = DEFAULT_UI_TYPE_BY_FIELD_TYPE.get(type);

    // Default ui_type values returned by list-fields are presentation metadata.
    // Sending them back is unnecessary and can make Lark reject an otherwise
    // valid full-update body with 1254001 WrongRequestBody.
    if (uiType && uiType !== defaultUiType) {
        payload.ui_type = uiType;
    }

    // PUT is a full field update. Preserve meaningful writable properties such
    // as formatter/options, but never send null or an empty object because Lark
    // rejects empty property bodies for basic Text/Checkbox fields.
    if (isPlainObject(field?.property)) {
        const property = cloneJson(field.property);
        if (Object.keys(property).length > 0) {
            payload.property = property;
        }
    }

    return payload;
}

export function summarizeFieldUpdatePayload(field, payload) {
    return {
        field_name: payload.field_name,
        field_id: String(field?.field_id ?? ""),
        type: payload.type,
        ui_type: payload.ui_type ?? null,
        payload_keys: Object.keys(payload).sort(),
        property_keys: payload.property
            ? Object.keys(payload.property).sort()
            : [],
        description_length: payload.description.length,
    };
}
