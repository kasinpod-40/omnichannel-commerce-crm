#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const mode = args.includes("--send-test")
    ? "send-test"
    : args.includes("--verify")
      ? "verify"
      : "plan";
const envFileIndex = args.indexOf("--env-file");
const envFile =
    envFileIndex >= 0
        ? args[envFileIndex + 1]
        : path.resolve(process.cwd(), ".dev.vars");
const outputFile = path.resolve(
    process.cwd(),
    "pc-lark-group-notification-result.json"
);
const sendConfirmation = "PC-LARK-GROUP-TEST";
const confirmationIndex = args.indexOf("--confirm-send");
const confirmation =
    confirmationIndex >= 0
        ? args[confirmationIndex + 1]
        : "";

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function parseEnvFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const values = {};

    for (const rawLine of fs
        .readFileSync(filePath, "utf8")
        .split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const normalized = line.startsWith("export ")
            ? line.slice(7).trim()
            : line;
        const separator = normalized.indexOf("=");
        if (separator <= 0) continue;

        const key = normalized.slice(0, separator).trim();
        let value = normalized.slice(separator + 1).trim();

        if (
            (value.startsWith('"') &&
                value.endsWith('"')) ||
            (value.startsWith("'") &&
                value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

const fileEnv = parseEnvFile(envFile);
const env = { ...fileEnv, ...process.env };

function redact(message) {
    let output = String(message);

    for (const secret of [
        env.LARK_GROUP_WEBHOOK_URL,
        env.LARK_PC_GROUP_WEBHOOK_URL,
        env.LARK_APP_SECRET,
        env.LARK_APP_ID,
        env.NOTIFICATION_DISPATCH_TOKEN,
        env.LARK_WORKFLOW_TOKEN,
    ]) {
        if (secret) {
            output = output.replaceAll(
                secret,
                "[REDACTED]"
            );
        }
    }

    return output;
}

function readRequiredFile(relativePath) {
    const absolutePath = path.resolve(
        process.cwd(),
        relativePath
    );
    assert(
        fs.existsSync(absolutePath),
        `Missing ${relativePath}`
    );
    return fs.readFileSync(absolutePath, "utf8");
}

function assertStaticContracts() {
    const wrangler = readRequiredFile("wrangler.jsonc");
    const envTypes = readRequiredFile(
        "src/config/env.ts"
    );
    const notificationTypes = readRequiredFile(
        "src/modules/notifications/notification.types.ts"
    );
    const alerts = readRequiredFile(
        "src/modules/production-control/pc.alerts.ts"
    );
    const notificationService = readRequiredFile(
        "src/modules/notifications/notification.service.ts"
    );
    const groupProvider = readRequiredFile(
        "src/providers/lark/lark-group-webhook.provider.ts"
    );
    const groupProviderTest = readRequiredFile(
        "src/providers/lark/lark-group-webhook.provider.test.ts"
    );
    const queueRuntime = readRequiredFile(
        "src/runtime/queue.ts"
    );

    assert(
        /"PC_INVENTORY_ENABLED"\s*:\s*"false"/u.test(
            wrangler
        ),
        "STOP: PC_INVENTORY_ENABLED must remain false during notification readiness"
    );
    assert(
        /"binding"\s*:\s*"NOTIFICATION_QUEUE"/u.test(
            wrangler
        ) &&
            /"queue"\s*:\s*"crm-notifications"/u.test(
                wrangler
            ),
        "Missing NOTIFICATION_QUEUE producer binding"
    );
    assert(
        /"queue"\s*:\s*"crm-notifications"/u.test(
            wrangler
        ) &&
            /"dead_letter_queue"\s*:\s*"crm-notifications-dlq"/u.test(
                wrangler
            ),
        "Missing crm-notifications consumer/DLQ contract"
    );
    assert(
        envTypes.includes("LARK_GROUP_WEBHOOK_URL") &&
            envTypes.includes(
                "LARK_PC_GROUP_WEBHOOK_URL"
            ),
        "Env contract must keep the CRM webhook and add the dedicated PC webhook"
    );
    assert(
        notificationTypes.includes(
            '"PC_STOCK_EXCEPTION"'
        ) &&
            notificationTypes.includes(
                '"PC_MATERIAL_SHORTAGE"'
            ),
        "PC notification types are missing"
    );
    assert(
        alerts.includes(
            "recordAndDispatchNotificationOnce"
        ) &&
            alerts.includes("notifyPcExceptionOnce"),
        "PC alert dispatch contract is missing"
    );
    assert(
        notificationService.includes(
            "sendLarkGroupText"
        ) &&
            notificationService.includes(
                "enqueueNotificationDelivery"
            ) &&
            notificationService.includes(
                "📦 พบข้อยกเว้นด้านสต็อกสินค้า"
            ) &&
            notificationService.includes(
                "🧵 วัตถุดิบไม่เพียงพอสำหรับแผนผลิต"
            ),
        "Notification formatter/queue delivery contract is missing"
    );
    assert(
        groupProvider.includes(
            "resolveLarkGroupWebhookTarget"
        ) &&
            groupProvider.includes(
                "LARK_PC_GROUP_WEBHOOK_URL"
            ) &&
            groupProvider.includes(
                '"production-control"'
            ),
        "Dedicated PC Lark Group routing is missing"
    );
    assert(
        groupProviderTest.includes(
            "LARK_PC_GROUP_WEBHOOK_URL_NOT_CONFIGURED"
        ) &&
            groupProviderTest.includes(
                "ไม่ fallback ไปกลุ่ม CRM เดิม"
            ),
        "Fail-closed PC group routing regression is missing"
    );
    assert(
        queueRuntime.includes(
            "handleNotificationQueueBatch"
        ) &&
            queueRuntime.includes(
                'batch.queue === "crm-notifications"'
            ),
        "Notification Queue runtime dispatch is missing"
    );

    return {
        pc_inventory_enabled: false,
        notification_queue_binding: true,
        notification_dlq_binding: true,
        crm_group_preserved: true,
        dedicated_pc_group_routing: true,
        missing_pc_webhook_fallback_to_crm: false,
        pc_notification_types: [
            "PC_STOCK_EXCEPTION",
            "PC_MATERIAL_SHORTAGE",
        ],
        routing: {
            crm_notifications:
                "LARK_GROUP_WEBHOOK_URL",
            production_stock_notifications:
                "LARK_PC_GROUP_WEBHOOK_URL",
        },
        dispatch_path:
            "PC alert -> Notifications table -> crm-notifications -> dedicated Production & Stock Lark Group",
    };
}

function wranglerBinary() {
    const binaryName =
        process.platform === "win32"
            ? "wrangler.cmd"
            : "wrangler";
    const localBinary = path.resolve(
        process.cwd(),
        "node_modules",
        ".bin",
        binaryName
    );

    assert(
        fs.existsSync(localBinary),
        "Missing local Wrangler binary. Run npm ci before notification readiness."
    );

    return localBinary;
}

function parseWranglerJson(stdout) {
    const text = stdout.trim();
    assert(
        text,
        "Wrangler secret list returned empty output"
    );

    try {
        return JSON.parse(text);
    } catch {
        const arrayStart = text.lastIndexOf("[");
        const objectStart = text.lastIndexOf("{");
        const start = Math.max(
            arrayStart,
            objectStart
        );
        assert(
            start >= 0,
            "Wrangler secret list did not return JSON"
        );
        return JSON.parse(text.slice(start));
    }
}

function secretNamesFromPayload(payload) {
    const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.secrets)
          ? payload.secrets
          : Array.isArray(payload?.items)
            ? payload.items
            : [];

    return [
        ...new Set(
            items
                .map((item) =>
                    typeof item === "string"
                        ? item
                        : typeof item?.name ===
                            "string"
                          ? item.name
                          : ""
                )
                .filter(Boolean)
        ),
    ].sort();
}

function listRemoteSecrets() {
    const result = spawnSync(
        wranglerBinary(),
        ["secret", "list", "--format", "json"],
        {
            cwd: process.cwd(),
            encoding: "utf8",
            env: process.env,
        }
    );

    if (result.status !== 0) {
        throw new Error(
            redact(
                `wrangler secret list failed (${result.status}): ${
                    result.stderr ||
                    result.stdout ||
                    "unknown error"
                }`
            )
        );
    }

    const payload = parseWranglerJson(result.stdout);
    const names = secretNamesFromPayload(payload);
    const required = [
        "LARK_GROUP_WEBHOOK_URL",
        "LARK_PC_GROUP_WEBHOOK_URL",
    ];
    const missing = required.filter(
        (name) => !names.includes(name)
    );

    assert(
        missing.length === 0,
        `Missing required Cloudflare Worker secret(s): ${missing.join(", ")}`
    );

    return {
        checked: true,
        required_present: required,
        old_crm_group_secret_preserved:
            names.includes("LARK_GROUP_WEBHOOK_URL"),
        dedicated_pc_group_secret_present:
            names.includes(
                "LARK_PC_GROUP_WEBHOOK_URL"
            ),
        optional_present: [
            "LARK_APP_ID",
            "LARK_APP_SECRET",
            "LARK_APP_TOKEN",
            "NOTIFICATION_DISPATCH_TOKEN",
        ].filter((name) => names.includes(name)),
        secret_count: names.length,
    };
}

function getWebhookKeyword() {
    const keyword = (
        env.LARK_GROUP_WEBHOOK_KEYWORD || "CRM"
    ).trim();

    assert(
        keyword,
        "LARK_GROUP_WEBHOOK_KEYWORD must not be empty"
    );
    assert(
        keyword.length <= 80 &&
            !/[\r\n]/u.test(keyword),
        "LARK_GROUP_WEBHOOK_KEYWORD must be one line of 80 characters or fewer"
    );

    return keyword;
}

function responseCode(payload) {
    if (payload && typeof payload === "object") {
        if (typeof payload.code === "number") {
            return payload.code;
        }
        if (typeof payload.StatusCode === "number") {
            return payload.StatusCode;
        }
    }

    return null;
}

function responseMessage(payload) {
    if (!payload || typeof payload !== "object") {
        return "";
    }

    for (const key of [
        "msg",
        "StatusMessage",
        "message",
    ]) {
        if (typeof payload[key] === "string") {
            return payload[key];
        }
    }

    return "";
}

async function sendWebhookTest() {
    assert(
        confirmation === sendConfirmation,
        `STOP: --send-test requires --confirm-send ${sendConfirmation}`
    );

    const webhookUrl = (
        env.LARK_PC_GROUP_WEBHOOK_URL || ""
    ).trim();

    assert(
        webhookUrl,
        `Missing LARK_PC_GROUP_WEBHOOK_URL in ${envFile}. Cloudflare secret values cannot be read back; place the same PC Group Webhook value in the local env file before the one-time test.`
    );
    assert(
        webhookUrl.startsWith("https://"),
        "LARK_PC_GROUP_WEBHOOK_URL must start with https://"
    );

    const keyword = getWebhookKeyword();
    const testId = `PC-NOTIFY-${Date.now()}`;
    const text = [
        `[${keyword}] 🧪 ทดสอบกลุ่มแจ้งเตือน Production & Stock`,
        "",
        `รหัสทดสอบ: ${testId}`,
        "ปลายทาง: กลุ่ม Production & Stock ใหม่",
        "กลุ่ม CRM เดิม: ยังเก็บไว้และไม่ได้รับข้อความทดสอบนี้",
        "ขอบเขต: ส่งข้อความทดสอบตรงเข้า Webhook ใหม่เท่านั้น",
        "ผลกระทบข้อมูล: ไม่มีการแก้ Record, Stock, Material หรือ Production",
        "Feature flag: PC_INVENTORY_ENABLED=false",
    ].join("\n");

    const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            msg_type: "text",
            content: { text },
        }),
        signal: AbortSignal.timeout(30_000),
    });

    const raw = await response.text();
    let payload = raw;

    try {
        payload = raw ? JSON.parse(raw) : {};
    } catch {
        payload = raw;
    }

    assert(
        response.ok,
        `Lark PC Group Webhook HTTP ${response.status}: ${String(raw).slice(0, 500)}`
    );

    const code = responseCode(payload);
    assert(
        code === null || code === 0,
        `Lark PC Group Webhook rejected test (${code}): ${responseMessage(payload)}`
    );

    return {
        ok: true,
        target: "production-control",
        secret_name:
            "LARK_PC_GROUP_WEBHOOK_URL",
        test_id: testId,
        sent_at: new Date().toISOString(),
        keyword,
        response_code: code,
        response_message: responseMessage(payload),
    };
}

function readPriorTestEvidence() {
    assert(
        fs.existsSync(outputFile),
        "Missing prior send-test evidence. Run pc:notifications:test before verify."
    );

    const parsed = JSON.parse(
        fs.readFileSync(outputFile, "utf8")
    );

    assert(
        parsed?.contract_version ===
            "pc_lark_group_notification_readiness_v2" &&
            parsed?.mode === "send-test" &&
            parsed?.webhook_test?.ok === true &&
            parsed?.webhook_test?.target ===
                "production-control" &&
            parsed?.webhook_test?.secret_name ===
                "LARK_PC_GROUP_WEBHOOK_URL",
        "Prior evidence is not a successful dedicated PC Group send-test"
    );

    const sentAt = Date.parse(
        parsed.webhook_test.sent_at || ""
    );
    assert(
        Number.isFinite(sentAt),
        "Prior send-test timestamp is invalid"
    );
    const ageMs = Date.now() - sentAt;
    assert(
        ageMs >= 0 &&
            ageMs <= 24 * 60 * 60 * 1000,
        "Prior send-test evidence is older than 24 hours"
    );

    return {
        ok: true,
        target: "production-control",
        secret_name:
            "LARK_PC_GROUP_WEBHOOK_URL",
        test_id: parsed.webhook_test.test_id,
        sent_at: parsed.webhook_test.sent_at,
        age_seconds: Math.floor(ageMs / 1000),
    };
}

async function main() {
    const staticContracts = assertStaticContracts();
    const remoteSecrets = listRemoteSecrets();
    const priorTest =
        mode === "verify"
            ? readPriorTestEvidence()
            : null;
    const webhookTest =
        mode === "send-test"
            ? await sendWebhookTest()
            : priorTest;

    const result = {
        contract_version:
            "pc_lark_group_notification_readiness_v2",
        mode,
        static_contracts: staticContracts,
        cloudflare_secrets: remoteSecrets,
        webhook_test: webhookTest,
        safety: {
            pc_inventory_enabled: false,
            old_crm_group_webhook_changed: false,
            lark_record_mutations: 0,
            queue_messages_sent: 0,
            stock_mutations: 0,
            material_mutations: 0,
            production_mutations: 0,
            worker_deployments: 0,
            group_test_messages_sent:
                mode === "send-test" ? 1 : 0,
        },
        generated_at: new Date().toISOString(),
    };

    fs.writeFileSync(
        outputFile,
        JSON.stringify(result, null, 2),
        "utf8"
    );
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(
        `FAILED: ${redact(error?.stack || error)}`
    );
    process.exitCode = 1;
});
