import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Test นี้ต้องใช้ Cache API ของ Workers จึงแยกจาก Node unit suite
        include: [
            "src/modules/conversations/conversation-image.service.test.ts",
        ],
        fileParallelism: false,
        maxWorkers: 1,
    },
    plugins: [
        cloudflareTest({
            miniflare: {
                compatibilityDate: "2026-06-16",
                compatibilityFlags: ["nodejs_compat"],
                kvNamespaces: ["MARKETPLACE_TOKENS"],
            },
        }),
    ],
});
