import type { Env } from "../../config/env";
import { handleCustomerIntegrity } from "./integrity.route";
import {
    handlePaymentOverdueRun,
    handlePaymentOverdueWebhook,
} from "./payment-overdue.route";
import { handlePaymentVerifiedWebhook } from "./payment.route";
import { handleSalesOwnerAssignment } from "./sales-assignment.route";

export async function handleLarkOperationalRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (pathname === "/webhooks/lark/payment-verified") {
        return handlePaymentVerifiedWebhook(request, env);
    }

    if (pathname === "/admin/integrity/customer") {
        return handleCustomerIntegrity(request, env);
    }

    if (
        pathname === "/webhooks/lark/sales-owner-assigned" ||
        pathname === "/admin/sales/assign"
    ) {
        return handleSalesOwnerAssignment(request, env);
    }

    if (pathname === "/webhooks/lark/payment-overdue") {
        return handlePaymentOverdueWebhook(request, env);
    }

    if (pathname === "/admin/payments/overdue/run") {
        return handlePaymentOverdueRun(request, env);
    }

    return null;
}
