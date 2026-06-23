import type {
    MarketplaceChannel,
    MarketplaceStatusMapping,
} from "./marketplace.types";

function normalize(value: string | undefined): string {
    return (value ?? "")
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, "_");
}

function paymentMapping(
    orderStatus: string,
    paymentStatus: string
): { payment_status: MarketplaceStatusMapping["payment_status"]; payment_verified: boolean } {
    const refunded =
        paymentStatus.includes("REFUND") ||
        paymentStatus.includes("CHARGEBACK") ||
        orderStatus.includes("RETURN") ||
        orderStatus.includes("REVERSE");
    const failed =
        paymentStatus.includes("FAIL") ||
        paymentStatus.includes("DECLIN") ||
        paymentStatus.includes("EXPIRED");
    const unpaid =
        orderStatus === "UNPAID" ||
        orderStatus === "WAITING_PAYMENT" ||
        paymentStatus === "UNPAID" ||
        paymentStatus === "PENDING" ||
        paymentStatus === "WAITING_PAYMENT";

    if (refunded) {
        return { payment_status: "Refunded", payment_verified: false };
    }

    if (failed) {
        return { payment_status: "Failed", payment_verified: false };
    }

    if (unpaid) {
        return { payment_status: "Waiting Payment", payment_verified: false };
    }

    return { payment_status: "Paid", payment_verified: true };
}

function orderStatusForShopee(status: string): MarketplaceStatusMapping["order_status"] {
    if (["TO_RETURN", "RETURNED", "RETURN_REFUND", "REFUND"].includes(status)) {
        return "Returned";
    }

    if (["IN_CANCEL", "CANCELLED", "CANCELED"].includes(status)) {
        return "Cancelled";
    }

    if (["COMPLETED", "DELIVERED"].includes(status)) {
        return "Completed";
    }

    if (["SHIPPED", "IN_TRANSIT", "LOGISTICS"].includes(status)) {
        return "Shipped";
    }

    if (["READY_TO_SHIP", "PROCESSED", "TO_SHIP"].includes(status)) {
        return "Ready to Ship";
    }

    if (status === "UNPAID" || status === "WAITING_PAYMENT") {
        return "Waiting Payment";
    }

    return "Processing";
}

function orderStatusForLazada(status: string): MarketplaceStatusMapping["order_status"] {
    if (
        status.includes("RETURN") ||
        status.includes("REFUND") ||
        status.includes("REVERSE")
    ) {
        return "Returned";
    }

    if (["CANCELED", "CANCELLED", "FAILED"].includes(status)) {
        return "Cancelled";
    }

    if (["DELIVERED", "CONFIRMED", "COMPLETED"].includes(status)) {
        return "Completed";
    }

    if (["SHIPPED", "SHIPPING", "IN_TRANSIT"].includes(status)) {
        return "Shipped";
    }

    if (
        [
            "PACKED",
            "READY_TO_SHIP",
            "READY_TO_SHIP_PENDING",
            "TO_SHIP",
        ].includes(status)
    ) {
        return "Ready to Ship";
    }

    if (status === "UNPAID" || status === "WAITING_PAYMENT") {
        return "Waiting Payment";
    }

    return "Processing";
}

function orderStatusForTikTok(status: string): MarketplaceStatusMapping["order_status"] {
    if (
        status.includes("RETURN") ||
        status.includes("REFUND")
    ) {
        return "Returned";
    }

    if (["CANCELLED", "CANCELED"].includes(status)) {
        return "Cancelled";
    }

    if (["COMPLETED", "DELIVERED"].includes(status)) {
        return "Completed";
    }

    if (
        [
            "PARTIALLY_SHIPPING",
            "IN_TRANSIT",
            "SHIPPED",
        ].includes(status)
    ) {
        return "Shipped";
    }

    if (
        [
            "AWAITING_SHIPMENT",
            "AWAITING_COLLECTION",
            "READY_TO_SHIP",
            "TO_SHIP",
        ].includes(status)
    ) {
        return "Ready to Ship";
    }

    if (status === "UNPAID" || status === "WAITING_PAYMENT") {
        return "Waiting Payment";
    }

    return "Processing";
}

export function mapMarketplaceStatus(
    channel: MarketplaceChannel,
    marketplaceStatus: string,
    marketplacePaymentStatus?: string
): MarketplaceStatusMapping {
    const status = normalize(marketplaceStatus);
    const payment = normalize(marketplacePaymentStatus);
    const paymentResult = paymentMapping(status, payment);
    const orderStatus =
        channel === "Shopee"
            ? orderStatusForShopee(status)
            : channel === "Lazada"
              ? orderStatusForLazada(status)
              : orderStatusForTikTok(status);

    if (orderStatus === "Returned") {
        return {
            order_status: orderStatus,
            payment_status: "Refunded",
            payment_verified: false,
        };
    }

    if (orderStatus === "Cancelled") {
        return {
            order_status: orderStatus,
            payment_status: paymentResult.payment_status,
            payment_verified: false,
        };
    }

    return {
        order_status: orderStatus,
        payment_status: paymentResult.payment_status,
        payment_verified: paymentResult.payment_verified,
    };
}
