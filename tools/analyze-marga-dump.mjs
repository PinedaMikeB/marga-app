#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const INTERESTING_FIELDS = new Set([
  "id",
  "company_id",
  "branch_id",
  "contract_id",
  "contractmain_id",
  "mach_id",
  "invoice_id",
  "invoice_no",
  "invoiceno",
  "status",
  "status_id",
  "position_id",
  "tech_id",
  "serial",
  "schedule_id",
  "sched_id",
]);

const FOCUS_TABLES = new Set([
  "tbl_companylist",
  "tbl_branchinfo",
  "tbl_billinfo",
  "tbl_contractmain",
  "tbl_machine",
  "tbl_newmachinehistory",
  "tbl_billing",
  "tbl_paymentinfo",
  "tbl_collectionhistory",
  "tbl_schedule",
  "tbl_schedtime",
  "tbl_closedscheds",
  "tbl_employee",
  "tbl_empos",
  "tbl_branchcontact",
]);

function printUsage() {
  console.log("Usage: node tools/analyze-marga-dump.mjs <dump.sql> [--out report.json]");
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(args.length ? 0 : 1);
  }

  const outIdx = args.indexOf("--out");
  let outPath = null;
  if (outIdx >= 0) {
    outPath = args[outIdx + 1];
    if (!outPath) {
      throw new Error("Missing value after --out");
    }
    args.splice(outIdx, 2);
  }

  if (args.length !== 1) {
    throw new Error("Expected exactly one SQL dump path.");
  }

  return {
    dumpPath: path.resolve(args[0]),
    outPath: outPath ? path.resolve(outPath) : path.resolve(process.cwd(), "marga-dump-analysis.json"),
  };
}

function normalizeTableName(name) {
  return String(name || "")
    .trim()
    .replace(/[`"']/g, "")
    .toLowerCase();
}

function cleanIdentifier(raw) {
  const cleaned = String(raw || "").trim();
  const parts = cleaned
    .split(".")
    .map((part) => part.replace(/`/g, "").trim())
    .filter(Boolean);
  return normalizeTableName(parts[parts.length - 1] || cleaned);
}

function stripLeadingComments(statement) {
  let sql = String(statement || "").trim();

  while (sql.startsWith("/*") || sql.startsWith("--") || sql.startsWith("#")) {
    if (sql.startsWith("/*")) {
      const closeIdx = sql.indexOf("*/");
      if (closeIdx < 0) return "";
      sql = sql.slice(closeIdx + 2).trimStart();
      continue;
    }

    if (sql.startsWith("--") || sql.startsWith("#")) {
      const newlineIdx = sql.indexOf("\n");
      if (newlineIdx < 0) return "";
      sql = sql.slice(newlineIdx + 1).trimStart();
    }
  }

  return sql.trim();
}

function parseCreateTableStatement(statement) {
  const cleanSql = stripLeadingComments(statement);
  const tableMatch = cleanSql.match(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:`[^`]+`\.)?`?[^`\s(]+`?)/i,
  );

  if (!tableMatch) return null;

  const table = cleanIdentifier(tableMatch[1]);
  const firstParen = cleanSql.indexOf("(");
  const lastParen = cleanSql.lastIndexOf(")");

  if (firstParen < 0 || lastParen <= firstParen) {
    return { table, columns: [], autoIncrementColumn: null };
  }

  const definition = cleanSql.slice(firstParen + 1, lastParen);
  const lines = definition.split(/\r?\n/);

  const columns = [];
  let autoIncrementColumn = null;

  lines.forEach((line) => {
    const columnMatch = line.match(/^\s*`([^`]+)`\s+/);
    if (!columnMatch) return;

    const columnName = columnMatch[1];
    columns.push(columnName);

    if (/AUTO_INCREMENT/i.test(line)) {
      autoIncrementColumn = columnName;
    }
  });

  return { table, columns, autoIncrementColumn };
}

function parseColumnList(rawColumns) {
  const extracted = [];
  const regex = /`([^`]+)`/g;
  let match;

  while ((match = regex.exec(rawColumns)) !== null) {
    extracted.push(match[1]);
  }

  if (extracted.length) return extracted;

  return String(rawColumns || "")
    .split(",")
    .map((item) => item.trim().replace(/[`"']/g, ""))
    .filter(Boolean);
}

function parseInsertStatement(statement) {
  const cleanSql = stripLeadingComments(statement);
  const insertMatch = cleanSql.match(
    /^INSERT\s+INTO\s+((?:`[^`]+`\.)?`?[^`\s(]+`?)\s*(\(([\s\S]*?)\))?\s+VALUES\s*/i,
  );

  if (!insertMatch) return null;

  const table = cleanIdentifier(insertMatch[1]);
  const columns = insertMatch[3] ? parseColumnList(insertMatch[3]) : null;
  const valuesPart = cleanSql.slice(insertMatch[0].length).replace(/;\s*$/, "").trim();

  return { table, columns, valuesPart };
}

function decodeQuotedValue(token) {
  const quote = token[0];
  let inner = token.slice(1, -1);

  if (quote === "'") {
    inner = inner.replace(/''/g, "'");
  }

  inner = inner
    .replace(/\\0/g, "\u0000")
    .replace(/\\b/g, "\b")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\Z/g, "\u001a")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");

  return inner;
}

function parseSqlValue(rawToken) {
  const token = String(rawToken || "").trim();

  if (token === "") return "";
  if (/^null$/i.test(token)) return null;
  if (/^true$/i.test(token)) return true;
  if (/^false$/i.test(token)) return false;

  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
    return decodeQuotedValue(token);
  }

  if (/^b'[01]+'$/i.test(token)) {
    return parseInt(token.slice(2, -1), 2);
  }

  if (/^-?\d+$/.test(token)) {
    const asInt = Number(token);
    return Number.isSafeInteger(asInt) ? asInt : token;
  }

  if (/^-?\d+\.\d+$/.test(token)) {
    return Number(token);
  }

  return token;
}

function forEachValueTuple(valuesPart, onTuple) {
  let currentRow = null;
  let currentValue = "";
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let singleEscape = false;
  let doubleEscape = false;

  for (let i = 0; i < valuesPart.length; i += 1) {
    const ch = valuesPart[i];
    const next = i + 1 < valuesPart.length ? valuesPart[i + 1] : "";

    if (!currentRow) {
      if (ch === "(") {
        currentRow = [];
        currentValue = "";
        depth = 1;
      }
      continue;
    }

    if (inSingleQuote) {
      currentValue += ch;

      if (ch === "\\") {
        singleEscape = !singleEscape;
        continue;
      }

      if (ch === "'" && !singleEscape) {
        if (next === "'") {
          currentValue += next;
          i += 1;
        } else {
          inSingleQuote = false;
        }
      }

      if (ch !== "\\") {
        singleEscape = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      currentValue += ch;

      if (ch === "\\") {
        doubleEscape = !doubleEscape;
        continue;
      }

      if (ch === '"' && !doubleEscape) {
        inDoubleQuote = false;
      }

      if (ch !== "\\") {
        doubleEscape = false;
      }
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      currentValue += ch;
      continue;
    }

    if (ch === '"') {
      inDoubleQuote = true;
      currentValue += ch;
      continue;
    }

    if (ch === "(") {
      depth += 1;
      currentValue += ch;
      continue;
    }

    if (ch === ")") {
      depth -= 1;

      if (depth === 0) {
        currentRow.push(currentValue.trim());
        onTuple(currentRow);
        currentRow = null;
        currentValue = "";
      } else {
        currentValue += ch;
      }
      continue;
    }

    if (ch === "," && depth === 1) {
      currentRow.push(currentValue.trim());
      currentValue = "";
      continue;
    }

    currentValue += ch;
  }
}

function createSqlStatementParser(onStatement) {
  let buffer = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  let singleEscape = false;
  let doubleEscape = false;
  let carryChar = "";
  let skipCurrent = false;

  async function consumeChunk(sqlText, { final = false } = {}) {
    const text = `${carryChar}${String(sqlText || "")}`;
    carryChar = "";
    if (!text.length && !final) return;

    for (let i = 0; i < text.length; i += 1) {
      if (skipCurrent) {
        skipCurrent = false;
        continue;
      }

      const isLast = i === text.length - 1;
      if (!final && isLast) {
        carryChar = text[i];
        break;
      }

      const ch = text[i];
      const next = isLast ? "" : text[i + 1];
      buffer += ch;

      if (inLineComment) {
        if (ch === "\n") inLineComment = false;
        continue;
      }
      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          buffer += "/";
          skipCurrent = true;
          inBlockComment = false;
        }
        continue;
      }
      if (inSingleQuote) {
        if (ch === "\\") {
          singleEscape = !singleEscape;
          continue;
        }
        if (ch === "'" && !singleEscape) {
          if (next === "'") {
            buffer += next;
            skipCurrent = true;
            continue;
          }
          inSingleQuote = false;
        } else {
          singleEscape = false;
        }
        continue;
      }
      if (inDoubleQuote) {
        if (ch === "\\") {
          doubleEscape = !doubleEscape;
          continue;
        }
        if (ch === '"' && !doubleEscape) {
          inDoubleQuote = false;
        } else {
          doubleEscape = false;
        }
        continue;
      }
      if (inBacktick) {
        if (ch === "`") inBacktick = false;
        continue;
      }

      if (ch === "-" && next === "-") {
        inLineComment = true;
        continue;
      }
      if (ch === "#") {
        inLineComment = true;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        continue;
      }
      if (ch === "'") {
        inSingleQuote = true;
        continue;
      }
      if (ch === '"') {
        inDoubleQuote = true;
        continue;
      }
      if (ch === "`") {
        inBacktick = true;
        continue;
      }
      if (ch === ";") {
        const statement = buffer.trim();
        buffer = "";
        if (statement) {
          await onStatement(statement);
        }
      }
    }

    if (final) {
      if (carryChar) {
        buffer += carryChar;
        carryChar = "";
      }
      const statement = buffer.trim();
      if (statement) {
        await onStatement(statement);
        buffer = "";
      }
    }
  }

  return { consumeChunk };
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toKey(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function guessIdColumn(tableName, columns, schema) {
  const table = normalizeTableName(tableName);
  if (columns.includes("id")) return "id";
  if (schema?.autoIncrementColumn && columns.includes(schema.autoIncrementColumn)) return schema.autoIncrementColumn;

  const candidates = [
    `${table}_id`,
    `${table.replace(/^tbl_/, "")}_id`,
    "billing_id",
    "collection_id",
    "schedule_id",
    "sched_id",
  ];

  for (const candidate of candidates) {
    if (columns.includes(candidate)) return candidate;
  }

  return columns[0] || null;
}

function createFieldStats() {
  return {
    nonNull: 0,
    numericNonNull: 0,
    min: null,
    max: null,
    samples: [],
  };
}

function addSample(stats, value) {
  if (value === null || value === undefined || value === "") return;
  const asText = String(value);
  if (!stats.samples.includes(asText) && stats.samples.length < 5) {
    stats.samples.push(asText);
  }
}

function updateFieldStats(stats, value) {
  if (value === null || value === undefined || value === "") return;
  stats.nonNull += 1;
  addSample(stats, value);
  const numeric = toNumber(value);
  if (numeric === null) return;
  stats.numericNonNull += 1;
  stats.min = stats.min === null ? numeric : Math.min(stats.min, numeric);
  stats.max = stats.max === null ? numeric : Math.max(stats.max, numeric);
}

function makeTableState(table) {
  return {
    table,
    columns: [],
    autoIncrementColumn: null,
    insertStatements: 0,
    rowCount: 0,
    idColumn: null,
    minId: null,
    maxId: null,
    fieldStats: {},
  };
}

function ensureFieldStats(tableState, fieldName) {
  if (!tableState.fieldStats[fieldName]) {
    tableState.fieldStats[fieldName] = createFieldStats();
  }
  return tableState.fieldStats[fieldName];
}

function createAnalysisState(dumpPath, dumpSize) {
  return {
    meta: {
      dumpPath,
      dumpSizeBytes: dumpSize,
      analyzedAt: new Date().toISOString(),
    },
    parseStats: {
      statements: 0,
      createStatements: 0,
      insertStatements: 0,
    },
    tables: new Map(),
    focus: {
      companies: new Set(),
      branches: [],
      contracts: [],
      machines: new Set(),
      latestDeliveryByMachine: new Map(),
      billInfos: [],
      billings: [],
      payments: [],
      collectionHistory: [],
      schedules: [],
      schedtime: [],
      closedScheds: [],
      employees: [],
      positions: new Set(),
      branchContacts: [],
    },
  };
}

function addExample(bucket, value, limit = 5) {
  if (!Array.isArray(bucket) || bucket.length >= limit) return;
  bucket.push(value);
}

function getTableState(state, table) {
  if (!state.tables.has(table)) {
    state.tables.set(table, makeTableState(table));
  }
  return state.tables.get(table);
}

function extractValues(columns, rawValues, wantedFields = null) {
  const out = {};
  const wanted = wantedFields ? new Set(wantedFields) : null;
  columns.forEach((column, idx) => {
    if (wanted && !wanted.has(column)) return;
    out[column] = parseSqlValue(rawValues[idx]);
  });
  return out;
}

function updateLatestDeliveryByMachine(map, machId, branchId, dateValue) {
  const key = toKey(machId);
  if (!key) return;
  const branchKey = toKey(branchId);
  if (!branchKey) return;
  const dateKey = toKey(dateValue);
  const current = map.get(key);
  if (!current || dateKey > current.dateKey) {
    map.set(key, { branchId: branchKey, dateKey });
  }
}

function captureFocusRow(state, table, columns, rawValues) {
  if (!FOCUS_TABLES.has(table)) return;

  switch (table) {
    case "tbl_companylist": {
      const row = extractValues(columns, rawValues, ["id"]);
      if (row.id !== null && row.id !== undefined && row.id !== "") {
        state.focus.companies.add(toKey(row.id));
      }
      break;
    }
    case "tbl_branchinfo": {
      state.focus.branches.push(
        extractValues(columns, rawValues, ["id", "company_id", "branchname", "area_id", "city", "inactive"]),
      );
      break;
    }
    case "tbl_contractmain": {
      state.focus.contracts.push(
        extractValues(columns, rawValues, ["id", "contract_id", "mach_id", "status", "category_id"]),
      );
      break;
    }
    case "tbl_machine": {
      const row = extractValues(columns, rawValues, ["id"]);
      if (row.id !== null && row.id !== undefined && row.id !== "") {
        state.focus.machines.add(toKey(row.id));
      }
      break;
    }
    case "tbl_newmachinehistory": {
      const row = extractValues(columns, rawValues, ["mach_id", "branch_id", "status_id", "datex"]);
      if (Number(row.status_id) === 2) {
        updateLatestDeliveryByMachine(state.focus.latestDeliveryByMachine, row.mach_id, row.branch_id, row.datex);
      }
      break;
    }
    case "tbl_billinfo": {
      state.focus.billInfos.push(extractValues(columns, rawValues, ["id", "branch_id"]));
      break;
    }
    case "tbl_billing": {
      state.focus.billings.push(
        extractValues(columns, rawValues, [
          "id",
          "contractmain_id",
          "invoice_id",
          "invoiceid",
          "invoiceno",
          "invoice_no",
          "month",
          "year",
          "due_date",
          "dateprinted",
          "date_printed",
          "invdate",
          "invoice_date",
          "datex",
          "amount",
          "totalamount",
          "vatamount",
        ]),
      );
      break;
    }
    case "tbl_paymentinfo": {
      state.focus.payments.push(
        extractValues(columns, rawValues, ["invoice_id", "payment_amt", "date_deposit", "date_paid", "tax_date_paid"]),
      );
      break;
    }
    case "tbl_collectionhistory": {
      state.focus.collectionHistory.push(
        extractValues(columns, rawValues, [
          "invoice_num",
          "invoice_id",
          "invoice_no",
          "invoiceno",
          "followup_datetime",
          "followup_date",
          "next_followup",
        ]),
      );
      break;
    }
    case "tbl_schedule": {
      state.focus.schedules.push(
        extractValues(columns, rawValues, [
          "id",
          "branch_id",
          "company_id",
          "tech_id",
          "serial",
          "trouble_id",
          "purpose_id",
          "task_datetime",
          "date_finished",
        ]),
      );
      break;
    }
    case "tbl_schedtime": {
      state.focus.schedtime.push(
        extractValues(columns, rawValues, [
          "id",
          "schedule_id",
          "sched_id",
          "branch_id",
          "company_id",
          "tech_id",
          "inserted_by",
          "updated_by",
        ]),
      );
      break;
    }
    case "tbl_closedscheds": {
      state.focus.closedScheds.push(
        extractValues(columns, rawValues, ["id", "schedule_id", "sched_id", "branch_id", "company_id", "tech_id"]),
      );
      break;
    }
    case "tbl_employee": {
      state.focus.employees.push(
        extractValues(columns, rawValues, ["id", "position_id", "estatus", "email", "username", "firstname", "lastname"]),
      );
      break;
    }
    case "tbl_empos": {
      const row = extractValues(columns, rawValues, ["id"]);
      if (row.id !== null && row.id !== undefined && row.id !== "") {
        state.focus.positions.add(toKey(row.id));
      }
      break;
    }
    case "tbl_branchcontact": {
      state.focus.branchContacts.push(extractValues(columns, rawValues, ["id", "branch_id"]));
      break;
    }
    default:
      break;
  }
}

function processInsertStatement(state, insertInfo) {
  const table = insertInfo.table;
  const tableState = getTableState(state, table);
  tableState.insertStatements += 1;

  const schema = state.tables.get(table);
  const columns = insertInfo.columns && insertInfo.columns.length ? insertInfo.columns : schema?.columns || [];
  if (!columns.length) return;

  if (!tableState.idColumn) {
    tableState.idColumn = guessIdColumn(table, columns, schema);
  }

  const trackedColumns = columns
    .map((column, idx) => ({ column, idx }))
    .filter(({ column }) => INTERESTING_FIELDS.has(column) || column === tableState.idColumn);

  forEachValueTuple(insertInfo.valuesPart, (rawValues) => {
    tableState.rowCount += 1;

    trackedColumns.forEach(({ column, idx }) => {
      const value = parseSqlValue(rawValues[idx]);
      const stats = ensureFieldStats(tableState, column);
      updateFieldStats(stats, value);

      if (column === tableState.idColumn) {
        const numeric = toNumber(value);
        if (numeric !== null) {
          tableState.minId = tableState.minId === null ? numeric : Math.min(tableState.minId, numeric);
          tableState.maxId = tableState.maxId === null ? numeric : Math.max(tableState.maxId, numeric);
        }
      }
    });

    captureFocusRow(state, table, columns, rawValues);
  });
}

function finalizeReport(state) {
  const companyIds = new Set(state.focus.companies);
  const branchMap = new Map();
  const branchIds = new Set();
  state.focus.branches.forEach((row) => {
    const id = toKey(row.id);
    if (!id) return;
    branchIds.add(id);
    branchMap.set(id, {
      id,
      companyId: toKey(row.company_id),
      branchName: toKey(row.branchname),
    });
  });

  const contractMap = new Map();
  const contractIds = new Set();
  state.focus.contracts.forEach((row) => {
    const id = toKey(row.id);
    if (!id) return;
    contractIds.add(id);
    contractMap.set(id, {
      id,
      branchId: toKey(row.contract_id),
      machId: toKey(row.mach_id),
      status: toNumber(row.status),
      categoryId: toNumber(row.category_id),
    });
  });

  const machineIds = new Set(state.focus.machines);
  const employeeIds = new Set();
  state.focus.employees.forEach((row) => {
    const id = toKey(row.id);
    if (id) employeeIds.add(id);
  });

  const positionIds = new Set(state.focus.positions);
  const latestDeliveryByMachine = state.focus.latestDeliveryByMachine;

  const billingInvoiceRefs = new Set();
  state.focus.billings.forEach((row) => {
    [row.invoice_id, row.invoiceid, row.invoiceno, row.invoice_no].forEach((value) => {
      const key = toKey(value);
      if (key) billingInvoiceRefs.add(key);
    });
  });

  const checks = {
    branch_company: { total: 0, matched: 0, missingCompany: 0, examples: [] },
    billinfo_branch: { total: 0, matched: 0, missingBranch: 0, examples: [] },
    contract_direct_branch: { total: 0, matched: 0, missingBranch: 0, examples: [] },
    contract_machine: { total: 0, matched: 0, missingMachine: 0 },
    machine_delivery_branch: { total: 0, matched: 0, missingBranch: 0 },
    contract_vs_latest_delivery: { totalWithBoth: 0, sameBranch: 0, differentBranch: 0, deliveryOnly: 0, examples: [] },
    billing_contractmain: { total: 0, matched: 0, missingContract: 0 },
    billing_direct_branch_resolution: { total: 0, matchedBranch: 0, missingBranch: 0, examples: [] },
    billing_machine_history_resolution: { total: 0, matchedBranch: 0, missingBranch: 0, examples: [] },
    payment_invoice_link: { total: 0, matchedBillingRef: 0, unmatched: 0 },
    collectionhistory_invoice_link: { total: 0, matchedBillingRef: 0, unmatched: 0 },
    schedule_branch: { total: 0, matched: 0, missingBranch: 0, examples: [] },
    schedule_company: { total: 0, matched: 0, missingCompany: 0, examples: [] },
    schedule_tech: { total: 0, matched: 0, missingEmployee: 0, examples: [] },
    employee_position: { total: 0, matched: 0, missingPosition: 0, examples: [] },
    branchcontact_branch: { total: 0, matched: 0, missingBranch: 0, examples: [] },
  };

  state.focus.branches.forEach((row) => {
    checks.branch_company.total += 1;
    const companyId = toKey(row.company_id);
    if (companyId && companyIds.has(companyId)) checks.branch_company.matched += 1;
    else {
      checks.branch_company.missingCompany += 1;
      addExample(checks.branch_company.examples, {
        branch_id: toKey(row.id),
        company_id: companyId,
        branchname: toKey(row.branchname),
      });
    }
  });

  state.focus.billInfos.forEach((row) => {
    checks.billinfo_branch.total += 1;
    const branchId = toKey(row.branch_id);
    if (branchId && branchIds.has(branchId)) checks.billinfo_branch.matched += 1;
    else {
      checks.billinfo_branch.missingBranch += 1;
      addExample(checks.billinfo_branch.examples, {
        billinfo_id: toKey(row.id),
        branch_id: branchId,
      });
    }
  });

  state.focus.contracts.forEach((row) => {
    const contractId = toKey(row.id);
    const branchId = toKey(row.contract_id);
    const machId = toKey(row.mach_id);
    const delivery = latestDeliveryByMachine.get(machId);

    checks.contract_direct_branch.total += 1;
    if (branchId && branchIds.has(branchId)) checks.contract_direct_branch.matched += 1;
    else {
      checks.contract_direct_branch.missingBranch += 1;
      addExample(checks.contract_direct_branch.examples, {
        contractmain_id: contractId,
        contract_id: branchId,
        mach_id: machId,
      });
    }

    checks.contract_machine.total += 1;
    if (machId && machineIds.has(machId)) checks.contract_machine.matched += 1;
    else checks.contract_machine.missingMachine += 1;

    if (delivery && delivery.branchId && branchIds.has(delivery.branchId)) {
      checks.machine_delivery_branch.total += 1;
      checks.machine_delivery_branch.matched += 1;
    } else if (delivery) {
      checks.machine_delivery_branch.total += 1;
      checks.machine_delivery_branch.missingBranch += 1;
    }

    if (branchId && delivery?.branchId) {
      checks.contract_vs_latest_delivery.totalWithBoth += 1;
      if (branchId === delivery.branchId) checks.contract_vs_latest_delivery.sameBranch += 1;
      else {
        checks.contract_vs_latest_delivery.differentBranch += 1;
        addExample(checks.contract_vs_latest_delivery.examples, {
          contractmain_id: contractId,
          direct_branch_id: branchId,
          latest_delivery_branch_id: delivery.branchId,
          mach_id: machId,
        });
      }
    } else if (!branchId && delivery?.branchId) {
      checks.contract_vs_latest_delivery.deliveryOnly += 1;
    }
  });

  state.focus.billings.forEach((row) => {
    checks.billing_contractmain.total += 1;
    const contractId = toKey(row.contractmain_id);
    const contract = contractMap.get(contractId);
    if (contract) checks.billing_contractmain.matched += 1;
    else checks.billing_contractmain.missingContract += 1;

    const directBranchId = contract?.branchId || "";
    const deliveryBranchId = latestDeliveryByMachine.get(contract?.machId || "")?.branchId || "";

    checks.billing_direct_branch_resolution.total += 1;
    if (directBranchId && branchIds.has(directBranchId)) checks.billing_direct_branch_resolution.matchedBranch += 1;
    else {
      checks.billing_direct_branch_resolution.missingBranch += 1;
      addExample(checks.billing_direct_branch_resolution.examples, {
        billing_id: toKey(row.id),
        contractmain_id: contractId,
        direct_branch_id: directBranchId,
        mach_id: contract?.machId || "",
      });
    }

    checks.billing_machine_history_resolution.total += 1;
    if (deliveryBranchId && branchIds.has(deliveryBranchId)) {
      checks.billing_machine_history_resolution.matchedBranch += 1;
    } else {
      checks.billing_machine_history_resolution.missingBranch += 1;
      addExample(checks.billing_machine_history_resolution.examples, {
        billing_id: toKey(row.id),
        contractmain_id: contractId,
        mach_id: contract?.machId || "",
        latest_delivery_branch_id: deliveryBranchId,
      });
    }
  });

  state.focus.payments.forEach((row) => {
    checks.payment_invoice_link.total += 1;
    const ref = toKey(row.invoice_id);
    if (ref && billingInvoiceRefs.has(ref)) checks.payment_invoice_link.matchedBillingRef += 1;
    else checks.payment_invoice_link.unmatched += 1;
  });

  state.focus.collectionHistory.forEach((row) => {
    checks.collectionhistory_invoice_link.total += 1;
    const refs = [row.invoice_num, row.invoice_id, row.invoice_no, row.invoiceno].map(toKey).filter(Boolean);
    if (refs.some((ref) => billingInvoiceRefs.has(ref))) checks.collectionhistory_invoice_link.matchedBillingRef += 1;
    else checks.collectionhistory_invoice_link.unmatched += 1;
  });

  state.focus.schedules.forEach((row) => {
    const scheduleId = toKey(row.id);
    checks.schedule_branch.total += 1;
    const branchId = toKey(row.branch_id);
    if (branchId && branchIds.has(branchId)) checks.schedule_branch.matched += 1;
    else {
      checks.schedule_branch.missingBranch += 1;
      addExample(checks.schedule_branch.examples, {
        schedule_id: scheduleId,
        branch_id: branchId,
        company_id: toKey(row.company_id),
      });
    }

    checks.schedule_company.total += 1;
    const companyId = toKey(row.company_id);
    if (companyId && companyIds.has(companyId)) checks.schedule_company.matched += 1;
    else {
      checks.schedule_company.missingCompany += 1;
      addExample(checks.schedule_company.examples, {
        schedule_id: scheduleId,
        company_id: companyId,
        branch_id: branchId,
      });
    }

    checks.schedule_tech.total += 1;
    const techId = toKey(row.tech_id);
    if (!techId || employeeIds.has(techId)) checks.schedule_tech.matched += 1;
    else {
      checks.schedule_tech.missingEmployee += 1;
      addExample(checks.schedule_tech.examples, {
        schedule_id: scheduleId,
        tech_id: techId,
      });
    }
  });

  state.focus.employees.forEach((row) => {
    checks.employee_position.total += 1;
    const employeeId = toKey(row.id);
    const positionId = toKey(row.position_id);
    if (!positionId || positionIds.has(positionId)) checks.employee_position.matched += 1;
    else {
      checks.employee_position.missingPosition += 1;
      addExample(checks.employee_position.examples, {
        employee_id: employeeId,
        position_id: positionId,
        username: toKey(row.username),
      });
    }
  });

  state.focus.branchContacts.forEach((row) => {
    checks.branchcontact_branch.total += 1;
    const branchId = toKey(row.branch_id);
    if (branchId && branchIds.has(branchId)) checks.branchcontact_branch.matched += 1;
    else {
      checks.branchcontact_branch.missingBranch += 1;
      addExample(checks.branchcontact_branch.examples, {
        branchcontact_id: toKey(row.id),
        branch_id: branchId,
      });
    }
  });

  const tableList = [...state.tables.values()]
    .map((table) => ({
      table: table.table,
      columnCount: table.columns.length,
      columns: table.columns,
      autoIncrementColumn: table.autoIncrementColumn,
      insertStatements: table.insertStatements,
      rowCount: table.rowCount,
      idColumn: table.idColumn,
      minId: table.minId,
      maxId: table.maxId,
      fieldStats: table.fieldStats,
    }))
    .sort((a, b) => b.rowCount - a.rowCount || a.table.localeCompare(b.table));

  const focusSchemas = {};
  FOCUS_TABLES.forEach((table) => {
    const tableInfo = tableList.find((item) => item.table === table);
    if (tableInfo) {
      focusSchemas[table] = {
        rowCount: tableInfo.rowCount,
        columns: tableInfo.columns,
        idColumn: tableInfo.idColumn,
        minId: tableInfo.minId,
        maxId: tableInfo.maxId,
      };
    }
  });

  return {
    meta: state.meta,
    parseStats: state.parseStats,
    topTablesByRowCount: tableList.slice(0, 25).map(({ table, rowCount, columnCount, minId, maxId }) => ({
      table,
      rowCount,
      columnCount,
      minId,
      maxId,
    })),
    focusSchemas,
    relationshipChecks: checks,
    tables: tableList,
  };
}

async function analyzeDump(dumpPath) {
  const fileStat = fs.statSync(dumpPath);
  const state = createAnalysisState(dumpPath, fileStat.size);
  const parser = createSqlStatementParser(async (statement) => {
    state.parseStats.statements += 1;

    const createInfo = parseCreateTableStatement(statement);
    if (createInfo) {
      state.parseStats.createStatements += 1;
      const tableState = getTableState(state, createInfo.table);
      tableState.columns = createInfo.columns;
      tableState.autoIncrementColumn = createInfo.autoIncrementColumn;
      return;
    }

    const insertInfo = parseInsertStatement(statement);
    if (!insertInfo) return;
    state.parseStats.insertStatements += 1;
    processInsertStatement(state, insertInfo);
  });

  const stream = fs.createReadStream(dumpPath, { encoding: "utf8", highWaterMark: 1024 * 1024 });
  let bytesRead = 0;
  let lastLog = Date.now();

  for await (const chunk of stream) {
    bytesRead += Buffer.byteLength(chunk, "utf8");
    await parser.consumeChunk(chunk, { final: false });

    const now = Date.now();
    if (now - lastLog >= 5000) {
      const percent = ((bytesRead / fileStat.size) * 100).toFixed(1);
      process.stdout.write(
        `Progress: ${percent}% | statements=${state.parseStats.statements} | tables=${state.tables.size}\r`,
      );
      lastLog = now;
    }
  }

  await parser.consumeChunk("", { final: true });
  process.stdout.write("\n");

  return finalizeReport(state);
}

function printSummary(report) {
  console.log("Analysis complete.");
  console.log(`Dump: ${report.meta.dumpPath}`);
  console.log(`Statements parsed: ${report.parseStats.statements}`);
  console.log(`CREATE TABLE statements: ${report.parseStats.createStatements}`);
  console.log(`INSERT statements: ${report.parseStats.insertStatements}`);
  console.log("");
  console.log("Top tables by row count:");
  report.topTablesByRowCount.slice(0, 15).forEach((row) => {
    console.log(
      `- ${row.table}: rows=${row.rowCount.toLocaleString()} columns=${row.columnCount} idRange=${row.minId ?? "-"}..${row.maxId ?? "-"}`,
    );
  });
  console.log("");
  console.log("Relationship checks:");
  Object.entries(report.relationshipChecks).forEach(([key, value]) => {
    const parts = Object.entries(value).map(([metric, count]) => `${metric}=${count}`);
    console.log(`- ${key}: ${parts.join(", ")}`);
  });
}

async function main() {
  try {
    const { dumpPath, outPath } = parseArgs(process.argv);
    const report = await analyzeDump(dumpPath);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    printSummary(report);
    console.log("");
    console.log(`JSON report written to ${outPath}`);
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

main();
