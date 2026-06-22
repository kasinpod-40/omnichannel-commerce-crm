import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../config/env";
import {
    CUSTOMER_FIELDS,
    ORDER_FIELDS,
} from "../../core/lark-fields";
import * as customerRepository from "../customers/customer.repository";
import * as orderRepository from "./order.repository";
import {
    cancelActiveOrder,
    createOrderIfReadyToBuy,
} from "./order.service";

vi.mock("../customers/customer.repository", () => ({
    updateCustomer: vi.fn(),
}));

vi.mock("./order.repository", () => ({
    createOrder: vi.fn(),
    findOpenOrdersByCustomer: vi.fn(),
    getOrderByRecordId: vi.fn(),
    getOrdersByRecordIds: vi.fn(),
    updateOrder: vi.fn(),
}));

const returningCustomer = {
    record_id: "rec_customer_001",
    fields: {
        [CUSTOMER_FIELDS.CHANNEL]: "LINE",
        [CUSTOMER_FIELDS.CUSTOMER_NAME]: "Repeat User",
        [CUSTOMER_FIELDS.PHONE]: "0812345678",
        [CUSTOMER_FIELDS.SALES_OWNER]: "Unassigned",
        [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: "",
        [CUSTOMER_FIELDS.PRODUCT_NAME]: "สินค้าเก่า",
        [CUSTOMER_FIELDS.PRODUCT_QTY]: 10,
        [CUSTOMER_FIELDS.PRODUCT_UNIT]: "ตัว",
    },
};

const pipeline = {
    record_id: "rec_pipeline_new",
    fields: {},
};

describe("repeat purchase order isolation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(
            orderRepository.findOpenOrdersByCustomer
        ).mockResolvedValue([]);
        vi.mocked(
            orderRepository.getOrdersByRecordIds
        ).mockResolvedValue([]);
    });

    it("does not create a new order from product and quantity left by the previous sale", async () => {
        const result = await createOrderIfReadyToBuy(
            {} as Env,
            returningCustomer,
            pipeline,
            {
                qualification_reason: "product_order",
                quantity: 2,
                quantity_action: "set",
                message: "เอา 2 ตัวครับ",
                allow_customer_sales_context_fallback: false,
            }
        );

        expect(result).toBeNull();
        expect(orderRepository.createOrder).not.toHaveBeenCalled();
        expect(customerRepository.updateCustomer).not.toHaveBeenCalled();
    });

    it("creates the new order only from the current sale message", async () => {
        vi.mocked(orderRepository.createOrder).mockResolvedValue({
            record_id: "rec_order_new",
            fields: {},
        });
        vi.mocked(customerRepository.updateCustomer).mockResolvedValue(
            returningCustomer
        );

        const result = await createOrderIfReadyToBuy(
            {} as Env,
            returningCustomer,
            pipeline,
            {
                qualification_reason: "product_order",
                product_name: "สินค้าใหม่",
                product_unit: "ชิ้น",
                quantity: 2,
                quantity_action: "set",
                message: "เอาสินค้าใหม่ 2 ชิ้นครับ",
                allow_customer_sales_context_fallback: false,
            }
        );

        expect(result?.created).toBe(true);
        expect(orderRepository.createOrder).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                pipeline_record_id: "rec_pipeline_new",
                product_name: "สินค้าใหม่",
                product_unit: "ชิ้น",
                quantity: 2,
                total_amount: 0,
            })
        );
    });
    it("uses the pre-upsert order snapshot when the returned Customer record has no active pointer", async () => {
        const openOrder = {
            record_id: "rec_order_active",
            fields: {
                [ORDER_FIELDS.ORDER_STATUS]:
                    "Waiting Payment",
                [ORDER_FIELDS.PAYMENT_STATUS]:
                    "Waiting Payment",
                [ORDER_FIELDS.PAYMENT_VERIFIED]: false,
            },
        };

        vi.mocked(
            orderRepository.getOrderByRecordId
        ).mockResolvedValue(openOrder);
        vi.mocked(
            orderRepository.updateOrder
        ).mockResolvedValue({
            ...openOrder,
            fields: {
                ...openOrder.fields,
                [ORDER_FIELDS.ORDER_STATUS]:
                    "Cancelled",
            },
        });

        const result = await cancelActiveOrder(
            {} as Env,
            returningCustomer,
            openOrder.record_id
        );

        expect(result?.changed).toBe(true);
        expect(result?.record.record_id).toBe(
            openOrder.record_id
        );
        expect(orderRepository.updateOrder).toHaveBeenCalledWith(
            expect.anything(),
            openOrder.record_id,
            { order_status: "Cancelled" }
        );
    });

    it("recovers and cancels the only open Order when active_order_id is blank", async () => {
        const openOrder = {
            record_id: "rec_order_recovered",
            fields: {
                [ORDER_FIELDS.ORDER_STATUS]:
                    "Payment Review",
                [ORDER_FIELDS.PAYMENT_STATUS]:
                    "Payment Review",
                [ORDER_FIELDS.PAYMENT_VERIFIED]: false,
            },
        };

        vi.mocked(
            orderRepository.findOpenOrdersByCustomer
        ).mockResolvedValue([openOrder]);
        vi.mocked(
            orderRepository.updateOrder
        ).mockResolvedValue({
            ...openOrder,
            fields: {
                ...openOrder.fields,
                [ORDER_FIELDS.ORDER_STATUS]:
                    "Cancelled",
            },
        });

        const result = await cancelActiveOrder(
            {} as Env,
            returningCustomer
        );

        expect(result?.changed).toBe(true);
        expect(result?.record.record_id).toBe(
            openOrder.record_id
        );
    });


    it("preserves the active product name when the next message only selects a size", async () => {
        const activeOrder = {
            record_id: "rec_order_active_size",
            fields: {
                [ORDER_FIELDS.PIPELINE]: ["rec_pipeline_new"],
                [ORDER_FIELDS.ORDER_STATUS]: "Waiting Payment",
                [ORDER_FIELDS.CUSTOMER_NAME]: "Repeat User",
                [ORDER_FIELDS.PHONE]: "0812345678",
                [ORDER_FIELDS.ADDRESS]: "",
                [ORDER_FIELDS.PRODUCT_NAME]: "เสื้อสีเขียว",
                [ORDER_FIELDS.PRODUCT_SIZE]: "",
                [ORDER_FIELDS.PRODUCT_UNIT]: "ตัว",
                [ORDER_FIELDS.QUANTITY]: 2,
                [ORDER_FIELDS.TOTAL_AMOUNT]: 0,
                [ORDER_FIELDS.SALES_OWNER]: "Unassigned",
            },
        };

        const customerWithActiveOrder = {
            ...returningCustomer,
            fields: {
                ...returningCustomer.fields,
                [CUSTOMER_FIELDS.ACTIVE_ORDER_ID]: activeOrder.record_id,
                [CUSTOMER_FIELDS.PRODUCT_NAME]: "เสื้อสีเขียว",
                [CUSTOMER_FIELDS.PRODUCT_SIZE]: "",
                [CUSTOMER_FIELDS.PRODUCT_QTY]: 2,
            },
        };

        vi.mocked(orderRepository.getOrderByRecordId).mockResolvedValue(
            activeOrder
        );
        vi.mocked(orderRepository.updateOrder).mockResolvedValue({
            ...activeOrder,
            fields: {
                ...activeOrder.fields,
                [ORDER_FIELDS.PRODUCT_SIZE]: "S",
                [ORDER_FIELDS.QUANTITY]: 1,
            },
        });
        vi.mocked(customerRepository.updateCustomer).mockResolvedValue(
            customerWithActiveOrder
        );

        const result = await createOrderIfReadyToBuy(
            {} as Env,
            customerWithActiveOrder,
            pipeline,
            {
                qualification_reason: "product_order",
                product_size: "S",
                quantity: 1,
                quantity_action: "set",
                message: "เอาไซต์ S 1 ตัวครับ",
            }
        );

        expect(result?.created).toBe(false);
        expect(orderRepository.updateOrder).toHaveBeenCalledWith(
            expect.anything(),
            activeOrder.record_id,
            expect.objectContaining({
                product_name: "เสื้อสีเขียว",
                product_size: "S",
                quantity: 1,
            })
        );
        expect(customerRepository.updateCustomer).toHaveBeenCalledWith(
            expect.anything(),
            customerWithActiveOrder.record_id,
            expect.objectContaining({
                product_name: "เสื้อสีเขียว",
                product_size: "S",
                product_qty: 1,
            })
        );
    });

});
