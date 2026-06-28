import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Unit/Service ปกติรันบน Node โดยตรง ไม่เปิด workerd ที่ไม่จำเป็น
        exclude: [
            "test/index.spec.ts",
            "src/modules/conversations/conversation-image.service.test.ts",
            "**/node_modules/**",
        ],
        fileParallelism: false,
        maxWorkers: 1,
    },
});
