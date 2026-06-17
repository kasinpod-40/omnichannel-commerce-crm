type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

export function getLarkText(
    value: unknown,
    fallback = ""
): string {
    if (value === null || value === undefined) {
        return fallback;
    }

    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return String(value);
    }

    if (Array.isArray(value)) {
        const texts = value
            .map((item) => getLarkText(item, ""))
            .filter((text) => text.length > 0);

        return texts.length > 0 ? texts.join("") : fallback;
    }

    if (isRecord(value)) {
        if (typeof value.text === "string") {
            return value.text;
        }

        if (Array.isArray(value.text_arr)) {
            const texts = value.text_arr.filter(
                (item): item is string => typeof item === "string"
            );

            return texts.length > 0 ? texts.join("") : fallback;
        }

        if (Array.isArray(value.value)) {
            return getLarkText(value.value, fallback);
        }
    }

    return fallback;
}

export function getLarkNumber(
    value: unknown,
    fallback = 0
): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    const text = getLarkText(value, "");

    if (!text) {
        return fallback;
    }

    const parsed = Number(text);

    return Number.isFinite(parsed) ? parsed : fallback;
}

export function getLarkBoolean(
    value: unknown,
    fallback = false
): boolean {
    if (typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        return value !== 0;
    }

    const text = getLarkText(value, "").toLowerCase();

    if (["true", "1", "yes"].includes(text)) {
        return true;
    }

    if (["false", "0", "no"].includes(text)) {
        return false;
    }

    return fallback;
}

export function getFirstLinkedRecordId(
    value: unknown
): string | null {
    if (!value) {
        return null;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return null;
        }

        const first = value[0];

        if (typeof first === "string") {
            return first;
        }

        if (isRecord(first)) {
            if (typeof first.record_id === "string") {
                return first.record_id;
            }

            if (typeof first.id === "string") {
                return first.id;
            }

            if (Array.isArray(first.record_ids)) {
                const firstRecordId = first.record_ids[0];

                return typeof firstRecordId === "string"
                    ? firstRecordId
                    : null;
            }
        }

        return null;
    }

    if (isRecord(value)) {
        if (Array.isArray(value.link_record_ids)) {
            const firstRecordId = value.link_record_ids[0];

            return typeof firstRecordId === "string"
                ? firstRecordId
                : null;
        }

        if (Array.isArray(value.record_ids)) {
            const firstRecordId = value.record_ids[0];

            return typeof firstRecordId === "string"
                ? firstRecordId
                : null;
        }

        if (typeof value.record_id === "string") {
            return value.record_id;
        }

        if (typeof value.id === "string") {
            return value.id;
        }

        if (Array.isArray(value.value)) {
            return getFirstLinkedRecordId(value.value);
        }
    }

    return null;
}