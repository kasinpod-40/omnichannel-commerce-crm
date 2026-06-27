import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // ชุด Integration นี้ทดสอบผ่าน SELF จึงต้องโหลด Worker entry จริง
        include: ["test/index.spec.ts"],
        fileParallelism: false,
        maxWorkers: 1,
    },
    plugins: [
        cloudflareTest({
            main: "./src/index.ts",
            miniflare: {
                compatibilityDate: "2026-06-16",
                compatibilityFlags: ["nodejs_compat"],
                kvNamespaces: ["MARKETPLACE_TOKENS"],
            },
        }),
    ],
});
