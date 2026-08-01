#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const mode = args.includes("--apply") ? "apply" : args.includes("--verify") ? "verify" : "plan";
const envPath = args.includes("--env-file") ? args[args.indexOf("--env-file") + 1] : ".dev.vars";
const outputPath = "pc-lark-views-result.json";

function readEnv(file) {
  if (!file || !fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#") || !line.includes("=")) return [];
    const i = line.indexOf("=");
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[line.slice(0, i).trim(), value]];
  }));
}

const env = { ...readEnv(path.resolve(envPath)), ...process.env };
const appToken = env.PC_BASE_APP_TOKEN || env.LARK_APP_TOKEN;
const apiBase = env.LARK_OPEN_API_BASE || "https://open.larksuite.com";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };

function redact(value) {
  let text = String(value);
  for (const secret of [env.LARK_APP_ID, env.LARK_APP_SECRET, env.LARK_WORKFLOW_TOKEN, env.NOTIFICATION_DISPATCH_TOKEN]) {
    if (secret) text = text.replaceAll(secret, "[REDACTED]");
  }
  return text;
}

function guardDisabled() {
  const text = fs.readFileSync("wrangler.jsonc", "utf8");
  assert(/"PC_INVENTORY_ENABLED"\s*:\s*"false"/.test(text), "STOP: PC_INVENTORY_ENABLED must remain false");
}

async function api(method, endpoint, token, body) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(apiBase + endpoint, {
      method,
      headers: { "Content-Type": "application/json; charset=utf-8", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const raw = await response.text();
    let payload;
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { code: -1, msg: raw }; }
    const transient = response.status === 429 || response.status >= 500 || [1254002,1254290,1254291,1254607,1254608].includes(payload.code);
    if ((!response.ok || payload.code !== 0) && transient && attempt < 4) { await sleep(600 * 2 ** attempt); continue; }
    if (!response.ok || payload.code !== 0) {
      const requestId = response.headers.get("x-tt-logid") || response.headers.get("x-request-id") || "unknown";
      throw new Error(redact(`${method} ${endpoint} failed: HTTP ${response.status}; code=${payload.code}; msg=${payload.msg}; request_id=${requestId}`));
    }
    await sleep(200);
    return payload;
  }
  throw new Error(`${method} ${endpoint} exhausted retries`);
}

async function tenantToken() {
  assert(env.LARK_APP_ID && env.LARK_APP_SECRET, "Missing LARK_APP_ID/LARK_APP_SECRET");
  const payload = await api("POST", "/open-apis/auth/v3/tenant_access_token/internal", null, { app_id: env.LARK_APP_ID, app_secret: env.LARK_APP_SECRET });
  return payload.tenant_access_token;
}

async function list(token, endpoint) {
  const items = [];
  let page = "";
  do {
    const query = new URLSearchParams({ page_size: "100", ...(page ? { page_token: page } : {}) });
    const payload = await api("GET", `${endpoint}?${query}`, token);
    items.push(...(payload.data?.items || []));
    page = payload.data?.has_more ? payload.data?.page_token || "" : "";
  } while (page);
  return items;
}

const fields = (token, table) => list(token, `/open-apis/bitable/v1/apps/${appToken}/tables/${table}/fields`);
const views = (token, table) => list(token, `/open-apis/bitable/v1/apps/${appToken}/tables/${table}/views`);
const getView = async (token, table, view) => (await api("GET", `/open-apis/bitable/v1/apps/${appToken}/tables/${table}/views/${view}`, token)).data?.view;
const createView = async (token, table, name) => (await api("POST", `/open-apis/bitable/v1/apps/${appToken}/tables/${table}/views`, token, { view_name: name, view_type: "grid" })).data?.view;
const patchView = (token, table, view, body) => api("PATCH", `/open-apis/bitable/v1/apps/${appToken}/tables/${table}/views/${view}`, token, body);

const NON_PC = ["NEW_LEAD","HOT_LEAD","PAYMENT_REVIEW","PAYMENT_VERIFIED","SALE_WON","SALE_LOST","PAYMENT_OVERDUE"];
const specs = [
  { table: "PC_Production", tableId: env.PC_PRODUCTION_TABLE_ID, views: [
    { name: "🏭 รออนุมัติผลิต", conjunction: "or", conditions: [["production_status","is","RECOMMENDED"],["production_status","is","APPROVED"]] },
    { name: "▶️ กำลังผลิต", conjunction: "and", conditions: [["production_status","is","IN_PROGRESS"]] },
    { name: "🚫 ติดปัญหาวัตถุดิบ", conjunction: "and", conditions: [["production_status","is","BLOCKED_MATERIAL"]] },
    { name: "✅ ผลิตเสร็จแล้ว", conjunction: "and", conditions: [["production_status","is","COMPLETED"]] },
  ]},
  { table: "Notifications", tableId: env.NOTIFICATIONS_TABLE_ID, views: [
    { name: "🚨 แจ้งเตือนที่ยังไม่แก้", conjunction: "and", conditions: [...NON_PC.map((value) => ["notification_type","not_equal",value]),["status","not_equal","Read"]] },
  ]},
];

function option(field, name, viewName) {
  if (![3,4].includes(Number(field.type))) return { patch: name, aliases: [name] };
  const found = (field.property?.options || []).find((item) => String(item.name) === String(name));
  assert(found?.id, `Missing select option ${field.field_name}:${name} for ${viewName}`);
  return { patch: String(found.id), aliases: [String(name), String(found.id)] };
}

const normalizeOperator = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function operatorKind(value) {
  const op = normalizeOperator(value);
  if (["is","equal","equals","eq"].includes(op)) return "equal";
  if (["isnot","notequal","notequals","neq","not"].includes(op)) return "not_equal";
  return op;
}

async function discoverNotEqual(token) {
  if (!env.PC_PRODUCTS_TABLE_ID) return "isNot";
  const [fspec, vspec] = await Promise.all([fields(token, env.PC_PRODUCTS_TABLE_ID), views(token, env.PC_PRODUCTS_TABLE_ID)]);
  const field = fspec.find((item) => item.field_name === "stock_status");
  const view = vspec.find((item) => item.view_name === "📦 สินค้าใกล้หมด");
  if (!field || !view) return "isNot";
  const full = await getView(token, env.PC_PRODUCTS_TABLE_ID, view.view_id);
  const condition = (full?.property?.filter_info?.conditions || []).find((item) => String(item.field_id) === String(field.field_id));
  return operatorKind(condition?.operator) === "not_equal" ? condition.operator : "isNot";
}

function resolveSpec(fieldList, spec, notEqual) {
  const map = new Map(fieldList.map((field) => [String(field.field_name), field]));
  return {
    conjunction: spec.conjunction,
    conditions: spec.conditions.map(([fieldName, kind, value]) => {
      const field = map.get(fieldName);
      assert(field?.field_id, `Missing field ${fieldName} for ${spec.name}`);
      const resolved = option(field, value, spec.name);
      return { field_id: String(field.field_id), field_name: fieldName, kind, operator: kind === "not_equal" ? notEqual : "is", patch: resolved.patch, aliases: resolved.aliases };
    }),
  };
}

function values(raw) {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw.flatMap(values);
  if (typeof raw === "object") return Object.values(raw).flatMap(values);
  const text = String(raw).trim();
  try { const parsed = JSON.parse(text); if (parsed !== text) return values(parsed); } catch {}
  return text ? [text] : [];
}

function matches(view, desired) {
  const filter = view?.property?.filter_info || {};
  const actual = Array.isArray(filter.conditions) ? filter.conditions : [];
  if (String(filter.conjunction || "").toLowerCase() !== desired.conjunction || actual.length !== desired.conditions.length) return false;
  const pool = [...actual];
  for (const expected of desired.conditions) {
    const index = pool.findIndex((item) => String(item.field_id) === expected.field_id && operatorKind(item.operator) === operatorKind(expected.operator) && values(item.value).length === 1 && expected.aliases.includes(String(values(item.value)[0])));
    if (index < 0) return false;
    pool.splice(index, 1);
  }
  return true;
}

function patchBody(name, desired, hidden) {
  return {
    view_name: name,
    property: {
      filter_info: {
        conjunction: desired.conjunction,
        conditions: desired.conditions.map((condition) => ({ field_id: condition.field_id, operator: condition.operator, value: JSON.stringify([condition.patch]) })),
      },
      ...(hidden?.length ? { hidden_fields: hidden } : {}),
    },
  };
}

async function ensure(token, tableId, currentViews, fieldList, spec, notEqual) {
  const desired = resolveSpec(fieldList, spec, notEqual);
  const found = currentViews.filter((view) => view.view_name === spec.name);
  assert(found.length <= 1, `Duplicate view names require manual review: ${spec.name}`);
  let view = found[0];
  if (!view) {
    if (mode === "verify") throw new Error(`Missing view: ${spec.name}`);
    if (mode === "plan") return { view: spec.name, action: "create_and_configure" };
    view = await createView(token, tableId, spec.name);
    currentViews.push(view);
  }
  let full = await getView(token, tableId, view.view_id);
  if (matches(full, desired)) return { view: spec.name, view_id: view.view_id, action: "reuse" };
  if (mode === "verify") throw new Error(`View configuration mismatch: ${spec.name}`);
  if (mode === "plan") return { view: spec.name, view_id: view.view_id, action: "update" };
  await patchView(token, tableId, view.view_id, patchBody(spec.name, desired, full?.property?.hidden_fields || []));
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    full = await getView(token, tableId, view.view_id);
    if (matches(full, desired)) return { view: spec.name, view_id: view.view_id, action: found.length ? "updated" : "created", readback_attempts: attempt };
    await sleep(Math.min(600 + attempt * 300, 2500));
  }
  throw new Error(`View verification failed after 12 attempts: ${spec.name}; actual=${JSON.stringify(full?.property?.filter_info || {})}`);
}

async function main() {
  guardDisabled();
  assert(appToken, "Missing PC_BASE_APP_TOKEN/LARK_APP_TOKEN");
  for (const group of specs) assert(group.tableId, `Missing table ID for ${group.table}`);
  console.log(`PC Lark native views mode: ${mode.toUpperCase()}`);
  console.log(`Base app_token: ${appToken}`);
  console.log("PC_INVENTORY_ENABLED remains false.");
  console.log("No record, field, table, view deletion, queue send, or stock mutation is implemented.");
  const token = await tenantToken();
  const notEqual = await discoverNotEqual(token);
  console.log(`Resolved not-equal operator: ${notEqual}`);
  const actions = [];
  for (const group of specs) {
    const [fieldList, currentViews] = await Promise.all([fields(token, group.tableId), views(token, group.tableId)]);
    for (const spec of group.views) actions.push({ table: group.table, ...(await ensure(token, group.tableId, currentViews, fieldList, spec, notEqual)) });
  }
  const result = {
    contract_version: "pc_lark_native_views_v4",
    mode,
    filter_contract: { multi_value_single_select_conditions: 0, pending_production_logic: "RECOMMENDED OR APPROVED", unresolved_notification_logic: "exclude non-PC types AND exclude Read", not_equal_operator: notEqual },
    safety: { pc_inventory_enabled: false, record_mutations: 0, field_mutations: 0, table_mutations: 0, view_deletions: 0, queue_sends: 0, stock_mutations: 0 },
    actions,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(`FAILED: ${redact(error?.stack || error)}`); process.exitCode = 1; });
