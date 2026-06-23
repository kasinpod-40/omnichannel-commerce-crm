export function text(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }

    if (typeof value === "number" || typeof value === "bigint") {
        return String(value);
    }

    return "";
}

export function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

export function firstText(...values: unknown[]): string {
    for (const value of values) {
        const normalized = text(value);

        if (normalized) {
            return normalized;
        }
    }

    return "";
}

export function booleanValue(value: unknown): boolean {
    return value === true || text(value).toLowerCase() === "true";
}

export function numberValue(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}
