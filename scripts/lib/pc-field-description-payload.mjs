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

function descriptionSegmentText(value) {
    if (typeof value === "string") return value;
    if (isPlainObject(value) && typeof value.text === "string") {
        return value.text;
    }
    return "";
}

export function normalizeFieldDescription(value) {
    if (Array.isArray(value)) {
        return value.map(descriptionSegmentText).join("").trim();
    }
    return descriptionSegmentText(value).trim();
}

export function buildFieldDescription(description) {
    const text = normalizeFieldDescription(description);
    if (!text) throw new Error("Lark field description is empty");

    // Lark's field-editing contract defines description as
    // app.table.field.description, not a raw string.
    return {
        disable_sync: false,
        text,
    };
}

export function buildFieldUpdatePayload(field, description) {
    const type = Number(field?.type);
    const fieldName = String(field?.field_name ?? "").trim();

    if (!fieldName) throw new Error("Lark field_name is missing");
    if (!Number.isInteger(type)) {
        throw new Error(`Lark field ${fieldName} has invalid type`);
    }
    if (NON_WRITABLE_FIELD_TYPES.has(type)) {
        throw new Error(
            `Lark field ${fieldName} type ${type} cannot be updated through the field API`
        );
    }

    const payload = {
        field_name: fieldName,
        type,
        description: buildFieldDescription(description),
    };

    const uiType = String(field?.ui_type ?? "").trim();
    const defaultUiType = DEFAULT_UI_TYPE_BY_FIELD_TYPE.get(type);

    // Default ui_type values returned by list-fields are presentation metadata.
    // Sending them back is unnecessary and can make Lark reject an otherwise
    // valid full-update body.
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
    const description = payload?.description;
    const descriptionText = isPlainObject(description)
        ? String(description.text ?? "")
        : "";

    return {
        field_name: payload.field_name,
        field_id: String(field?.field_id ?? ""),
        type: payload.type,
        ui_type: payload.ui_type ?? null,
        payload_keys: Object.keys(payload).sort(),
        property_keys: payload.property
            ? Object.keys(payload.property).sort()
            : [],
        description_shape:
            isPlainObject(description) &&
            typeof description.text === "string" &&
            typeof description.disable_sync === "boolean"
                ? "object"
                : "invalid",
        description_keys: isPlainObject(description)
            ? Object.keys(description).sort()
            : [],
        description_length: descriptionText.length,
    };
}
