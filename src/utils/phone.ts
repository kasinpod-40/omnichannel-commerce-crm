const THAI_DIGIT_MAP: Record<string, string> = {
    "๐": "0",
    "๑": "1",
    "๒": "2",
    "๓": "3",
    "๔": "4",
    "๕": "5",
    "๖": "6",
    "๗": "7",
    "๘": "8",
    "๙": "9",
};

function toArabicDigits(value: string): string {
    return value.replace(/[๐-๙]/g, (digit) =>
        THAI_DIGIT_MAP[digit] ?? digit
    );
}

function createPhoneCandidatePattern(): RegExp {
    return /(?<!\d)(?:(?:\+?66|0066)(?:[\s().-]*0)?(?:[\s().-]*\d){9}|0[1-9](?:[\s().-]*\d){7,8})(?!\d)/g;
}

/**
 * Normalize a Thai telephone number for storage.
 *
 * Examples:
 * - 081-234-5678 -> 0812345678
 * - +66 81 234 5678 -> 0812345678
 * - 02-123-4567 -> 021234567
 */
export function normalizePhoneNumber(
    value: string | null | undefined
): string | undefined {
    if (!value) {
        return undefined;
    }

    const digits = toArabicDigits(value).replace(/\D/g, "");

    if (!digits) {
        return undefined;
    }

    let normalized = digits;

    if (normalized.startsWith("0066")) {
        if (
            normalized.length !== 13 &&
            normalized.length !== 14
        ) {
            return undefined;
        }

        const subscriber = normalized.slice(4);
        normalized = subscriber.startsWith("0")
            ? subscriber
            : `0${subscriber}`;
    } else if (normalized.startsWith("66")) {
        if (
            normalized.length !== 11 &&
            normalized.length !== 12
        ) {
            return undefined;
        }

        const subscriber = normalized.slice(2);
        normalized = subscriber.startsWith("0")
            ? subscriber
            : `0${subscriber}`;
    }

    // Thai fixed-line numbers normally contain 9 digits and mobile
    // numbers normally contain 10 digits. Keep validation permissive
    // enough for future prefixes, while still rejecting postal codes,
    // order numbers, and other short numeric values.
    if (!/^0[1-9]\d{7,8}$/.test(normalized)) {
        return undefined;
    }

    return normalized;
}

/** Extract the first valid Thai phone number from free-form text. */
export function extractPhoneNumber(
    text: string | null | undefined
): string | undefined {
    if (!text) {
        return undefined;
    }

    const normalizedText = toArabicDigits(text);
    const matches = normalizedText.matchAll(
        createPhoneCandidatePattern()
    );

    for (const match of matches) {
        const phone = normalizePhoneNumber(match[0]);

        if (phone) {
            return phone;
        }
    }

    return undefined;
}

/**
 * Remove valid Thai phone-number candidates from a message without
 * touching house numbers, quantities, postal codes, or order numbers.
 */
export function removePhoneNumbers(text: string): string {
    const normalizedText = toArabicDigits(text);

    return normalizedText
        .replace(createPhoneCandidatePattern(), (candidate) =>
            normalizePhoneNumber(candidate) ? " " : candidate
        )
        .replace(/\s+/g, " ")
        .trim();
}
