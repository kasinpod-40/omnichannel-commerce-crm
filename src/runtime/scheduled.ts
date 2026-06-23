import type { Env } from "../config/env";
import { runLazadaPolling } from "../modules/marketplace/lazada/lazada.poller";

export function handleScheduledEvent(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
): void {
    ctx.waitUntil(
        runLazadaPolling({
            env,
            trigger: "cron",
            runAtMs: controller.scheduledTime,
        }).catch((error) => {
            console.error("LAZADA_POLL_SCHEDULED_FAILED", {
                error: error instanceof Error ? error.message : String(error),
            });
        })
    );
}
