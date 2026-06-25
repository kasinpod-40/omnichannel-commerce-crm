export type ErrorClassification = {
    code: string;
    message: string;
    retryable: boolean;
    status?: number;
};

export class OperationalError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    readonly status?: number;
    readonly cause?: unknown;

    constructor(
        code: string,
        message: string,
        options: {
            retryable: boolean;
            status?: number;
            cause?: unknown;
        }
    ) {
        super(message);
        this.name = "OperationalError";
        this.code = code;
        this.retryable = options.retryable;
        this.status = options.status;
        this.cause = options.cause;
    }
}

const TRANSIENT_STATUS_CODES = new Set([
    408,
    409,
    425,
    429,
    500,
    502,
    503,
    504,
]);

const PERMANENT_STATUS_CODES = new Set([
    400,
    401,
    403,
    404,
    405,
    409,
    410,
    413,
    415,
    422,
]);

function extractStatus(message: string): number | undefined {
    const explicit = message.match(
        /(?:status|http|failed:?)\s*[=:]?\s*(\d{3})/i
    );

    if (explicit?.[1]) {
        return Number(explicit[1]);
    }

    const standalone = message.match(/\b(4\d{2}|5\d{2})\b/);
    return standalone?.[1]
        ? Number(standalone[1])
        : undefined;
}

export function classifyOperationalError(
    error: unknown
): ErrorClassification {
    if (error instanceof OperationalError) {
        return {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            status: error.status,
        };
    }

    const message =
        error instanceof Error
            ? error.message
            : String(error);
    const normalized = message.toLowerCase();
    const status = extractStatus(message);

    if (
        normalized.includes("pipeline_invariant_") ||
        normalized.includes("order_invariant_") ||
        normalized.includes("not_persisted") ||
        normalized.includes("invalid json") ||
        normalized.includes("invalid workflow token") ||
        normalized.includes("not configured") ||
        normalized.includes("permission") ||
        normalized.includes("fieldnamenotfound") ||
        normalized.includes("field name not found") ||
        normalized.includes("fieldconvfail") ||
        normalized.includes("failed to convert phone field") ||
        normalized.includes("unsupported image") ||
        normalized.includes("image is empty") ||
        normalized.includes("image is too large") ||
        normalized.includes("payload") && normalized.includes("invalid")
    ) {
        return {
            code: "PERMANENT_PROCESSING_ERROR",
            message,
            retryable: false,
            status,
        };
    }

    if (
        normalized.includes("timeout") ||
        normalized.includes("timed out") ||
        normalized.includes("network") ||
        normalized.includes("fetch failed") ||
        normalized.includes("econnreset") ||
        normalized.includes("econnrefused") ||
        normalized.includes("socket hang up") ||
        normalized.includes("rate limit") ||
        normalized.includes("too many requests") ||
        normalized.includes("unavailable") ||
        normalized.includes("high demand") ||
        normalized.includes("temporarily") ||
        (status !== undefined && TRANSIENT_STATUS_CODES.has(status))
    ) {
        return {
            code: "TRANSIENT_INTEGRATION_ERROR",
            message,
            retryable: true,
            status,
        };
    }

    if (
        status !== undefined &&
        PERMANENT_STATUS_CODES.has(status)
    ) {
        return {
            code: "PERMANENT_HTTP_ERROR",
            message,
            retryable: false,
            status,
        };
    }

    // Unknown runtime failures are retried a bounded number of times and
    // then moved to the configured DLQ. This is safer than silently losing
    // an event that may have failed because of a temporary dependency issue.
    return {
        code: "UNKNOWN_PROCESSING_ERROR",
        message,
        retryable: true,
        status,
    };
}

export function createHttpOperationalError(
    service: string,
    operation: string,
    status: number,
    responseBody: string
): OperationalError {
    const retryable = TRANSIENT_STATUS_CODES.has(status);
    const normalizedService = service
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    const normalizedOperation = operation
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    const code = `${normalizedService}_${normalizedOperation}_${status}`;

    return new OperationalError(
        code,
        `${service} ${operation} failed: ${status} ${responseBody}`.slice(
            0,
            1400
        ),
        {
            retryable,
            status,
        }
    );
}

export function toErrorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message
        : String(error);
}
