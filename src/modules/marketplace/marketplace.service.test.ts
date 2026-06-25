import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
} from "../../core/lark-fields";

const {
    createCustomer,
    findCustomerByChannelCustomerId,
    getCustomerByRecordId,
    updateCustomer,
    createOrder,
    findOrdersByCustomer,
    findOrderByChannelAndExternalId,
    getOrdersByRecordIds,
    updateOrder,
    recordActivityOnce,
    recordAndDispatchNotificationOnce,
} = vi.hoisted(() => ({
    createCustomer: vi.fn(),
    findCustomerByChannelCustomerId: vi.fn(),
    getCustomerByRecordId: vi.fn(),
    updateCustomer: vi.fn(),
    createOrder: vi.fn(),
    findOrdersByCustomer: vi.fn(),
    findOrderByChannelAndExternalId: vi.fn(),
    getOrdersByRecordIds: vi.fn(),
    updateOrder: vi.fn(),
    recordActivityOnce: vi.fn(),
    recordAndDispatchNotificationOnce: vi.fn(),
}));

vi.mock("../customers/customer.repository", () => ({
    createCustomer,
    findCustomerByChannelCustomerId,
    getCustomerByRecordId,
    updateCustomer,
}));

vi.mock("../orders/order.repository", () => ({
    createOrder,
    findOrdersByCustomer,
    findOrderByChannelAndExternalId,
    getOrdersByRecordIds,
    updateOrder,
}));

vi.mock("../activities/activity.service", () => ({
    recordActivityOnce,
}));

vi.mock("../notifications/notification.service", () => ({
    recordAndDispatchNotificationOnce,
}));

import { upsertMarketplaceOrder } from "./marketplace.service";

const env = {} as any;
const input = {
    channel: "Shopee" as const,
    event_id: "evt-1",
    store_id: "shop-1",
    store_name: "Main Shop",
    external_order_id: "ORDER-1",
    buyer: {
        id: "buyer-1",
        name: "Buyer",
        phone: "0812345678",
        address: "Bangkok",
    },
    items: [
        {
            name: "เสื้อ",
            variant: "S",
            quantity: 2,
            unit_price: 100,
        },
    ],
    currency: "THB",
    total_amount: 200,
    marketplace_status: "READY_TO_SHIP",
    marketplace_payment_status: "PAID",
    updated_at: 2_000,
    created_at: 1_000,
};

describe("marketplace order upsert", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        findCustomerByChannelCustomerId.mockResolvedValue({
            record_id: "cus-1",
            fields: {
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Won",
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Buyer",
            },
        });
        updateCustomer.mockResolvedValue({
            record_id: "cus-1",
            fields: {},
        });
        getCustomerByRecordId.mockResolvedValue({
            record_id: "cus-1",
            fields: {
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Won",
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Buyer",
            },
        });
        createCustomer.mockResolvedValue({
            record_id: "cus-1",
            fields: {},
        });
        createOrder.mockResolvedValue({
            record_id: "order-1",
            fields: {},
        });
        updateOrder.mockResolvedValue({
            record_id: "order-1",
            fields: {},
        });
        findOrdersByCustomer.mockResolvedValue([]);
        getOrdersByRecordIds.mockResolvedValue([]);
        recordActivityOnce.mockResolvedValue({
            duplicate: false,
            record: { record_id: "activity-1", fields: {} },
        });
        recordAndDispatchNotificationOnce.mockResolvedValue({
            duplicate: false,
            record: { record_id: "noti-1", fields: {} },
            delivery: null,
        });
    });

    it("creates a marketplace order without a pipeline and queues a group notification", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue(null);

        const result = await upsertMarketplaceOrder(
            env,
            input
        );

        expect(result.action).toBe("created");
        expect(createOrder).toHaveBeenCalledWith(
            env,
            expect.objectContaining({
                channel: "Shopee",
                external_order_id: "ORDER-1",
                customer_record_id: "cus-1",
                order_status: "Ready to Ship",
                payment_status: "Paid",
                quantity: 2,
                total_amount: 200,
                marketplace_store_id: "shop-1",
            })
        );
        expect(
            createOrder.mock.calls[0][1].pipeline_record_id
        ).toBeUndefined();
        expect(recordAndDispatchNotificationOnce).toHaveBeenCalledWith(
            env,
            expect.objectContaining({
                event_id: "MARKETPLACE_ORDER_CREATED:Shopee:ORDER-1",
                notification_type: "SALE_WON",
                customer_record_id: "cus-1",
                payload: expect.objectContaining({
                    channel: "Shopee",
                    order_number: "SP-ORDER-1",
                    total_amount: 200,
                }),
            })
        );
    });

    it("sends a completed notification when a newly discovered Lazada order is already completed", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue(null);

        const result = await upsertMarketplaceOrder(env, {
            ...input,
            channel: "Lazada",
            event_id: "evt-lazada-completed-created",
            external_order_id: "LAZADA-ORDER-NEW-COMPLETED",
            marketplace_status: "confirmed",
            marketplace_payment_status: "PAID",
            updated_at: 3_000,
        });

        expect(result.action).toBe("created");
        expect(result.order_status).toBe("Completed");
        expect(recordAndDispatchNotificationOnce).toHaveBeenCalledWith(
            env,
            expect.objectContaining({
                event_id: "MARKETPLACE_ORDER_COMPLETED:Lazada:LAZADA-ORDER-NEW-COMPLETED",
                notification_type: "SALE_WON",
                customer_record_id: "cus-1",
                message: expect.stringContaining("เสร็จสมบูรณ์"),
                payload: expect.objectContaining({
                    channel: "Lazada",
                    order_status: "Completed",
                    marketplace_event_kind: "completed",
                }),
            })
        );
    });

    it("moves an existing Won marketplace customer to Lost when the order is cancelled", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue({
            record_id: "order-1",
            fields: {
                [ORDER_FIELDS.CUSTOMER]: ["cus-1"],
                [ORDER_FIELDS.MARKETPLACE_EVENT_ID]: "evt-old",
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: 1_000_000,
                [ORDER_FIELDS.MARKETPLACE_STATUS]: "READY_TO_SHIP",
                [ORDER_FIELDS.ORDER_STATUS]: "Ready to Ship",
            },
        });

        const result = await upsertMarketplaceOrder(env, {
            ...input,
            event_id: "evt-cancelled",
            marketplace_status: "CANCELLED",
            marketplace_payment_status: "REFUNDED",
            updated_at: 3_000,
        });

        expect(result.action).toBe("updated");
        expect(updateCustomer).toHaveBeenCalledWith(
            env,
            "cus-1",
            expect.objectContaining({
                current_stage: "Lost",
                lead_score: 0,
            })
        );
        expect(updateOrder).toHaveBeenCalledWith(
            env,
            "order-1",
            expect.objectContaining({
                order_status: "Cancelled",
                payment_verified: false,
            })
        );
        expect(recordAndDispatchNotificationOnce).toHaveBeenCalledWith(
            env,
            expect.objectContaining({
                notification_type: "SALE_LOST",
                customer_record_id: "cus-1",
            })
        );
    });

    it("does not send the cancellation notification again when the order was already Cancelled", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue({
            record_id: "order-1",
            fields: {
                [ORDER_FIELDS.CUSTOMER]: ["cus-1"],
                [ORDER_FIELDS.MARKETPLACE_EVENT_ID]: "evt-cancelled-old",
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: 1_000_000,
                [ORDER_FIELDS.MARKETPLACE_STATUS]: "CANCELLED",
                [ORDER_FIELDS.ORDER_STATUS]: "Cancelled",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Pending",
            },
        });

        const result = await upsertMarketplaceOrder(env, {
            ...input,
            channel: "Lazada",
            event_id: "evt-cancelled-new",
            external_order_id: "LAZADA-ORDER-CANCELLED",
            marketplace_status: "canceled",
            marketplace_payment_status: "REFUNDED",
            updated_at: 3_000,
        });

        expect(result.action).toBe("updated");
        expect(result.order_status).toBe("Cancelled");
        expect(recordAndDispatchNotificationOnce).not.toHaveBeenCalled();
    });

    it("does not process the same event twice", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue({
            record_id: "order-1",
            fields: {
                [ORDER_FIELDS.CUSTOMER]: ["cus-1"],
                [ORDER_FIELDS.MARKETPLACE_EVENT_ID]: "evt-1",
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: 2_000_000,
            },
        });

        const result = await upsertMarketplaceOrder(
            env,
            input
        );

        expect(result.action).toBe("duplicate");
        expect(updateOrder).not.toHaveBeenCalled();
        expect(updateCustomer).not.toHaveBeenCalled();
        expect(recordActivityOnce).not.toHaveBeenCalled();
        expect(recordAndDispatchNotificationOnce).not.toHaveBeenCalled();
    });

    it("ignores stale events without regressing the customer stage", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue({
            record_id: "order-1",
            fields: {
                [ORDER_FIELDS.CUSTOMER]: ["cus-1"],
                [ORDER_FIELDS.MARKETPLACE_EVENT_ID]: "evt-old",
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: 3_000_000,
                [ORDER_FIELDS.ORDER_STATUS]: "Shipped",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
            },
        });

        const result = await upsertMarketplaceOrder(
            env,
            input
        );

        expect(result.action).toBe("stale");
        expect(updateOrder).not.toHaveBeenCalled();
        expect(updateCustomer).not.toHaveBeenCalled();
    });

    it("does not fail the order sync if notification recording fails", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue(null);
        recordAndDispatchNotificationOnce.mockRejectedValue(
            new Error("notification unavailable")
        );
        const errorSpy = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        const result = await upsertMarketplaceOrder(
            env,
            input
        );

        expect(result.action).toBe("created");
        expect(errorSpy).toHaveBeenCalledWith(
            "MARKETPLACE_ORDER_NOTIFICATION_FAILED",
            expect.objectContaining({
                channel: "Shopee",
                external_order_id: "ORDER-1",
            })
        );

        errorSpy.mockRestore();
    });

    it("keeps one customer, creates a new order, and moves a returning buyer from Won to Closing", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue(null);
        findCustomerByChannelCustomerId.mockResolvedValue({
            record_id: "cus-1",
            fields: {
                [CUSTOMER_FIELDS.CURRENT_STAGE]: "Won",
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Buyer",
                [CUSTOMER_FIELDS.ORDERS_HISTORY]: ["recOrderOld"],
            },
        });
        getOrdersByRecordIds.mockResolvedValue([
            {
                record_id: "recOrderOld",
                fields: {
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.CREATED_AT]: 500_000,
                    [ORDER_FIELDS.EXTERNAL_ORDER_ID]: "ORDER-OLD",
                    [ORDER_FIELDS.CHANNEL]: "Shopee",
                    [ORDER_FIELDS.MARKETPLACE_STATUS]: "COMPLETED",
                    [ORDER_FIELDS.PRODUCT_NAME]: "สินค้าเก่า",
                    [ORDER_FIELDS.PRODUCT_SIZE]: "M",
                    [ORDER_FIELDS.PRODUCT_UNIT]: "item",
                    [ORDER_FIELDS.QUANTITY]: 1,
                },
            },
        ]);

        const result = await upsertMarketplaceOrder(env, {
            ...input,
            external_order_id: "ORDER-2",
            event_id: "evt-2",
        });

        expect(result.action).toBe("created");
        expect(createCustomer).not.toHaveBeenCalled();
        expect(createOrder).toHaveBeenCalledWith(
            env,
            expect.objectContaining({
                customer_record_id: "cus-1",
                external_order_id: "ORDER-2",
            })
        );
        expect(updateCustomer).toHaveBeenCalledWith(
            env,
            "cus-1",
            expect.objectContaining({
                current_stage: "Closing",
                lead_score: 95,
                product_name: "เสื้อ",
                product_size: "S",
                product_qty: 2,
                product_unit: "item",
            })
        );
    });

    it("keeps the customer Closing when one order is cancelled but another order is still active", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue({
            record_id: "order-1",
            fields: {
                [ORDER_FIELDS.CUSTOMER]: ["cus-1"],
                [ORDER_FIELDS.CREATED_AT]: 1_000_000,
                [ORDER_FIELDS.MARKETPLACE_EVENT_ID]: "evt-old",
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: 1_000_000,
                [ORDER_FIELDS.MARKETPLACE_STATUS]: "READY_TO_SHIP",
                [ORDER_FIELDS.ORDER_STATUS]: "Ready to Ship",
            },
        });
        getCustomerByRecordId.mockResolvedValue({
            record_id: "cus-1",
            fields: {
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Buyer",
                [CUSTOMER_FIELDS.ORDERS_HISTORY]: [
                    "order-1",
                    "recOrderActive",
                ],
            },
        });
        getOrdersByRecordIds.mockResolvedValue([
            {
                record_id: "recOrderActive",
                fields: {
                    [ORDER_FIELDS.ORDER_STATUS]: "Shipped",
                    [ORDER_FIELDS.CREATED_AT]: 2_000_000,
                    [ORDER_FIELDS.EXTERNAL_ORDER_ID]: "ORDER-ACTIVE",
                    [ORDER_FIELDS.CHANNEL]: "Shopee",
                    [ORDER_FIELDS.MARKETPLACE_STATUS]: "SHIPPED",
                    [ORDER_FIELDS.PRODUCT_NAME]: "สินค้าที่กำลังส่ง",
                    [ORDER_FIELDS.PRODUCT_SIZE]: "L",
                    [ORDER_FIELDS.PRODUCT_UNIT]: "item",
                    [ORDER_FIELDS.QUANTITY]: 3,
                },
            },
        ]);

        await upsertMarketplaceOrder(env, {
            ...input,
            event_id: "evt-cancelled",
            marketplace_status: "CANCELLED",
            marketplace_payment_status: "REFUNDED",
            updated_at: 3_000,
        });

        expect(updateCustomer).toHaveBeenCalledWith(
            env,
            "cus-1",
            expect.objectContaining({
                current_stage: "Closing",
                lead_score: 95,
                product_name: "สินค้าที่กำลังส่ง",
                product_qty: 3,
            })
        );
        expect(recordAndDispatchNotificationOnce).toHaveBeenCalledWith(
            env,
            expect.objectContaining({
                notification_type: "SALE_LOST",
                payload: expect.objectContaining({
                    current_stage: "Closing",
                    lead_score: 95,
                }),
            })
        );
    });

    it("keeps the customer Won when there are no active orders but an older order completed", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue({
            record_id: "order-1",
            fields: {
                [ORDER_FIELDS.CUSTOMER]: ["cus-1"],
                [ORDER_FIELDS.CREATED_AT]: 2_000_000,
                [ORDER_FIELDS.MARKETPLACE_EVENT_ID]: "evt-old",
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: 1_000_000,
                [ORDER_FIELDS.MARKETPLACE_STATUS]: "READY_TO_SHIP",
                [ORDER_FIELDS.ORDER_STATUS]: "Ready to Ship",
            },
        });
        getCustomerByRecordId.mockResolvedValue({
            record_id: "cus-1",
            fields: {
                [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Buyer",
                [CUSTOMER_FIELDS.ORDERS_HISTORY]: [
                    "order-1",
                    "recOrderCompleted",
                ],
            },
        });
        getOrdersByRecordIds.mockResolvedValue([
            {
                record_id: "recOrderCompleted",
                fields: {
                    [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                    [ORDER_FIELDS.CREATED_AT]: 1_000_000,
                    [ORDER_FIELDS.EXTERNAL_ORDER_ID]: "ORDER-COMPLETED",
                    [ORDER_FIELDS.CHANNEL]: "Shopee",
                    [ORDER_FIELDS.MARKETPLACE_STATUS]: "COMPLETED",
                    [ORDER_FIELDS.PRODUCT_NAME]: "สินค้าสำเร็จ",
                    [ORDER_FIELDS.PRODUCT_UNIT]: "item",
                    [ORDER_FIELDS.QUANTITY]: 1,
                },
            },
        ]);

        await upsertMarketplaceOrder(env, {
            ...input,
            event_id: "evt-cancelled",
            marketplace_status: "CANCELLED",
            marketplace_payment_status: "REFUNDED",
            updated_at: 3_000,
        });

        expect(updateCustomer).toHaveBeenCalledWith(
            env,
            "cus-1",
            expect.objectContaining({
                current_stage: "Won",
                lead_score: 100,
            })
        );
    });

    it.each([
        {
            channel: "Shopee" as const,
            previousMarketplaceStatus: "SHIPPED",
            completedMarketplaceStatus: "COMPLETED",
        },
        {
            channel: "TikTok" as const,
            previousMarketplaceStatus: "IN_TRANSIT",
            completedMarketplaceStatus: "COMPLETED",
        },
        {
            channel: "Lazada" as const,
            previousMarketplaceStatus: "shipped",
            completedMarketplaceStatus: "delivered",
        },
    ])(
        "sends one completed notification when a $channel order transitions to Completed",
        async ({
            channel,
            previousMarketplaceStatus,
            completedMarketplaceStatus,
        }) => {
            findOrderByChannelAndExternalId.mockResolvedValue({
                record_id: "order-1",
                fields: {
                    [ORDER_FIELDS.CUSTOMER]: ["cus-1"],
                    [ORDER_FIELDS.CREATED_AT]: 1_000_000,
                    [ORDER_FIELDS.MARKETPLACE_EVENT_ID]: "evt-old",
                    [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: 1_000_000,
                    [ORDER_FIELDS.MARKETPLACE_STATUS]: previousMarketplaceStatus,
                    [ORDER_FIELDS.ORDER_STATUS]: "Shipped",
                    [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
                },
            });

            const result = await upsertMarketplaceOrder(env, {
                ...input,
                channel,
                event_id: `evt-${channel.toLowerCase()}-completed`,
                external_order_id: `${channel.toUpperCase()}-ORDER-1`,
                marketplace_status: completedMarketplaceStatus,
                marketplace_payment_status: "PAID",
                updated_at: 3_000,
            });

            expect(result.action).toBe("updated");
            expect(result.order_status).toBe("Completed");
            expect(recordAndDispatchNotificationOnce).toHaveBeenCalledWith(
                env,
                expect.objectContaining({
                    event_id: `MARKETPLACE_ORDER_COMPLETED:${channel}:${channel.toUpperCase()}-ORDER-1`,
                    notification_type: "SALE_WON",
                    customer_record_id: "cus-1",
                    message: expect.stringContaining("เสร็จสมบูรณ์"),
                    payload: expect.objectContaining({
                        channel,
                        order_status: "Completed",
                        marketplace_event_kind: "completed",
                        current_stage: "Won",
                        lead_score: 100,
                    }),
                })
            );
        }
    );

    it("does not send the completed notification again when the order was already Completed", async () => {
        findOrderByChannelAndExternalId.mockResolvedValue({
            record_id: "order-1",
            fields: {
                [ORDER_FIELDS.CUSTOMER]: ["cus-1"],
                [ORDER_FIELDS.CREATED_AT]: 1_000_000,
                [ORDER_FIELDS.MARKETPLACE_EVENT_ID]: "evt-completed-old",
                [ORDER_FIELDS.MARKETPLACE_UPDATED_AT]: 1_000_000,
                [ORDER_FIELDS.MARKETPLACE_STATUS]: "COMPLETED",
                [ORDER_FIELDS.ORDER_STATUS]: "Completed",
                [ORDER_FIELDS.PAYMENT_STATUS]: "Paid",
            },
        });

        const result = await upsertMarketplaceOrder(env, {
            ...input,
            event_id: "evt-completed-new",
            marketplace_status: "COMPLETED",
            marketplace_payment_status: "PAID",
            updated_at: 3_000,
        });

        expect(result.action).toBe("updated");
        expect(recordAndDispatchNotificationOnce).not.toHaveBeenCalled();
    });

});
