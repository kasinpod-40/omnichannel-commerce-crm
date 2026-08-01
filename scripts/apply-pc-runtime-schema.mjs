#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const mode = args.includes("--apply")
    ? "apply"
    : args.includes("--verify")
      ? "verify"
      : "plan";
const envFileIndex = args.indexOf("--env-file");
const envFile =
    envFileIndex >= 0
        ? args[envFileIndex + 1]
        : path.resolve(process.cwd(), ".dev.vars");

function parseEnvFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return {};
    const values = {};

    for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        values[key] = value;
    }

    return values;
}

const env = {
    ...parseEnvFile(envFile),
    ...process.env,
};
const appToken = env.PC_BASE_APP_TOKEN || env.LARK_APP_TOKEN;
const baseUrl = env.LARK_OPEN_API_BASE || "https://open.larksuite.com";

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function redacted(message) {
    return String(message)
        .replaceAll(env.LARK_APP_SECRET || "__never__", "[REDACTED]")
        .replaceAll(env.LARK_APP_ID || "__never__", "[REDACTED]");
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function request(method, endpoint, { token, body, retries = 4 } = {}) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
        let response;

        try {
            response = await fetch(`${baseUrl}${endpoint}`, {
                method,
                headers: {
                    "Content-Type": "application/json; charset=utf-8",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(30_000),
            });
        } catch (error) {
            if (attempt + 1 >= retries) throw error;
            await sleep(500 * 2 ** attempt);
            continue;
        }

        const raw = await response.text();
        let payload;

        try {
            payload = raw ? JSON.parse(raw) : {};
        } catch {
            payload = { code: -1, msg: raw };
        }

        const transient =
            response.status === 429 ||
            response.status >= 500 ||
            [1254002, 1254608].includes(payload.code);

        if (
            (!response.ok || payload.code !== 0) &&
            transient &&
            attempt + 1 < retries
        ) {
            await sleep(600 * 2 ** attempt);
            continue;
        }

        if (!response.ok || payload.code !== 0) {
            throw new Error(
                redacted(
                    `${method} ${endpoint} failed: HTTP ${response.status}; code=${payload.code}; msg=${payload.msg}`
                )
            );
        }

        await sleep(120);
        return payload;
    }

    throw new Error(`${method} ${endpoint} exhausted retries`);
}

async function tenantToken() {
    assert(env.LARK_APP_ID, "Missing LARK_APP_ID");
    assert(env.LARK_APP_SECRET, "Missing LARK_APP_SECRET");
    const payload = await request(
        "POST",
        "/open-apis/auth/v3/tenant_access_token/internal",
        {
            body: {
                app_id: env.LARK_APP_ID,
                app_secret: env.LARK_APP_SECRET,
            },
        }
    );
    assert(payload.tenant_access_token, "Missing tenant_access_token");
    return payload.tenant_access_token;
}

async function listFields(token, tableId) {
    const fields = [];
    let pageToken = "";

    do {
        const params = new URLSearchParams({ page_size: "100" });
        if (pageToken) params.set("page_token", pageToken);
        const payload = await request(
            "GET",
            `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?${params}`,
            { token }
        );
        fields.push(...(payload.data?.items || []));
        pageToken = payload.data?.has_more
            ? payload.data?.page_token || ""
            : "";
    } while (pageToken);

    return fields;
}

const schema = [
    {
        table: "Orders",
        tableId: env.ORDERS_TABLE_ID,
        fields: [
            {
                field_name: "pc_inventory_status",
                type: 3,
                options: [
                    "NOT_REQUIRED",
                    "QUEUED",
                    "PREPARED",
                    "APPLIED",
                    "RELEASED",
                    "BLOCKED",
                ],
            },
            { field_name: "pc_inventory_state_json", type: 1 },
            { field_name: "pc_inventory_updated_at", type: 5 },
        ],
    },
    {
        table: "PC_Production",
        tableId: env.PC_PRODUCTION_TABLE_ID,
        fields: [
            { field_name: "inventory_posting_state_json", type: 1 },
        ],
    },
    {
        table: "Activities",
        tableId: env.ACTIVITIES_TABLE_ID,
        fields: [
            {
                field_name: "action",
                type: 3,
                options: [
                    "PC_ORDER_STOCK_APPLIED",
                    "PC_ORDER_STOCK_BLOCKED",
                    "PC_PRODUCTION_COMPLETED",
                    "PC_PRODUCTION_BLOCKED",
                ],
            },
        ],
    },
    {
        table: "Notifications",
        tableId: env.NOTIFICATIONS_TABLE_ID,
        fields: [
            {
                field_name: "notification_type",
                type: 3,
                options: [
                    "PC_STOCK_EXCEPTION",
                    "PC_MATERIAL_SHORTAGE",
                ],
            },
        ],
    },
];

function createPayload(spec) {
    return {
        field_name: spec.field_name,
        type: spec.type,
        ...(spec.options
            ? {
                  property: {
                      options: spec.options.map((name) => ({ name })),
                  },
              }
            : {}),
    };
}

async function ensureField(token, table, spec) {
    const fields = await listFields(token, table.tableId);
    const existing = fields.find(
        (field) => field.field_name === spec.field_name
    );

    if (!existing) {
        if (mode === "verify") {
            throw new Error(
                `Missing field ${table.table}.${spec.field_name}`
            );
        }

        if (mode === "apply") {
            await request(
                "POST",
                `/open-apis/bitable/v1/apps/${appToken}/tables/${table.tableId}/fields`,
                { token, body: createPayload(spec) }
            );
        }

        return {
            table: table.table,
            field: spec.field_name,
            action: "create",
        };
    }

    if (Number(existing.type) !== Number(spec.type)) {
        throw new Error(
            `Field type mismatch ${table.table}.${spec.field_name}: actual=${existing.type}, expected=${spec.type}`
        );
    }

    const currentOptions = existing.property?.options || [];
    const currentNames = new Set(currentOptions.map((option) => option.name));
    const missingOptions = (spec.options || []).filter(
        (name) => !currentNames.has(name)
    );

    if (missingOptions.length === 0) {
        return {
            table: table.table,
            field: spec.field_name,
            action: "reuse",
        };
    }

    if (mode === "verify") {
        throw new Error(
            `Missing options ${table.table}.${spec.field_name}: ${missingOptions.join(",")}`
        );
    }

    if (mode === "apply") {
        await request(
            "PUT",
            `/open-apis/bitable/v1/apps/${appToken}/tables/${table.tableId}/fields/${existing.field_id}`,
            {
                token,
                body: {
                    field_name: existing.field_name,
                    type: existing.type,
                    property: {
                        options: [
                            ...currentOptions.map((option) => ({
                                id: option.id,
                                name: option.name,
                                color: option.color,
                            })),
                            ...missingOptions.map((name) => ({ name })),
                        ],
                    },
                },
            }
        );
    }

    return {
        table: table.table,
        field: spec.field_name,
        action: "merge_options",
        options: missingOptions,
    };
}

async function main() {
    console.log(`PC runtime schema mode: ${mode.toUpperCase()}`);
    console.log(`Base app_token: ${appToken}`);
    console.log("No delete operation is implemented.");

    assert(appToken, "Missing PC_BASE_APP_TOKEN/LARK_APP_TOKEN");

    for (const table of schema) {
        assert(table.tableId, `Missing table ID for ${table.table}`);
    }

    const token = await tenantToken();
    const metadata = await request(
        "GET",
        `/open-apis/bitable/v1/apps/${appToken}`,
        { token }
    );
    const actions = [];

    for (const table of schema) {
        for (const field of table.fields) {
            actions.push(await ensureField(token, table, field));
        }
    }

    if (mode === "apply") {
        for (const table of schema) {
            const fields = await listFields(token, table.tableId);
            for (const spec of table.fields) {
                const actual = fields.find(
                    (field) => field.field_name === spec.field_name
                );
                assert(actual, `Apply verification missing ${table.table}.${spec.field_name}`);
                assert(
                    Number(actual.type) === Number(spec.type),
                    `Apply verification type mismatch ${table.table}.${spec.field_name}`
                );
                const names = new Set(
                    (actual.property?.options || []).map((option) => option.name)
                );
                for (const option of spec.options || []) {
                    assert(
                        names.has(option),
                        `Apply verification missing option ${table.table}.${spec.field_name}:${option}`
                    );
                }
            }
        }
    }

    const result = {
        contract_version: "pc_runtime_schema_v1",
        mode,
        base: {
            app_token: appToken,
            name: metadata.data?.app?.name,
            revision: metadata.data?.app?.revision,
        },
        actions,
        generated_at: new Date().toISOString(),
    };
    fs.writeFileSync(
        path.resolve(process.cwd(), "pc-runtime-schema-result.json"),
        JSON.stringify(result, null, 2),
        "utf8"
    );
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(`FAILED: ${redacted(error?.stack || error)}`);
    process.exitCode = 1;
});
