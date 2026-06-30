import type { Env } from "../../config/env";
import {
    ACTIVITY_FIELDS,
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
    PIPELINE_FIELDS,
} from "../../core/lark-fields";
import type { AuthUserResponse } from "../auth/auth.types";
import { downloadLarkMedia } from "../../providers/lark/lark-attachment.provider";
import {
    getFirstLinkedRecordId,
    getLarkAttachmentTokens,
    getLarkBoolean,
    getLarkNumber,
    getLarkText,
} from "../../utils/lark-field-value";
import { normalizePhoneNumber } from "../../utils/phone";
import {
    findActivityByEventId,
    listActivities,
    type LarkActivityRecord,
} from "../activities/activity.repository";
import { recordActivityOnce } from "../activities/activity.service";
import { getCustomerByRecordId } from "../customers/customer.repository";
import { clearDashboardReadCache } from "../dashboard-read/dashboard-read.cache";
import { normalizeChannel, readTimestamp, toIso } from "../dashboard-read/dashboard-read.shared";
import { markPaymentReviewNotificationsRead } from "../notifications/notification-dashboard.service";
import { getOrderByRecordId, updateOrder } from "../orders/order.repository";
import { resolveOrderBusinessIdentity } from "../orders/order-business-identity";
import { getPipelineByRecordId } from "../pipeline/pipeline.repository";
import { verifyPayment } from "../../usecases/verify-payment.usecase";

export type PaymentReviewStatus =
    | "pending"
    | "approved"
    | "awaiting_delivery"
    | "rejected"
    | "unavailable";

export type PaymentReviewOutcome =
    | "SALE_COMPLETED"
    | "AWAITING_DELIVERY"
    | "REJECTED";

export type PaymentReviewAuditItem = {
    activity_id: string;
    action: string;
    actor_name: string | null;
    actor_role: string | null;
    reason: string | null;
    outcome: string | null;
    created_at: string;
};

export type PaymentReviewDetailResponse = {
    order_record_id: string;
    order_number: string;
    channel: string;
    customer: {
        customer_id: string;
        customer_name: string;
        phone: string | null;
        address: string | null;
        sales_owner: string | null;
    };
    product_name: string | null;
    quantity: number;
    total_amount: number;
    slip_amount: number;
    slip_bank: string | null;
    slip_image_url: string | null;
    has_payment_evidence: boolean;
    payment_status: string;
    order_status: string;
    pipeline_stage: string | null;
    payment_verified: boolean;
    review_status: PaymentReviewStatus;
    missing_delivery_fields: Array<"address" | "phone">;
    can_review: boolean;
    audit_history: PaymentReviewAuditItem[];
    updated_at: string;
};

export type PaymentReviewActionResult = {
    ok: true;
    duplicate: boolean;
    outcome: PaymentReviewOutcome;
    missing_delivery_fields: Array<"address" | "phone">;
    notification_records_closed: number;
    review: PaymentReviewDetailResponse;
};

export class PaymentReviewError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status: number) {
        super(message);
        this.name = "PaymentReviewError";
        this.code = code;
        this.status = status;
    }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
    const text = getLarkText(value, "").trim();
    if (!text) return {};
    try {
        const parsed = JSON.parse(text) as unknown;
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
}

function activityOrderId(record: LarkActivityRecord): string {
    const oldValue = parseJsonObject(record.fields[ACTIVITY_FIELDS.OLD_VALUE]);
    const newValue = parseJsonObject(record.fields[ACTIVITY_FIELDS.NEW_VALUE]);
    return (
        getLarkText(newValue.order_record_id, "").trim() ||
        getLarkText(oldValue.order_record_id, "").trim()
    );
}

function mapAudit(record: LarkActivityRecord): PaymentReviewAuditItem {
    const payload = parseJsonObject(record.fields[ACTIVITY_FIELDS.NEW_VALUE]);
    const createdAt = readTimestamp(record.fields[ACTIVITY_FIELDS.CREATED_AT]);
    return {
        activity_id: record.record_id,
        action: getLarkText(record.fields[ACTIVITY_FIELDS.ACTION], "").trim(),
        actor_name: getLarkText(payload.actor_name, "").trim() || null,
        actor_role: getLarkText(payload.actor_role, "").trim() || null,
        reason: getLarkText(payload.reason, "").trim() || null,
        outcome: getLarkText(payload.outcome, "").trim() || null,
        created_at: toIso(createdAt),
    };
}

function normalizeIdempotencyKey(value: string): string {
    const normalized = value.trim();
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(normalized)) {
        throw new PaymentReviewError(
            "INVALID_IDEMPOTENCY_KEY",
            "Idempotency key is invalid",
            400
        );
    }
    return normalized;
}

function getMissingDeliveryFields(address: string, phone: string): Array<"address" | "phone"> {
    const result: Array<"address" | "phone"> = [];
    if (!address.trim()) result.push("address");
    if (!normalizePhoneNumber(phone)) result.push("phone");
    return result;
}

function deriveOutcomeFromDetail(detail: PaymentReviewDetailResponse): PaymentReviewOutcome {
    if (detail.review_status === "rejected") return "REJECTED";
    return detail.missing_delivery_fields.length > 0
        ? "AWAITING_DELIVERY"
        : "SALE_COMPLETED";
}


function clearPaymentReviewDashboardCaches(): void {
    clearDashboardReadCache("dashboard-records:orders");
    clearDashboardReadCache("dashboard-records:customers");
    clearDashboardReadCache("dashboard-records:pipelines");
    clearDashboardReadCache("dashboard-records:activities");
    clearDashboardReadCache("dashboard-records:notifications");
}

function parseStoredOutcome(record: LarkActivityRecord): PaymentReviewOutcome | null {
    const payload = parseJsonObject(record.fields[ACTIVITY_FIELDS.NEW_VALUE]);
    const outcome = getLarkText(payload.outcome, "").trim();
    return outcome === "SALE_COMPLETED" ||
        outcome === "AWAITING_DELIVERY" ||
        outcome === "REJECTED"
        ? outcome
        : null;
}

async function loadOrderRelations(env: Env, orderRecordId: string) {
    const order = await getOrderByRecordId(env, orderRecordId);
    if (!order) {
        throw new PaymentReviewError("ORDER_NOT_FOUND", "Order was not found", 404);
    }

    const customerRecordId = getFirstLinkedRecordId(order.fields[ORDER_FIELDS.CUSTOMER]);
    const pipelineRecordId = getFirstLinkedRecordId(order.fields[ORDER_FIELDS.PIPELINE]);
    const [customer, pipeline] = await Promise.all([
        customerRecordId ? getCustomerByRecordId(env, customerRecordId) : Promise.resolve(null),
        pipelineRecordId ? getPipelineByRecordId(env, pipelineRecordId) : Promise.resolve(null),
    ]);

    if (!customerRecordId || !customer) {
        throw new PaymentReviewError(
            "ORDER_CUSTOMER_NOT_FOUND",
            "Order customer was not found",
            409
        );
    }

    return { order, customer, pipeline, customerRecordId, pipelineRecordId };
}

export async function getPaymentReviewDetail(
    env: Env,
    orderRecordId: string
): Promise<PaymentReviewDetailResponse> {
    const relations = await loadOrderRelations(env, orderRecordId.trim());
    const { order, customer, pipeline } = relations;
    const orderFields = order.fields;
    const customerFields = customer.fields;
    const activities = (await listActivities(env))
        .filter((record) => activityOrderId(record) === order.record_id)
        .sort(
            (left, right) =>
                readTimestamp(right.fields[ACTIVITY_FIELDS.CREATED_AT]) -
                readTimestamp(left.fields[ACTIVITY_FIELDS.CREATED_AT])
        );
    const latestRejectedAt = activities
        .filter(
            (record) =>
                getLarkText(record.fields[ACTIVITY_FIELDS.ACTION], "").trim() ===
                "PAYMENT_REVIEW_REJECTED"
        )
        .map((record) => readTimestamp(record.fields[ACTIVITY_FIELDS.CREATED_AT]))
        .at(0) ?? 0;
    const latestSlipAt = activities
        .filter(
            (record) =>
                getLarkText(record.fields[ACTIVITY_FIELDS.ACTION], "").trim() ===
                "PAYMENT_SLIP_RECEIVED"
        )
        .map((record) => readTimestamp(record.fields[ACTIVITY_FIELDS.CREATED_AT]))
        .at(0) ?? 0;
    const paymentStatus = getLarkText(orderFields[ORDER_FIELDS.PAYMENT_STATUS], "").trim();
    const orderStatus = getLarkText(orderFields[ORDER_FIELDS.ORDER_STATUS], "").trim();
    const paymentVerified = getLarkBoolean(
        orderFields[ORDER_FIELDS.PAYMENT_VERIFIED],
        false
    );
    const attachmentTokens = getLarkAttachmentTokens(
        orderFields[ORDER_FIELDS.SLIP_ATTACHMENT]
    );
    const rawImageUrl = getLarkText(orderFields[ORDER_FIELDS.SLIP_IMAGE_URL], "").trim();
    const hasPaymentEvidence =
        attachmentTokens.length > 0 ||
        Boolean(rawImageUrl) ||
        getLarkNumber(orderFields[ORDER_FIELDS.SLIP_AMOUNT], 0) > 0 ||
        Boolean(getLarkText(orderFields[ORDER_FIELDS.SLIP_BANK], "").trim());
    const address = getLarkText(orderFields[ORDER_FIELDS.ADDRESS], "").trim();
    const phone =
        getLarkText(orderFields[ORDER_FIELDS.PHONE], "").trim() ||
        getLarkText(customerFields[CUSTOMER_FIELDS.PHONE], "").trim();
    const missingDeliveryFields = getMissingDeliveryFields(address, phone);
    const normalizedPaymentStatus = paymentStatus.toLowerCase();
    const normalizedOrderStatus = orderStatus.toLowerCase();
    let reviewStatus: PaymentReviewStatus = "unavailable";

    if (paymentVerified && normalizedPaymentStatus === "paid") {
        reviewStatus = missingDeliveryFields.length > 0
            ? "awaiting_delivery"
            : "approved";
    } else if (
        normalizedPaymentStatus === "payment review" ||
        normalizedOrderStatus === "payment review"
    ) {
        reviewStatus = "pending";
    } else if (latestRejectedAt > 0 && latestRejectedAt >= latestSlipAt) {
        reviewStatus = "rejected";
    }

    const updatedAt = readTimestamp(orderFields[ORDER_FIELDS.UPDATED_AT]);

    return {
        order_record_id: order.record_id,
        order_number: resolveOrderBusinessIdentity(
            orderFields,
            getLarkText(orderFields[ORDER_FIELDS.CHANNEL], "LINE")
        ).displayOrderNumber || "-",
        channel: normalizeChannel(orderFields[ORDER_FIELDS.CHANNEL]),
        customer: {
            customer_id: customer.record_id,
            customer_name:
                getLarkText(orderFields[ORDER_FIELDS.CUSTOMER_NAME], "").trim() ||
                getLarkText(customerFields[CUSTOMER_FIELDS.CUSTOMER_NAME], "").trim() ||
                "ไม่ทราบชื่อลูกค้า",
            phone: phone || null,
            address: address || null,
            sales_owner:
                getLarkText(orderFields[ORDER_FIELDS.SALES_OWNER], "").trim() ||
                getLarkText(customerFields[CUSTOMER_FIELDS.SALES_OWNER], "").trim() ||
                null,
        },
        product_name: getLarkText(orderFields[ORDER_FIELDS.PRODUCT_NAME], "").trim() || null,
        quantity: Math.max(0, getLarkNumber(orderFields[ORDER_FIELDS.QUANTITY], 0)),
        total_amount: Math.max(0, getLarkNumber(orderFields[ORDER_FIELDS.TOTAL_AMOUNT], 0)),
        slip_amount: Math.max(0, getLarkNumber(orderFields[ORDER_FIELDS.SLIP_AMOUNT], 0)),
        slip_bank: getLarkText(orderFields[ORDER_FIELDS.SLIP_BANK], "").trim() || null,
        slip_image_url: hasPaymentEvidence
            ? `/payment-reviews/${encodeURIComponent(order.record_id)}/image`
            : null,
        has_payment_evidence: hasPaymentEvidence,
        payment_status: paymentStatus,
        order_status: orderStatus,
        pipeline_stage: pipeline
            ? getLarkText(pipeline.fields[PIPELINE_FIELDS.STAGE], "").trim() || null
            : null,
        payment_verified: paymentVerified,
        review_status: reviewStatus,
        missing_delivery_fields: missingDeliveryFields,
        can_review: reviewStatus === "pending" && hasPaymentEvidence,
        audit_history: activities
            .filter((record) =>
                [
                    "PAYMENT_SLIP_RECEIVED",
                    "PAYMENT_REVIEW_APPROVED",
                    "PAYMENT_REVIEW_REJECTED",
                    "PAYMENT_VERIFIED",
                    "SALE_WON",
                ].includes(getLarkText(record.fields[ACTIVITY_FIELDS.ACTION], "").trim())
            )
            .slice(0, 20)
            .map(mapAudit),
        updated_at: toIso(updatedAt),
    };
}

export async function approvePaymentReview(
    env: Env,
    input: {
        order_record_id: string;
        idempotency_key: string;
        actor: AuthUserResponse;
    }
): Promise<PaymentReviewActionResult> {
    const orderRecordId = input.order_record_id.trim();
    const key = normalizeIdempotencyKey(input.idempotency_key);
    const eventId = `PAYMENT_REVIEW_APPROVED:${orderRecordId}:${key}`;
    const duplicateActivity = await findActivityByEventId(env, eventId);

    if (duplicateActivity) {
        const notificationRecordsClosed = await markPaymentReviewNotificationsRead(
            env,
            orderRecordId
        );
        const review = await getPaymentReviewDetail(env, orderRecordId);
        return {
            ok: true,
            duplicate: true,
            outcome: parseStoredOutcome(duplicateActivity) ?? deriveOutcomeFromDetail(review),
            missing_delivery_fields: review.missing_delivery_fields,
            notification_records_closed: notificationRecordsClosed,
            review,
        };
    }

    const before = await getPaymentReviewDetail(env, orderRecordId);
    if (before.review_status === "approved" || before.review_status === "awaiting_delivery") {
        const notificationRecordsClosed = await markPaymentReviewNotificationsRead(
            env,
            orderRecordId
        );
        return {
            ok: true,
            duplicate: true,
            outcome: deriveOutcomeFromDetail(before),
            missing_delivery_fields: before.missing_delivery_fields,
            notification_records_closed: notificationRecordsClosed,
            review: before,
        };
    }
    if (!before.can_review) {
        throw new PaymentReviewError(
            "PAYMENT_REVIEW_NOT_ACTIONABLE",
            "Payment review is not actionable",
            409
        );
    }

    const result = await verifyPayment(env, { order_record_id: orderRecordId });
    if (!result.ok) {
        throw new PaymentReviewError(result.code, result.message, 409);
    }
    clearPaymentReviewDashboardCaches();

    const outcome: PaymentReviewOutcome =
        result.waiting_address || result.waiting_phone
            ? "AWAITING_DELIVERY"
            : "SALE_COMPLETED";

    await recordActivityOnce(env, {
        event_id: eventId,
        customer_record_id: result.customer.record_id,
        action: "PAYMENT_REVIEW_APPROVED",
        old_value: {
            order_record_id: orderRecordId,
            review_status: before.review_status,
            payment_status: before.payment_status,
            order_status: before.order_status,
        },
        new_value: {
            order_record_id: orderRecordId,
            actor_user_id: input.actor.user_id,
            actor_open_id: input.actor.lark_open_id,
            actor_name: input.actor.name,
            actor_role: input.actor.role,
            outcome,
            missing_delivery_fields: [
                ...(result.waiting_address ? ["address"] : []),
                ...(result.waiting_phone ? ["phone"] : []),
            ],
            already_verified: result.already_verified,
        },
    });

    const notificationRecordsClosed = await markPaymentReviewNotificationsRead(
        env,
        orderRecordId
    );
    clearPaymentReviewDashboardCaches();
    const review = await getPaymentReviewDetail(env, orderRecordId);

    return {
        ok: true,
        duplicate: false,
        outcome,
        missing_delivery_fields: review.missing_delivery_fields,
        notification_records_closed: notificationRecordsClosed,
        review,
    };
}

export async function rejectPaymentReview(
    env: Env,
    input: {
        order_record_id: string;
        idempotency_key: string;
        reason: string;
        actor: AuthUserResponse;
    }
): Promise<PaymentReviewActionResult> {
    const orderRecordId = input.order_record_id.trim();
    const key = normalizeIdempotencyKey(input.idempotency_key);
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
        throw new PaymentReviewError(
            "PAYMENT_REJECT_REASON_INVALID",
            "Reject reason must contain 3 to 500 characters",
            400
        );
    }
    const eventId = `PAYMENT_REVIEW_REJECTED:${orderRecordId}:${key}`;
    const duplicateActivity = await findActivityByEventId(env, eventId);

    if (duplicateActivity) {
        const notificationRecordsClosed = await markPaymentReviewNotificationsRead(
            env,
            orderRecordId
        );
        const review = await getPaymentReviewDetail(env, orderRecordId);
        return {
            ok: true,
            duplicate: true,
            outcome: "REJECTED",
            missing_delivery_fields: review.missing_delivery_fields,
            notification_records_closed: notificationRecordsClosed,
            review,
        };
    }

    const relations = await loadOrderRelations(env, orderRecordId);
    const before = await getPaymentReviewDetail(env, orderRecordId);
    if (before.review_status === "rejected") {
        const notificationRecordsClosed = await markPaymentReviewNotificationsRead(
            env,
            orderRecordId
        );
        return {
            ok: true,
            duplicate: true,
            outcome: "REJECTED",
            missing_delivery_fields: before.missing_delivery_fields,
            notification_records_closed: notificationRecordsClosed,
            review: before,
        };
    }
    if (before.payment_verified || before.payment_status.trim().toLowerCase() === "paid") {
        throw new PaymentReviewError(
            "PAYMENT_ALREADY_VERIFIED",
            "Verified payment cannot be rejected",
            409
        );
    }
    if (!before.can_review) {
        throw new PaymentReviewError(
            "PAYMENT_REVIEW_NOT_ACTIONABLE",
            "Payment review is not actionable",
            409
        );
    }

    await updateOrder(env, orderRecordId, {
        payment_status: "Waiting Payment",
        order_status: "Waiting Payment",
        payment_verified: false,
        slip_amount: 0,
        slip_bank: "",
        slip_image_url: "",
        slip_attachment_tokens: [],
    });
    clearPaymentReviewDashboardCaches();

    await recordActivityOnce(env, {
        event_id: eventId,
        customer_record_id: relations.customerRecordId,
        action: "PAYMENT_REVIEW_REJECTED",
        old_value: {
            order_record_id: orderRecordId,
            review_status: before.review_status,
            payment_status: before.payment_status,
            order_status: before.order_status,
            slip_amount: before.slip_amount,
            slip_bank: before.slip_bank,
        },
        new_value: {
            order_record_id: orderRecordId,
            actor_user_id: input.actor.user_id,
            actor_open_id: input.actor.lark_open_id,
            actor_name: input.actor.name,
            actor_role: input.actor.role,
            reason,
            outcome: "REJECTED",
            payment_status: "Waiting Payment",
            order_status: "Waiting Payment",
        },
    });

    const notificationRecordsClosed = await markPaymentReviewNotificationsRead(
        env,
        orderRecordId
    );
    clearPaymentReviewDashboardCaches();
    const review = await getPaymentReviewDetail(env, orderRecordId);

    return {
        ok: true,
        duplicate: false,
        outcome: "REJECTED",
        missing_delivery_fields: review.missing_delivery_fields,
        notification_records_closed: notificationRecordsClosed,
        review,
    };
}

const PAYMENT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const PAYMENT_IMAGE_MAX_REDIRECTS = 3;
const PAYMENT_IMAGE_FETCH_TIMEOUT_MS = 10_000;

function isSafeRemoteImageUrl(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl);
        const hostname = url.hostname.toLowerCase();
        const hostAddress = hostname.replace(/^\[|\]$/g, "");
        if (url.protocol !== "https:") return false;
        if (
            hostname === "localhost" ||
            hostname.endsWith(".localhost") ||
            hostname.endsWith(".local") ||
            hostAddress === "0.0.0.0" ||
            hostAddress === "::" ||
            hostAddress === "::1"
        ) {
            return false;
        }
        if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(hostAddress)) {
            return false;
        }
        const private172 = hostAddress.match(/^172\.(\d+)\./);
        if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) {
            return false;
        }
        if (
            hostAddress.startsWith("fc") ||
            hostAddress.startsWith("fd") ||
            hostAddress.startsWith("fe8") ||
            hostAddress.startsWith("fe9") ||
            hostAddress.startsWith("fea") ||
            hostAddress.startsWith("feb") ||
            hostAddress.startsWith("::ffff:127.") ||
            hostAddress.startsWith("::ffff:10.") ||
            hostAddress.startsWith("::ffff:192.168.") ||
            hostAddress.startsWith("::ffff:169.254.")
        ) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

async function fetchSafeRemoteImage(rawUrl: string): Promise<Response | null> {
    let currentUrl = rawUrl;

    for (let redirectCount = 0; redirectCount <= PAYMENT_IMAGE_MAX_REDIRECTS; redirectCount += 1) {
        if (!isSafeRemoteImageUrl(currentUrl)) return null;

        const response = await fetch(currentUrl, {
            headers: { Accept: "image/*" },
            redirect: "manual",
            signal: AbortSignal.timeout(PAYMENT_IMAGE_FETCH_TIMEOUT_MS),
        });

        if (![301, 302, 303, 307, 308].includes(response.status)) {
            return response;
        }

        if (redirectCount === PAYMENT_IMAGE_MAX_REDIRECTS) return null;
        const location = response.headers.get("location");
        if (!location) return null;

        try {
            currentUrl = new URL(location, currentUrl).toString();
        } catch {
            return null;
        }
    }

    return null;
}

export async function getPaymentReviewImage(
    env: Env,
    orderRecordId: string
): Promise<{ bytes: ArrayBuffer; mime_type: string } | null> {
    const order = await getOrderByRecordId(env, orderRecordId.trim());
    if (!order) return null;

    const attachmentToken = getLarkAttachmentTokens(
        order.fields[ORDER_FIELDS.SLIP_ATTACHMENT]
    )[0];
    if (attachmentToken) {
        const media = await downloadLarkMedia(env, attachmentToken);
        if (!media.mime_type.toLowerCase().startsWith("image/")) {
            throw new PaymentReviewError(
                "PAYMENT_SLIP_INVALID_MEDIA",
                "Payment evidence is not an image",
                422
            );
        }
        return { bytes: media.bytes, mime_type: media.mime_type };
    }

    const imageUrl = getLarkText(order.fields[ORDER_FIELDS.SLIP_IMAGE_URL], "").trim();
    if (!imageUrl || !isSafeRemoteImageUrl(imageUrl)) return null;

    const response = await fetchSafeRemoteImage(imageUrl);
    if (!response?.ok) return null;
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!mimeType.toLowerCase().startsWith("image/")) return null;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > PAYMENT_IMAGE_MAX_BYTES) {
        throw new PaymentReviewError(
            "PAYMENT_SLIP_TOO_LARGE",
            "Payment evidence exceeds 20 MB",
            413
        );
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > PAYMENT_IMAGE_MAX_BYTES) return null;
    return { bytes, mime_type: mimeType };
}
