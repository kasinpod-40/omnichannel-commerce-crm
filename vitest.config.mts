import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
    test: {
        poolOptions: {
            workers: {
                main: "./src/index.ts",
                remoteBindings: false,
                miniflare: {
                    compatibilityDate: "2026-03-10",
                    compatibilityFlags: ["nodejs_compat"],
                    kvNamespaces: ["MARKETPLACE_TOKENS"],
                },
            },
        },
    },
});
