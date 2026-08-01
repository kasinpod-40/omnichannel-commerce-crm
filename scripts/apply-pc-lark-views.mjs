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
const outputFile = path.resolve(process.cwd(), "pc-lark-views-result.json");

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

function assertPcFlagDisabled() {
    const wranglerPath = path.resolve(process.cwd(), "wrangler.jsonc");
    assert(fs.existsSync(wranglerPath), "Missing wrangler.jsonc");
    const text = fs.readFileSync(wranglerPath, "utf8");

    assert(
        /"PC_INVENTORY_ENABLED"\s*:\s*"false"/.test(text),
        "STOP: PC_INVENTORY_ENABLED must remain false while preparing Lark views"
    );
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
            [1254002, 1254290, 1254291, 1254608].includes(payload.code);

        if (
            (!response.ok || payload.code !== 0) &&
            transient &&
            attempt + 1 < retries
        ) {
            await sleep(600 * 2 ** attempt);
            continue;
        }

        if (!response.ok || payload.code !== 0) {
            const requestId =
                response.headers.get("x-tt-logid") ||
                response.headers.get("x-request-id") ||
                "unknown";
            throw new Error(
                redacted(
                    `${method} ${endpoint} failed: HTTP ${response.status}; code=${payload.code}; msg=${payload.msg}; request_id=${requestId}`
                )
            );
        }

        await sleep(150);
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

async function listPaged(token, endpoint) {
    const items = [];
    let pageToken = "";

    do {
        const separator = endpoint.includes("?") ? "&" : "?";
        const suffix = new URLSearchParams({
            page_size: "100",
            ...(pageToken ? { page_token: pageToken } : {}),
        });
        const payload = await request(
            "GET",
            `${endpoint}${separator}${suffix}`,
            { token }
        );

        items.push(...(payload.data?.items || []));
        pageToken = payload.data?.has_more
            ? payload.data?.page_token || ""
            : "";
    } while (pageToken);

    return items;
}

function listFields(token, tableId) {
    return listPaged(
        token,
        `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`
    );
}

function listViews(token, tableId) {
    return listPaged(
        token,
        `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views`
    );
}

async function getView(token, tableId, viewId) {
    const payload = await request(
        "GET",
        `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views/${viewId}`,
        { token }
    );

    return payload.data?.view ?? null;
}

async function createView(token, tableId, viewName) {
    const payload = await request(
        "POST",
        `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views`,
        {
            token,
            body: {
                view_name: viewName,
                view_type: "grid",
            },
        }
    );

    const view = payload.data?.view;
    assert(view?.view_id, `Create view did not return view_id: ${viewName}`);
    return view;
}

async function patchView(token, tableId, viewId, body) {
    const payload = await request(
        "PATCH",
        `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/views/${viewId}`,
        { token, body }
    );

    return payload.data?.view ?? null;
}

function normalizeValueList(value) {
    if (Array.isArray(value)) return value.map(String).sort();
    if (typeof value !== "string") return [];

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.map(String).sort()
            : [String(parsed)];
    } catch {
        return [value];
    }
}

function sameStringList(left, right) {
    const a = [...left].map(String).sort();
    const b = [...right].map(String).sort();

    return (
        a.length === b.length &&
        a.every((value, index) => value === b[index])
    );
}

function conditionMatches(actual, desired) {
    return (
        actual?.field_id === desired.field_id &&
        actual?.operator === desired.operator &&
        sameStringList(normalizeValueList(actual?.value), desired.values)
    );
}

function viewMatches(view, desiredConditions, requiredHiddenFields) {
    const property = view?.property ?? {};
    const filterInfo = property.filter_info ?? {};
    const actualConditions = filterInfo.conditions ?? [];
    const hiddenFields = property.hidden_fields ?? [];

    return (
        filterInfo.conjunction === "and" &&
        actualConditions.length === desiredConditions.length &&
        desiredConditions.every((desired) =>
            actualConditions.some((actual) => conditionMatches(actual, desired))
        ) &&
        requiredHiddenFields.every((fieldId) => hiddenFields.includes(fieldId))
    );
}

function viewPatchBody(
    viewName,
    desiredConditions,
    existingHiddenFields,
    requiredHiddenFields
) {
    const hiddenFields = [
        ...new Set([...(existingHiddenFields ?? []), ...requiredHiddenFields]),
    ];

    return {
        view_name: viewName,
        property: {
            filter_info: {
                conditions: desiredConditions.map((condition) => ({
                    field_id: condition.field_id,
                    operator: condition.operator,
                    value: JSON.stringify(condition.values),
                })),
                conjunction: "and",
            },
            hidden_fields: hiddenFields.length > 0 ? hiddenFields : null,
        },
    };
}

const viewSpecs = [
    {
        table: "PC_Production",
        tableId: env.PC_PRODUCTION_TABLE_ID,
        views: [
            {
                name: "🏭 รออนุมัติผลิต",
                conditions: [
                    {
                        field: "production_status",
                        operator: "is",
                        values: ["RECOMMENDED", "APPROVED"],
                    },
                ],
                hide: ["inventory_posting_state_json"],
            },
            {
                name: "▶️ กำลังผลิต",
                conditions: [
                    {
                        field: "production_status",
                        operator: "is",
                        values: ["IN_PROGRESS"],
                    },
                ],
                hide: ["inventory_posting_state_json"],
            },
            {
                name: "🚫 ติดปัญหาวัตถุดิบ",
                conditions: [
                    {
                        field: "production_status",
                        operator: "is",
                        values: ["BLOCKED_MATERIAL"],
                    },
                ],
                hide: ["inventory_posting_state_json"],
            },
            {
                name: "✅ ผลิตเสร็จแล้ว",
                conditions: [
                    {
                        field: "production_status",
                        operator: "is",
                        values: ["COMPLETED"],
                    },
                ],
                hide: ["inventory_posting_state_json"],
            },
        ],
    },
    {
        table: "Notifications",
        tableId: env.NOTIFICATIONS_TABLE_ID,
        views: [
            {
                name: "🚨 แจ้งเตือนที่ยังไม่แก้",
                conditions: [
                    {
                        field: "notification_type",
                        operator: "is",
                        values: [
                            "PC_STOCK_EXCEPTION",
                            "PC_MATERIAL_SHORTAGE",
                        ],
                    },
                    {
                        field: "status",
                        operator: "is",
                        values: ["Pending", "Sent", "Failed"],
                    },
                ],
                hide: ["payload_json"],
            },
        ],
    },
];

function resolveConditionValues(field, requestedValues, viewName) {
    const fieldType = Number(field.type);

    if (fieldType !== 3 && fieldType !== 4) {
        return requestedValues.map(String);
    }

    const options = Array.isArray(field.property?.options)
        ? field.property.options
        : [];
    const optionByName = new Map(
        options.map((option) => [String(option.name), String(option.id)])
    );

    return requestedValues.map((value) => {
        const optionId = optionByName.get(String(value));
        assert(
            optionId,
            `Missing select option ${field.field_name}:${value} for view ${viewName}`
        );
        return optionId;
    });
}

function resolveViewSpec(fieldByName, spec) {
    const conditions = spec.conditions.map((condition) => {
        const field = fieldByName.get(condition.field);

        assert(
            field?.field_id,
            `Missing field ${condition.field} for view ${spec.name}`
        );

        return {
            field_id: field.field_id,
            operator: condition.operator,
            values: resolveConditionValues(field, condition.values, spec.name),
        };
    });

    const hidden = spec.hide.flatMap((fieldName) => {
        const field = fieldByName.get(fieldName);
        return field?.field_id ? [field.field_id] : [];
    });

    return { conditions, hidden };
}

async function inspectView(token, tableId, viewId) {
    const view = await getView(token, tableId, viewId);
    assert(view, `View not found after lookup: ${viewId}`);
    return view;
}

async function ensureView(token, tableId, existingViews, spec, fields) {
    const fieldByName = new Map(
        fields.map((field) => [field.field_name, field])
    );
    const desired = resolveViewSpec(fieldByName, spec);
    const matches = existingViews.filter(
        (view) => view.view_name === spec.name
    );

    assert(
        matches.length <= 1,
        `Duplicate view names require manual review: ${spec.name}`
    );

    const existing = matches[0];

    if (!existing) {
        if (mode === "verify") {
            throw new Error(`Missing view: ${spec.name}`);
        }

        if (mode === "plan") {
            return {
                view: spec.name,
                action: "create_and_configure",
            };
        }

        const created = await createView(token, tableId, spec.name);
        await patchView(
            token,
            tableId,
            created.view_id,
            viewPatchBody(spec.name, desired.conditions, [], desired.hidden)
        );
        const verified = await inspectView(token, tableId, created.view_id);

        assert(
            viewMatches(verified, desired.conditions, desired.hidden),
            `Created view verification failed: ${spec.name}`
        );

        existingViews.push(verified);

        return {
            view: spec.name,
            view_id: created.view_id,
            action: "created",
        };
    }

    const current = await inspectView(token, tableId, existing.view_id);

    if (viewMatches(current, desired.conditions, desired.hidden)) {
        return {
            view: spec.name,
            view_id: existing.view_id,
            action: "reuse",
        };
    }

    if (mode === "verify") {
        throw new Error(`View configuration mismatch: ${spec.name}`);
    }

    if (mode === "plan") {
        return {
            view: spec.name,
            view_id: existing.view_id,
            action: "update",
        };
    }

    await patchView(
        token,
        tableId,
        existing.view_id,
        viewPatchBody(
            spec.name,
            desired.conditions,
            current.property?.hidden_fields ?? [],
            desired.hidden
        )
    );

    const verified = await inspectView(token, tableId, existing.view_id);

    assert(
        viewMatches(verified, desired.conditions, desired.hidden),
        `Updated view verification failed: ${spec.name}`
    );

    return {
        view: spec.name,
        view_id: existing.view_id,
        action: "updated",
    };
}

async function main() {
    assertPcFlagDisabled();
    assert(appToken, "Missing PC_BASE_APP_TOKEN/LARK_APP_TOKEN");

    for (const table of viewSpecs) {
        assert(table.tableId, `Missing table ID for ${table.table}`);
    }

    console.log(`PC Lark native views mode: ${mode.toUpperCase()}`);
    console.log(`Base app_token: ${appToken}`);
    console.log("PC_INVENTORY_ENABLED remains false.");
    console.log(
        "No record, field, table, view deletion, or stock mutation is implemented."
    );

    const token = await tenantToken();
    const actions = [];

    for (const table of viewSpecs) {
        const [fields, views] = await Promise.all([
            listFields(token, table.tableId),
            listViews(token, table.tableId),
        ]);

        for (const spec of table.views) {
            actions.push({
                table: table.table,
                ...(await ensureView(token, table.tableId, views, spec, fields)),
            });
        }
    }

    const result = {
        contract_version: "pc_lark_native_views_v2",
        mode,
        base_app_token: appToken,
        safety: {
            pc_inventory_enabled: false,
            record_mutations: 0,
            field_mutations: 0,
            table_mutations: 0,
            view_deletions: 0,
            queue_sends: 0,
            stock_mutations: 0,
        },
        actions,
        generated_at: new Date().toISOString(),
    };

    fs.writeFileSync(outputFile, JSON.stringify(result, null, 2), "utf8");
    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error(`FAILED: ${redacted(error?.stack || error)}`);
    process.exitCode = 1;
});
