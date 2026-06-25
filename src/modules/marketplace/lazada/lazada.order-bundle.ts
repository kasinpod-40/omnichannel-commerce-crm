import type { Env } from "../../../config/env";
import {
    asRecord,
    firstText,
    text,
} from "../adapters/adapter.utils";
import {
    getLazadaOrderDetail,
    getLazadaOrderItems,
    getLazadaOrderTrace,
} from "./lazada.api";
import type { LazadaSellerCredential } from "./lazada.types";

function findFirstValueByKeys(
    value: unknown,
    keys: Set<string>,
    depth = 0
): string {
    if (depth > 8 || value === null || value === undefined) {
        return "";
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const found = findFirstValueByKeys(item, keys, depth + 1);

            if (found) {
                return found;
            }
        }

        return "";
    }

    const record = asRecord(value);

    for (const [key, nested] of Object.entries(record)) {
        if (keys.has(key.toLowerCase())) {
            const found = text(nested);

            if (found) {
                return found;
            }
        }
    }

    for (const nested of Object.values(record)) {
        const found = findFirstValueByKeys(nested, keys, depth + 1);

        if (found) {
            return found;
        }
    }

    return "";
}

/**
 * รวม Tracking Number และผู้ให้บริการขนส่งจาก Order Trace
 * กลับเข้า Order Detail/Items เพื่อให้ Adapter อ่านข้อมูลจากจุดเดียว
 */
function mergeLogistics(input: {
    orderDetail: unknown;
    orderItems: unknown;
    orderTrace?: unknown;
}): { orderDetail: unknown; orderItems: unknown } {
    if (!input.orderTrace) {
        return {
            orderDetail: input.orderDetail,
            orderItems: input.orderItems,
        };
    }

    const trackingNumber = findFirstValueByKeys(
        input.orderTrace,
        new Set([
            "tracking_code",
            "tracking_number",
            "tracking_no",
            "package_code",
            "logistics_no",
        ])
    );
    const shippingProvider = findFirstValueByKeys(
        input.orderTrace,
        new Set([
            "shipping_provider",
            "shipment_provider",
            "shipping_provider_type",
            "logistics_provider",
            "provider_name",
        ])
    );

    if (!trackingNumber && !shippingProvider) {
        return {
            orderDetail: input.orderDetail,
            orderItems: input.orderItems,
        };
    }

    const detail = structuredClone(input.orderDetail);
    const items = structuredClone(input.orderItems);
    const detailRoot = asRecord(detail);
    const detailData = asRecord(detailRoot.data);
    const detailOrder = Object.keys(detailData).length
        ? detailData
        : detailRoot;

    if (trackingNumber && !firstText(detailOrder.tracking_code)) {
        detailOrder.tracking_code = trackingNumber;
    }

    if (
        shippingProvider &&
        !firstText(detailOrder.shipping_provider)
    ) {
        detailOrder.shipping_provider = shippingProvider;
    }

    if (Object.keys(detailData).length) {
        detailRoot.data = detailOrder;
    }

    const itemsRoot = asRecord(items);
    const itemsData = Array.isArray(itemsRoot.data)
        ? itemsRoot.data
        : Array.isArray(items)
          ? items
          : [];

    if (itemsData.length > 0) {
        const firstItem = asRecord(itemsData[0]);

        if (trackingNumber && !firstText(firstItem.tracking_code)) {
            firstItem.tracking_code = trackingNumber;
        }

        if (
            shippingProvider &&
            !firstText(firstItem.shipment_provider)
        ) {
            firstItem.shipment_provider = shippingProvider;
        }

        itemsData[0] = firstItem;

        if (Array.isArray(itemsRoot.data)) {
            itemsRoot.data = itemsData;
        }
    }

    return { orderDetail: detail, orderItems: items };
}

/**
 * ดึงข้อมูล Order, รายการสินค้า และ Order Trace ของ Lazada พร้อมกัน
 * Order Trace ล้มเหลวได้โดยไม่ทำให้การ Sync Order หลักหยุดทำงาน
 */
export async function fetchLazadaOrderBundle(
    env: Env,
    credential: LazadaSellerCredential,
    orderId: string
): Promise<{
    orderDetail: unknown;
    orderItems: unknown;
    orderTrace?: unknown;
}> {
    const [orderDetail, orderItems] = await Promise.all([
        getLazadaOrderDetail(env, credential, orderId),
        getLazadaOrderItems(env, credential, orderId),
    ]);
    let orderTrace: unknown;

    try {
        orderTrace = await getLazadaOrderTrace(
            env,
            credential,
            orderId
        );
    } catch (error) {
        console.warn("LAZADA_ORDER_TRACE_FAILED", {
            seller_id: credential.seller_id,
            order_id: orderId,
            error:
                error instanceof Error
                    ? error.message
                    : String(error),
        });
    }

    const merged = mergeLogistics({
        orderDetail,
        orderItems,
        orderTrace,
    });

    return {
        orderDetail: merged.orderDetail,
        orderItems: merged.orderItems,
        orderTrace,
    };
}
