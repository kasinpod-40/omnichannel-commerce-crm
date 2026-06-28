/**
 * Canonical sales-stage definitions shared by AI, Customer, Pipeline, and Dashboard layers.
 * Keeping values and ranking here prevents silent drift between read/write paths.
 */

export const SALES_STAGE_VALUES = [
    "New Lead",
    "Interested",
    "Negotiating",
    "Closing",
    "Won",
    "Lost",
] as const;

export type SalesStage = (typeof SALES_STAGE_VALUES)[number];
export type OpenSalesStage = Exclude<SalesStage, "Won" | "Lost">;
export type ClosedSalesStage = Extract<SalesStage, "Won" | "Lost">;
export type SalesPipelineStatus = "open" | "won" | "lost";

export const OPEN_SALES_STAGE_VALUES = SALES_STAGE_VALUES.slice(0, 4) as readonly OpenSalesStage[];
export const CLOSED_SALES_STAGE_VALUES = SALES_STAGE_VALUES.slice(4) as readonly ClosedSalesStage[];
export const DEFAULT_OPEN_SALES_STAGE: OpenSalesStage = "New Lead";

export const SALES_STAGE_RANK: Record<SalesStage, number> = {
    "New Lead": 0,
    Interested: 1,
    Negotiating: 2,
    Closing: 3,
    Won: 4,
    Lost: 4,
};

const SALES_STAGE_SET = new Set<string>(SALES_STAGE_VALUES);
const OPEN_SALES_STAGE_SET = new Set<string>(OPEN_SALES_STAGE_VALUES);
const CLOSED_SALES_STAGE_SET = new Set<string>(CLOSED_SALES_STAGE_VALUES);

export function isSalesStage(value: unknown): value is SalesStage {
    return typeof value === "string" && SALES_STAGE_SET.has(value);
}

export function isOpenSalesStage(value: unknown): value is OpenSalesStage {
    return typeof value === "string" && OPEN_SALES_STAGE_SET.has(value);
}

export function isClosedSalesStage(value: unknown): value is ClosedSalesStage {
    return typeof value === "string" && CLOSED_SALES_STAGE_SET.has(value);
}

export function normalizeOpenSalesStage(
    value: unknown,
    fallback: OpenSalesStage = DEFAULT_OPEN_SALES_STAGE
): OpenSalesStage {
    return isOpenSalesStage(value) ? value : fallback;
}

/**
 * Normalize persisted Pipeline stage values at every read boundary.
 * Closed status is authoritative; open records may only expose an active stage.
 */
export function resolvePipelineStage(
    status: SalesPipelineStatus,
    value: unknown
): SalesStage {
    if (status === "won") return "Won";
    if (status === "lost") return "Lost";

    return normalizeOpenSalesStage(value);
}
