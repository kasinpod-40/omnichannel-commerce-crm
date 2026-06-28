import type { Env } from "../../config/env";
import { dashboardPreflight } from "../shared/dashboard-api";
import {
    handlePaymentReviewApprove,
    handlePaymentReviewDetail,
    handlePaymentReviewImage,
    handlePaymentReviewReject,
} from "./payment-reviews.route";

export async function handlePaymentReviewRoutes(
    request: Request,
    env: Env,
    pathname: string
): Promise<Response | null> {
    if (!pathname.startsWith("/payment-reviews/")) return null;
    if (request.method === "OPTIONS") return dashboardPreflight(request, env);

    const match = pathname.match(
        /^\/payment-reviews\/([^/]+)(?:\/(image|approve|reject))?$/
    );
    if (!match?.[1]) return null;
    const action = match[2];
    if (action === "image") return handlePaymentReviewImage(request, env, match[1]);
    if (action === "approve") return handlePaymentReviewApprove(request, env, match[1]);
    if (action === "reject") return handlePaymentReviewReject(request, env, match[1]);
    return handlePaymentReviewDetail(request, env, match[1]);
}
