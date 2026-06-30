import type { OrderWorkQueue } from "./order-work-queue";

export type OrderPaymentDisplayState =
    | "unpaid"
    | "payment_review"
    | "paid"
    | "overdue";

/**
 * กฎกลางสำหรับ API Dashboard: Pending ไม่ได้แปลว่ามีสลิปรอตรวจเสมอ
 * ต้องพิจารณา Payment Verification และ Work Queue ที่จำแนกหลักฐานการชำระเงินจริงแล้ว
 */
export function resolveOrderPaymentDisplayState(input: {
    paymentStatus: string;
    paymentVerified: boolean;
    workQueue: OrderWorkQueue;
}): OrderPaymentDisplayState {
    const paymentStatus = input.paymentStatus.trim().toLowerCase();

    if (input.paymentVerified || paymentStatus === "paid") return "paid";
    if (paymentStatus === "overdue") return "overdue";
    if (input.workQueue === "payment_review") return "payment_review";
    return "unpaid";
}
