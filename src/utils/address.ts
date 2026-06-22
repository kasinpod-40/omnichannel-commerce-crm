const ADDRESS_PREFIX_PATTERN =
    /(?:^|\s)(?:ที่อยู่(?:สำหรับ)?(?:จัดส่ง)?|ที่จัดส่ง|จัดส่ง(?:ไป)?(?:ที่)?|ส่งของ(?:ไป)?ที่|ส่งไปที่|ส่งที่)\s*[:：=\-]?\s*/i;

export function cleanDeliveryAddress(
    value: string | null | undefined
): string {
    let normalized = (value ?? "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) {
        return "";
    }

    const match = normalized.match(
        ADDRESS_PREFIX_PATTERN
    );

    if (
        match &&
        match.index !== undefined
    ) {
        const candidate = normalized
            .slice(match.index + match[0].length)
            .trim();

        if (candidate) {
            normalized = candidate;
        }
    }

    return normalized
        .replace(/^[\s:：=\-]+/, "")
        .replace(/\s+/g, " ")
        .trim();
}
