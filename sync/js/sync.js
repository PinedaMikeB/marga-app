/*
 * MARGA SQL Sync Updater
 * Local dump parser + Firestore incremental sync by per-table watermark
 */

const SYNC_STATE_COLLECTION = 'sys_sync_state';
const WRITE_BATCH_LIMIT = 400;
const CHUNK_SIZE_BYTES = 2 * 1024 * 1024;

const PRESETS = [
    {
        key: 'billing',
        label: 'Billing',
        description: 'Billing and invoice related tables',
        defaultOn: true,
        tables: ['tbl_billinfo', 'tbl_billout', 'tbl_billoutparticular', 'tbl_billoutparticulars', 'tbl_billing']
    },
    {
        key: 'collections',
        label: 'Collections',
        description: 'Collections and payment related tables',
        defaultOn: true,
        tables: ['tbl_collection', 'tbl_collectiondetails', 'tbl_paymentinfo', 'tbl_or', 'tbl_check']
    },
    {
        key: 'service',
        label: 'Service / Dispatch',
        description: 'Dispatch schedules, execution logs, requests, and service history',
        defaultOn: true,
        tables: [
            'tbl_schedule',
            'tbl_schedtime',
            'tbl_closedscheds',
            'tbl_trouble',
            'tbl_mstatus',
            'tbl_machinerequest',
            'tbl_newmachinerepair',
            'tbl_newmachinehistory'
        ]
    },
    {
        key: 'deliveries',
        label: 'Deliveries',
        description: 'Dispatch and delivery operations',
        defaultOn: true,
        tables: ['tbl_dispatchment', 'tbl_delivery', 'tbl_pullout']
    },
    {
        key: 'core',
        label: 'Core Master Data',
        description: 'Companies, branches, contracts, machines',
        defaultOn: false,
        tables: ['tbl_companylist', 'tbl_branchinfo', 'tbl_contractmain', 'tbl_machine']
    }
];

const TABLE_ID_HINTS = {
    tbl_schedule: 'id',
    tbl_schedtime: 'id',
    tbl_closedscheds: 'id',
    tbl_trouble: 'id',
    tbl_machinerequest: 'id',
    tbl_newmachinerepair: 'id',
    tbl_newmachinehistory: 'id',
    tbl_companylist: 'id',
    tbl_branchinfo: 'id',
    tbl_machine: 'id',
    tbl_contractmain: 'id',
    tbl_billinfo: 'id'
};

const syncState = {
    db: null,
    selectedPresets: new Set(PRESETS.filter((preset) => preset.defaultOn).map((preset) => preset.key)),
    running: false,
    tableSchemas: new Map(),
    tableSummaries: new Map(),
    watermarks: new Map(),
    watermarkFetchPromises: new Map(),
    parseStats: {
        statements: 0,
        createStatements: 0,
        insertStatements: 0
    },
    writeContext: {
        batch: null,
        batchOps: 0,
        committedRows: 0,
        commitCount: 0
    },
    oneTimeWarnings: new Set(),
    skipWatermarkLookup: false,
    smartDiscovery: null
};

const els = {
    presetGrid: null,
    customTablesInput: null,
    selectedTablesList: null,
    dumpFileInput: null,
    dumpNoteInput: null,
    smartScopeCheckbox: null,
    dryRunCheckbox: null,
    resetWatermarkCheckbox: null,
    processAllTablesCheckbox: null,
    startSyncBtn: null,
    initWatermarkBtn: null,
    clearLogBtn: null,
    progressFill: null,
    progressText: null,
    progressMeta: null,
    summaryBody: null,
    logOutput: null
};

function initFirebase() {
    if (!firebase?.apps?.length) {
        firebase.initializeApp({
            apiKey: FIREBASE_CONFIG.apiKey,
            authDomain: FIREBASE_CONFIG.authDomain,
            projectId: FIREBASE_CONFIG.projectId,
            storageBucket: FIREBASE_CONFIG.storageBucket,
            messagingSenderId: FIREBASE_CONFIG.messagingSenderId,
            appId: FIREBASE_CONFIG.appId
        });
    }

    syncState.db = firebase.firestore();
}

function applyUserContext() {
    if (!MargaAuth.requireAccess('sync')) return false;

    const user = MargaAuth.getUser();
    if (!user) return true;

    const avatar = document.getElementById('userAvatar');
    const userName = document.getElementById('userName');
    const userRole = document.getElementById('userRole');

    if (avatar) avatar.textContent = (user.name || user.username || 'U').charAt(0).toUpperCase();
    if (userName) userName.textContent = user.name || user.username || 'User';
    if (userRole) userRole.textContent = user.role || 'user';

    return true;
}

function cacheElements() {
    els.presetGrid = document.getElementById('presetGrid');
    els.customTablesInput = document.getElementById('customTablesInput');
    els.selectedTablesList = document.getElementById('selectedTablesList');
    els.dumpFileInput = document.getElementById('dumpFileInput');
    els.dumpNoteInput = document.getElementById('dumpNoteInput');
    els.smartScopeCheckbox = document.getElementById('smartScopeCheckbox');
    els.dryRunCheckbox = document.getElementById('dryRunCheckbox');
    els.resetWatermarkCheckbox = document.getElementById('resetWatermarkCheckbox');
    els.processAllTablesCheckbox = document.getElementById('processAllTablesCheckbox');
    els.startSyncBtn = document.getElementById('startSyncBtn');
    els.initWatermarkBtn = document.getElementById('initWatermarkBtn');
    els.clearLogBtn = document.getElementById('clearLogBtn');
    els.progressFill = document.getElementById('progressFill');
    els.progressText = document.getElementById('progressText');
    els.progressMeta = document.getElementById('progressMeta');
    els.summaryBody = document.getElementById('summaryBody');
    els.logOutput = document.getElementById('logOutput');
}

function renderPresets() {
    els.presetGrid.innerHTML = PRESETS.map((preset) => {
        const checked = syncState.selectedPresets.has(preset.key) ? 'checked' : '';

        return `
            <label class="preset-item">
                <span class="preset-title">
                    <input type="checkbox" data-preset-key="${preset.key}" ${checked}>
                    <strong>${MargaUtils.escapeHtml(preset.label)}</strong>
                </span>
                <div class="meta">${MargaUtils.escapeHtml(preset.description)}</div>
                <div class="meta">${preset.tables.map((t) => MargaUtils.escapeHtml(t)).join(', ')}</div>
            </label>
        `;
    }).join('');

    els.presetGrid.querySelectorAll('input[data-preset-key]').forEach((checkbox) => {
        checkbox.addEventListener('change', (event) => {
            const presetKey = event.target.dataset.presetKey;
            if (event.target.checked) {
                syncState.selectedPresets.add(presetKey);
            } else {
                syncState.selectedPresets.delete(presetKey);
            }
            resetSmartDiscovery();
            renderSelectedTables();
        });
    });

    renderSelectedTables();
}

function normalizeTableName(name) {
    return String(name || '')
        .trim()
        .replace(/[`"']/g, '')
        .toLowerCase();
}

function parseCustomTables() {
    return (els.customTablesInput.value || '')
        .split(',')
        .map((table) => normalizeTableName(table))
        .filter(Boolean);
}

function isSmartScopeEnabled() {
    return Boolean(els.smartScopeCheckbox?.checked);
}

function getSelectedTables() {
    const presetTables = PRESETS
        .filter((preset) => syncState.selectedPresets.has(preset.key))
        .flatMap((preset) => preset.tables)
        .map((table) => normalizeTableName(table));

    const customTables = parseCustomTables();

    return [...new Set([...presetTables, ...customTables])].sort();
}

function isAllTablesMode() {
    return Boolean(els.processAllTablesCheckbox?.checked);
}

function buildExhaustiveSmartScope(seedTables) {
    return [...new Set(seedTables.map((table) => normalizeTableName(table)).filter(Boolean))].sort();
}

function detectModulesForTables(tables) {
    const modules = new Set();
    const normalizedTables = new Set(tables.map((table) => normalizeTableName(table)));

    PRESETS.forEach((preset) => {
        if (preset.tables.some((table) => normalizedTables.has(normalizeTableName(table)))) {
            modules.add(preset.label);
        }
    });

    return [...modules].sort();
}

function renderSelectedTables() {
    if (isSmartScopeEnabled()) {
        if (syncState.smartDiscovery?.tables?.length) {
            const modules = syncState.smartDiscovery.modules?.length
                ? `Modules: ${syncState.smartDiscovery.modules.join(', ')}`
                : 'Modules: mixed';

            els.selectedTablesList.innerHTML = [
                `<span class="selected-chip">Smart scope: ${syncState.smartDiscovery.tables.length} table(s)</span>`,
                `<span class="selected-chip">${MargaUtils.escapeHtml(modules)}</span>`,
                ...syncState.smartDiscovery.tables
                    .map((table) => `<span class="selected-chip">${MargaUtils.escapeHtml(table)}</span>`)
            ].join('');
            return;
        }

        els.selectedTablesList.innerHTML =
            '<span class="selected-chip">Smart scope is enabled: table list will be discovered from dump changes.</span>';
        return;
    }

    if (isAllTablesMode()) {
        els.selectedTablesList.innerHTML = '<span class="selected-chip">All tables in dump (auto-discover)</span>';
        return;
    }

    const tables = getSelectedTables();

    if (!tables.length) {
        els.selectedTablesList.innerHTML = '<span class="selected-chip">No table selected</span>';
        return;
    }

    els.selectedTablesList.innerHTML = tables
        .map((table) => `<span class="selected-chip">${MargaUtils.escapeHtml(table)}</span>`)
        .join('');
}

function setRunState(running) {
    syncState.running = running;
    els.startSyncBtn.disabled = running;
    els.initWatermarkBtn.disabled = running;
    els.dumpFileInput.disabled = running;
    els.dryRunCheckbox.disabled = running;
    els.resetWatermarkCheckbox.disabled = running;
    if (els.smartScopeCheckbox) els.smartScopeCheckbox.disabled = running;

    els.presetGrid.querySelectorAll('input[data-preset-key]').forEach((checkbox) => {
        checkbox.disabled = running;
    });

    updateScopeControlStates();
}

function updateScopeControlStates() {
    const smartLocked = isSmartScopeEnabled();
    const controlDisabled = syncState.running || smartLocked;

    els.customTablesInput.disabled = controlDisabled;
    els.processAllTablesCheckbox.disabled = controlDisabled;

    els.presetGrid.querySelectorAll('input[data-preset-key]').forEach((checkbox) => {
        checkbox.disabled = syncState.running || smartLocked;
    });
}

function resetSmartDiscovery() {
    syncState.smartDiscovery = null;
}

function setProgress(percent, label, meta = '') {
    const clamped = Math.max(0, Math.min(100, Math.round(percent || 0)));
    els.progressFill.style.width = `${clamped}%`;
    els.progressText.textContent = label;
    els.progressMeta.textContent = meta;
}

function clearSummaryTable() {
    els.summaryBody.innerHTML = '<tr><td colspan="6" class="empty-row">Run a sync to view table summary.</td></tr>';
}

function renderSummaryTable() {
    const summaries = [...syncState.tableSummaries.values()].sort((a, b) => a.table.localeCompare(b.table));

    if (!summaries.length) {
        clearSummaryTable();
        return;
    }

    els.summaryBody.innerHTML = summaries.map((summary) => {
        const stateValue = summary.watermarkReset
            ? `${summary.lastStateId} (ignored)`
            : `${summary.lastStateId}`;

        return `
            <tr>
                <td>${MargaUtils.escapeHtml(summary.table)}</td>
                <td>${MargaUtils.escapeHtml(stateValue)}</td>
                <td>${summary.rowsSeen}</td>
                <td>${summary.newRows}</td>
                <td>${summary.skippedRows}</td>
                <td>${summary.maxIdInFile === null ? '-' : summary.maxIdInFile}</td>
            </tr>
        `;
    }).join('');
}

function clearLog() {
    els.logOutput.textContent = 'Ready.';
}

function logLine(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('en-PH', { hour12: false });
    const prefix = type === 'error' ? '[ERROR]' : type === 'warn' ? '[WARN]' : '[INFO]';

    if (els.logOutput.textContent === 'Ready.') {
        els.logOutput.textContent = '';
    }

    els.logOutput.textContent += `[${timestamp}] ${prefix} ${message}\n`;
    els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function createSummaryEntry(table, watermark, resetWatermark) {
    const existing = syncState.tableSummaries.get(table);
    if (existing) return existing;

    const summary = {
        table,
        lastStateId: watermark,
        effectiveLastId: resetWatermark ? 0 : watermark,
        watermarkReset: Boolean(resetWatermark),
        idColumn: null,
        foundInFile: false,
        rowsSeen: 0,
        newRows: 0,
        skippedRows: 0,
        missingIdRows: 0,
        maxIdInFile: null
    };

    syncState.tableSummaries.set(table, summary);
    return summary;
}

function resetRunContext(selectedTables, resetWatermark) {
    syncState.tableSchemas = new Map();
    syncState.tableSummaries = new Map();
    syncState.parseStats = { statements: 0, createStatements: 0, insertStatements: 0 };
    syncState.writeContext = { batch: null, batchOps: 0, committedRows: 0, commitCount: 0 };
    syncState.oneTimeWarnings = new Set();
    syncState.watermarkFetchPromises = new Map();

    selectedTables.forEach((table) => {
        const watermark = syncState.watermarks.get(table) || 0;
        createSummaryEntry(table, watermark, resetWatermark);
    });
}

function stripLeadingComments(statement) {
    let sql = statement.trim();

    while (sql.startsWith('/*') || sql.startsWith('--') || sql.startsWith('#')) {
        if (sql.startsWith('/*')) {
            const closeIdx = sql.indexOf('*/');
            if (closeIdx < 0) return '';
            sql = sql.slice(closeIdx + 2).trimStart();
            continue;
        }

        if (sql.startsWith('--') || sql.startsWith('#')) {
            const newlineIdx = sql.indexOf('\n');
            if (newlineIdx < 0) return '';
            sql = sql.slice(newlineIdx + 1).trimStart();
            continue;
        }
    }

    return sql.trim();
}

function cleanIdentifier(raw) {
    const cleaned = String(raw || '').trim();
    const parts = cleaned
        .split('.')
        .map((part) => part.replace(/`/g, '').trim())
        .filter(Boolean);

    return normalizeTableName(parts[parts.length - 1] || cleaned);
}

function parseCreateTableStatement(statement) {
    const cleanSql = stripLeadingComments(statement);
    const tableMatch = cleanSql.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:`[^`]+`\.)?`?[^`\s(]+`?)/i);

    if (!tableMatch) return null;

    const table = cleanIdentifier(tableMatch[1]);
    const firstParen = cleanSql.indexOf('(');
    const lastParen = cleanSql.lastIndexOf(')');

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

    return rawColumns
        .split(',')
        .map((item) => item.trim().replace(/[`"']/g, ''))
        .filter(Boolean);
}

function parseInsertStatement(statement) {
    const cleanSql = stripLeadingComments(statement);
    const insertMatch = cleanSql.match(/^INSERT\s+INTO\s+((?:`[^`]+`\.)?`?[^`\s(]+`?)\s*(\(([\s\S]*?)\))?\s+VALUES\s*/i);

    if (!insertMatch) return null;

    const table = cleanIdentifier(insertMatch[1]);
    const columns = insertMatch[3] ? parseColumnList(insertMatch[3]) : null;
    const valuesPart = cleanSql.slice(insertMatch[0].length).replace(/;\s*$/, '').trim();

    return { table, columns, valuesPart };
}

function parseValueTuples(valuesPart) {
    const rows = [];

    let currentRow = null;
    let currentValue = '';
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let singleEscape = false;
    let doubleEscape = false;

    for (let i = 0; i < valuesPart.length; i += 1) {
        const ch = valuesPart[i];
        const next = i + 1 < valuesPart.length ? valuesPart[i + 1] : '';

        if (!currentRow) {
            if (ch === '(') {
                currentRow = [];
                currentValue = '';
                depth = 1;
            }
            continue;
        }

        if (inSingleQuote) {
            currentValue += ch;

            if (ch === '\\') {
                singleEscape = !singleEscape;
                continue;
            }

            if (ch === '\'' && !singleEscape) {
                if (next === '\'') {
                    currentValue += next;
                    i += 1;
                } else {
                    inSingleQuote = false;
                }
            }

            if (ch !== '\\') {
                singleEscape = false;
            }

            continue;
        }

        if (inDoubleQuote) {
            currentValue += ch;

            if (ch === '\\') {
                doubleEscape = !doubleEscape;
                continue;
            }

            if (ch === '"' && !doubleEscape) {
                inDoubleQuote = false;
            }

            if (ch !== '\\') {
                doubleEscape = false;
            }

            continue;
        }

        if (ch === '\'') {
            inSingleQuote = true;
            currentValue += ch;
            continue;
        }

        if (ch === '"') {
            inDoubleQuote = true;
            currentValue += ch;
            continue;
        }

        if (ch === '(') {
            depth += 1;
            currentValue += ch;
            continue;
        }

        if (ch === ')') {
            depth -= 1;

            if (depth === 0) {
                currentRow.push(currentValue.trim());
                rows.push(currentRow);
                currentRow = null;
                currentValue = '';
            } else {
                currentValue += ch;
            }
            continue;
        }

        if (ch === ',' && depth === 1) {
            currentRow.push(currentValue.trim());
            currentValue = '';
            continue;
        }

        currentValue += ch;
    }

    return rows;
}

function decodeQuotedValue(token) {
    const quote = token[0];
    let inner = token.slice(1, -1);

    if (quote === '\'') {
        inner = inner.replace(/''/g, '\'');
    }

    inner = inner
        .replace(/\\0/g, '\u0000')
        .replace(/\\b/g, '\b')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\Z/g, '\u001a')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, '\'')
        .replace(/\\\\/g, '\\');

    return inner;
}

function parseSqlValue(rawToken) {
    const token = String(rawToken || '').trim();

    if (token === '') return '';
    if (/^null$/i.test(token)) return null;
    if (/^true$/i.test(token)) return true;
    if (/^false$/i.test(token)) return false;

    if ((token.startsWith('\'') && token.endsWith('\'')) || (token.startsWith('"') && token.endsWith('"'))) {
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

function createRecord(columns, rawValues) {
    const record = {};

    columns.forEach((column, idx) => {
        const value = parseSqlValue(rawValues[idx]);
        record[column] = value;
    });

    return record;
}

function guessIdColumn(table, columns) {
    if (!columns || !columns.length) return null;

    if (TABLE_ID_HINTS[table] && columns.includes(TABLE_ID_HINTS[table])) {
        return TABLE_ID_HINTS[table];
    }

    const schema = syncState.tableSchemas.get(table);
    if (schema?.autoIncrementColumn && columns.includes(schema.autoIncrementColumn)) {
        return schema.autoIncrementColumn;
    }

    const candidates = [
        'id',
        `${table}_id`,
        `${table.replace(/^tbl_/, '')}_id`,
        'request_id',
        'collection_id',
        'billing_id',
        'bill_id'
    ];

    for (const candidate of candidates) {
        if (columns.includes(candidate)) return candidate;
    }

    const suffixCandidate = columns.find((column) => column.toLowerCase().endsWith('_id'));
    if (suffixCandidate) return suffixCandidate;

    return columns[0];
}

function toNumericId(value) {
    if (value === null || value === undefined || value === '') return null;

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;

    return Math.trunc(parsed);
}

function getSummary(table) {
    return syncState.tableSummaries.get(table);
}

async function loadWatermarkForTable(table) {
    if (syncState.skipWatermarkLookup) {
        syncState.watermarks.set(table, 0);
        return 0;
    }

    if (syncState.watermarks.has(table)) {
        return syncState.watermarks.get(table) || 0;
    }

    if (syncState.watermarkFetchPromises.has(table)) {
        return syncState.watermarkFetchPromises.get(table);
    }

    const pending = (async () => {
        try {
            const doc = await syncState.db.collection(SYNC_STATE_COLLECTION).doc(table).get();
            if (!doc.exists) {
                syncState.watermarks.set(table, 0);
                return 0;
            }

            const data = doc.data() || {};
            const lastId = Number(data.last_id || 0);
            const safeLastId = Number.isFinite(lastId) ? Math.trunc(lastId) : 0;
            syncState.watermarks.set(table, safeLastId);
            return safeLastId;
        } catch (error) {
            syncState.watermarks.set(table, 0);
            logLine(`Failed reading watermark for ${table}: ${error.message}`, 'warn');
            return 0;
        } finally {
            syncState.watermarkFetchPromises.delete(table);
        }
    })();

    syncState.watermarkFetchPromises.set(table, pending);
    return pending;
}

async function ensureSummaryForTable(table, resetWatermark) {
    const existing = getSummary(table);
    if (existing) return existing;

    const watermark = await loadWatermarkForTable(table);
    return createSummaryEntry(table, watermark, resetWatermark);
}

function oneTimeWarn(key, message) {
    if (syncState.oneTimeWarnings.has(key)) return;
    syncState.oneTimeWarnings.add(key);
    logLine(message, 'warn');
}

async function flushBatch(force = false) {
    if (!syncState.writeContext.batch || syncState.writeContext.batchOps === 0) return;
    if (!force && syncState.writeContext.batchOps < WRITE_BATCH_LIMIT) return;

    const pendingOps = syncState.writeContext.batchOps;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await syncState.writeContext.batch.commit();
            syncState.writeContext.committedRows += pendingOps;
            syncState.writeContext.commitCount += 1;
            syncState.writeContext.batch = syncState.db.batch();
            syncState.writeContext.batchOps = 0;
            return;
        } catch (error) {
            if (attempt === 3) throw error;
            logLine(`Batch commit retry ${attempt} failed: ${error.message}`, 'warn');
            await wait(600 * attempt);
        }
    }
}

async function queueWrite(table, idValue, payload) {
    if (!syncState.writeContext.batch) {
        syncState.writeContext.batch = syncState.db.batch();
    }

    const docRef = syncState.db.collection(table).doc(String(idValue));
    syncState.writeContext.batch.set(docRef, payload, { merge: true });
    syncState.writeContext.batchOps += 1;

    if (syncState.writeContext.batchOps >= WRITE_BATCH_LIMIT) {
        await flushBatch(true);
    }
}

async function processInsertStatement(statementInfo, dryRun, resetWatermark) {
    const { table, columns, valuesPart } = statementInfo;
    const summary = await ensureSummaryForTable(table, resetWatermark);

    let resolvedColumns = columns;
    const schema = syncState.tableSchemas.get(table);

    if (!resolvedColumns || !resolvedColumns.length) {
        resolvedColumns = schema?.columns || null;
    }

    if (!resolvedColumns || !resolvedColumns.length) {
        oneTimeWarn(
            `missing-columns-${table}`,
            `${table}: INSERT without column list and no CREATE TABLE schema found. Statement skipped.`
        );
        return;
    }

    if (!summary.idColumn) {
        summary.idColumn = guessIdColumn(table, resolvedColumns);
    }

    const idColumn = summary.idColumn;
    if (!idColumn || !resolvedColumns.includes(idColumn)) {
        oneTimeWarn(`missing-id-column-${table}`, `${table}: could not detect ID column. Table skipped.`);
        return;
    }

    const rows = parseValueTuples(valuesPart);
    summary.foundInFile = true;

    for (let i = 0; i < rows.length; i += 1) {
        const rawValues = rows[i];
        const record = createRecord(resolvedColumns, rawValues);

        summary.rowsSeen += 1;

        const numericId = toNumericId(record[idColumn]);
        if (numericId === null) {
            summary.skippedRows += 1;
            summary.missingIdRows += 1;
            continue;
        }

        summary.maxIdInFile = summary.maxIdInFile === null
            ? numericId
            : Math.max(summary.maxIdInFile, numericId);

        if (numericId <= summary.effectiveLastId) {
            summary.skippedRows += 1;
            continue;
        }

        summary.newRows += 1;

        if (!dryRun) {
            await queueWrite(table, numericId, record);
        }
    }
}

async function processSqlStatement(rawStatement, selectedTableSet, dryRun, resetWatermark) {
    const statement = stripLeadingComments(rawStatement);
    if (!statement) return;

    syncState.parseStats.statements += 1;

    if (/^CREATE\s+TABLE/i.test(statement)) {
        syncState.parseStats.createStatements += 1;

        const createInfo = parseCreateTableStatement(statement);
        if (!createInfo) return;

        const { table, columns, autoIncrementColumn } = createInfo;
        if (selectedTableSet && !selectedTableSet.has(table)) return;

        syncState.tableSchemas.set(table, { columns, autoIncrementColumn });

        const summary = await ensureSummaryForTable(table, resetWatermark);
        if (summary) {
            summary.foundInFile = true;
            if (!summary.idColumn && autoIncrementColumn) {
                summary.idColumn = autoIncrementColumn;
            }
        }

        return;
    }

    if (/^INSERT\s+INTO/i.test(statement)) {
        syncState.parseStats.insertStatements += 1;

        const insertInfo = parseInsertStatement(statement);
        if (!insertInfo) return;

        if (selectedTableSet && !selectedTableSet.has(insertInfo.table)) return;

        await processInsertStatement(insertInfo, dryRun, resetWatermark);
    }
}

async function scanSqlFile(file, onStatement, onProgress) {
    const parserState = {
        buffer: '',
        inSingleQuote: false,
        inDoubleQuote: false,
        inBacktick: false,
        inLineComment: false,
        inBlockComment: false,
        singleEscape: false,
        doubleEscape: false
    };

    const emitStatement = async () => {
        const sql = parserState.buffer.trim();
        parserState.buffer = '';
        if (sql) {
            await onStatement(sql);
        }
    };

    let offset = 0;

    while (offset < file.size) {
        const end = Math.min(file.size, offset + CHUNK_SIZE_BYTES);
        const chunk = await file.slice(offset, end).text();

        for (let i = 0; i < chunk.length; i += 1) {
            const ch = chunk[i];
            const next = i + 1 < chunk.length ? chunk[i + 1] : '';
            const prev = i > 0 ? chunk[i - 1] : '';
            const next2 = i + 2 < chunk.length ? chunk[i + 2] : '';

            parserState.buffer += ch;

            if (parserState.inLineComment) {
                if (ch === '\n') {
                    parserState.inLineComment = false;
                }
                continue;
            }

            if (parserState.inBlockComment) {
                if (ch === '*' && next === '/') {
                    parserState.buffer += '/';
                    i += 1;
                    parserState.inBlockComment = false;
                }
                continue;
            }

            if (parserState.inSingleQuote) {
                if (ch === '\\') {
                    parserState.singleEscape = !parserState.singleEscape;
                    continue;
                }

                if (ch === '\'' && !parserState.singleEscape) {
                    if (next === '\'') {
                        parserState.buffer += next;
                        i += 1;
                    } else {
                        parserState.inSingleQuote = false;
                    }
                }

                if (ch !== '\\') {
                    parserState.singleEscape = false;
                }

                continue;
            }

            if (parserState.inDoubleQuote) {
                if (ch === '\\') {
                    parserState.doubleEscape = !parserState.doubleEscape;
                    continue;
                }

                if (ch === '"' && !parserState.doubleEscape) {
                    parserState.inDoubleQuote = false;
                }

                if (ch !== '\\') {
                    parserState.doubleEscape = false;
                }

                continue;
            }

            if (parserState.inBacktick) {
                if (ch === '`') {
                    parserState.inBacktick = false;
                }
                continue;
            }

            if (ch === '#') {
                parserState.inLineComment = true;
                continue;
            }

            if (ch === '-' && next === '-' && /\s/.test(prev || ' ') && /\s/.test(next2 || ' ')) {
                parserState.buffer += next;
                i += 1;
                parserState.inLineComment = true;
                continue;
            }

            if (ch === '/' && next === '*') {
                parserState.buffer += next;
                i += 1;
                parserState.inBlockComment = true;
                continue;
            }

            if (ch === '\'') {
                parserState.inSingleQuote = true;
                continue;
            }

            if (ch === '"') {
                parserState.inDoubleQuote = true;
                continue;
            }

            if (ch === '`') {
                parserState.inBacktick = true;
                continue;
            }

            if (ch === ';') {
                await emitStatement();
            }
        }

        offset = end;
        const percent = Math.floor((offset / file.size) * 100);
        onProgress(percent, offset, file.size);

        await wait(0);
    }

    if (parserState.buffer.trim()) {
        await onStatement(parserState.buffer.trim());
    }
}

async function loadWatermarks(selectedTables) {
    syncState.watermarks = new Map();
    syncState.watermarkFetchPromises = new Map();

    await Promise.all(selectedTables.map(async (table) => {
        try {
            const doc = await syncState.db.collection(SYNC_STATE_COLLECTION).doc(table).get();
            if (!doc.exists) {
                syncState.watermarks.set(table, 0);
                return;
            }

            const data = doc.data() || {};
            const lastId = Number(data.last_id || 0);
            syncState.watermarks.set(table, Number.isFinite(lastId) ? Math.trunc(lastId) : 0);
        } catch (error) {
            syncState.watermarks.set(table, 0);
            logLine(`Failed reading watermark for ${table}: ${error.message}`, 'warn');
        }
    }));
}

async function preloadAllWatermarks() {
    syncState.watermarks = new Map();
    syncState.watermarkFetchPromises = new Map();

    try {
        const snapshot = await syncState.db.collection(SYNC_STATE_COLLECTION).get();
        snapshot.forEach((doc) => {
            const table = normalizeTableName(doc.id);
            const data = doc.data() || {};
            const lastId = Number(data.last_id || 0);
            const safeLastId = Number.isFinite(lastId) ? Math.trunc(lastId) : 0;
            syncState.watermarks.set(table, safeLastId);
        });
    } catch (error) {
        logLine(`Failed preloading watermarks: ${error.message}`, 'warn');
    }
}

async function updateSyncStates(file, note, dryRun) {
    if (dryRun) return;

    const updates = [...syncState.tableSummaries.values()]
        .filter((summary) => summary.newRows > 0 && summary.maxIdInFile !== null)
        .map((summary) => ({
            table: summary.table,
            payload: {
                table: summary.table,
                last_id: summary.maxIdInFile,
                id_column: summary.idColumn || 'id',
                rows_seen: summary.rowsSeen,
                new_rows: summary.newRows,
                skipped_rows: summary.skippedRows,
                max_id_in_file: summary.maxIdInFile,
                last_file_name: file.name,
                last_file_size: file.size,
                last_note: note || '',
                updated_at: firebase.firestore.FieldValue.serverTimestamp()
            }
        }));

    for (const update of updates) {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                await syncState.db.collection(SYNC_STATE_COLLECTION).doc(update.table).set(update.payload, { merge: true });
                break;
            } catch (error) {
                if (attempt === 3) {
                    throw new Error(`State update failed for ${update.table}: ${error.message}`);
                }
                await wait(400 * attempt);
            }
        }
    }
}

function summarizeRun(dryRun, allTablesMode) {
    renderSummaryTable();

    const tableCount = syncState.tableSummaries.size;
    const totals = [...syncState.tableSummaries.values()].reduce((acc, summary) => {
        acc.rowsSeen += summary.rowsSeen;
        acc.newRows += summary.newRows;
        acc.skippedRows += summary.skippedRows;
        return acc;
    }, { rowsSeen: 0, newRows: 0, skippedRows: 0 });

    const mode = dryRun ? 'Dry run complete' : 'Sync complete';

    logLine(
        `${mode}. Tables: ${tableCount}, Rows seen: ${totals.rowsSeen}, ` +
        `New rows: ${totals.newRows}, Skipped: ${totals.skippedRows}`
    );

    logLine(
        `Statements parsed: ${syncState.parseStats.statements} ` +
        `(CREATE: ${syncState.parseStats.createStatements}, INSERT: ${syncState.parseStats.insertStatements})`
    );

    if (!dryRun) {
        logLine(
            `Firestore writes committed: ${syncState.writeContext.committedRows} ` +
            `in ${syncState.writeContext.commitCount} batch(es)`
        );
    }

    if (!allTablesMode) {
        const notFound = [...syncState.tableSummaries.values()]
            .filter((summary) => !summary.foundInFile)
            .map((summary) => summary.table);

        if (notFound.length) {
            logLine(`Selected tables not found in dump: ${notFound.join(', ')}`, 'warn');
        }
    }
}

function keepOnlySummariesForTables(tables) {
    if (!tables?.length) return;
    const allowed = new Set(tables.map((table) => normalizeTableName(table)));
    syncState.tableSummaries = new Map(
        [...syncState.tableSummaries.entries()].filter(([table]) => allowed.has(normalizeTableName(table)))
    );
}

async function discoverSmartScopeTables(file, resetWatermark) {
    resetSmartDiscovery();
    if (resetWatermark) {
        syncState.watermarks = new Map();
        syncState.watermarkFetchPromises = new Map();
    } else {
        await preloadAllWatermarks();
    }
    resetRunContext([], resetWatermark);
    renderSummaryTable();

    logLine('Smart scope scan started. Scanning full dump and checking all tables for new rows...');

    await scanSqlFile(
        file,
        async (statement) => {
            await processSqlStatement(statement, null, true, resetWatermark);
        },
        (percent, bytesLoaded, totalBytes) => {
            const mbLoaded = (bytesLoaded / (1024 * 1024)).toFixed(1);
            const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
            setProgress(percent, 'Smart Scan', `${mbLoaded} MB / ${mbTotal} MB scanned`);
        }
    );

    const changedSummaries = [...syncState.tableSummaries.values()].filter((summary) => summary.newRows > 0);
    const changedTables = changedSummaries.map((summary) => summary.table);
    const smartTables = buildExhaustiveSmartScope(changedTables);
    const modules = detectModulesForTables(smartTables);

    syncState.smartDiscovery = {
        changedTables,
        tables: smartTables,
        modules
    };

    logLine(`Smart scan checked ${syncState.tableSummaries.size} table(s) in dump.`);
    logLine(`Smart scope selected ${smartTables.length} changed table(s) for sync.`);
    if (modules.length) {
        logLine(`Module impact: ${modules.join(', ')}`);
    }

    renderSelectedTables();
    return smartTables;
}

async function commitBatchWithRetry(batch) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await batch.commit();
            return;
        } catch (error) {
            if (attempt === 3) throw error;
            logLine(`State batch retry ${attempt} failed: ${error.message}`, 'warn');
            await wait(500 * attempt);
        }
    }
}

async function writeBaselineWatermarks(file, note) {
    const summaries = [...syncState.tableSummaries.values()];
    if (!summaries.length) {
        throw new Error('No tables discovered while parsing baseline file.');
    }

    let batch = syncState.db.batch();
    let ops = 0;
    let written = 0;
    let withoutNumericId = 0;

    for (const summary of summaries) {
        const hasNumericId = summary.maxIdInFile !== null;
        const lastId = hasNumericId ? summary.maxIdInFile : 0;

        if (!hasNumericId) {
            withoutNumericId += 1;
        }

        const docRef = syncState.db.collection(SYNC_STATE_COLLECTION).doc(summary.table);
        batch.set(docRef, {
            table: summary.table,
            last_id: lastId,
            id_column: summary.idColumn || '',
            has_numeric_id: hasNumericId,
            rows_seen_in_baseline: summary.rowsSeen,
            baseline_file_name: file.name,
            baseline_file_size: file.size,
            baseline_note: note || '',
            baseline_initialized_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_at: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        ops += 1;
        written += 1;

        if (ops >= WRITE_BATCH_LIMIT) {
            await commitBatchWithRetry(batch);
            batch = syncState.db.batch();
            ops = 0;
        }
    }

    if (ops > 0) {
        await commitBatchWithRetry(batch);
    }

    return { written, withoutNumericId };
}

async function initializeWatermarksFromBaseline() {
    if (syncState.running) return;

    const file = els.dumpFileInput.files?.[0];
    if (!file) {
        alert('Please choose your baseline SQL dump first.');
        return;
    }

    const proceed = confirm(
        `Initialize watermarks from ${file.name}?\n\n` +
        'This updates sys_sync_state only (no table data rewrite).'
    );
    if (!proceed) return;

    const note = (els.dumpNoteInput.value || '').trim();

    setRunState(true);
    clearLog();
    clearSummaryTable();
    setProgress(0, 'Initializing', 'Preparing baseline scan...');

    logLine(`Baseline file: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    logLine('Mode: WATERMARK INITIALIZATION (state only, no data upload)');

    try {
        syncState.watermarks = new Map();
        syncState.watermarkFetchPromises = new Map();
        syncState.skipWatermarkLookup = true;

        resetRunContext([], true);
        renderSummaryTable();

        await scanSqlFile(
            file,
            async (statement) => {
                await processSqlStatement(statement, null, true, true);
            },
            (percent, bytesLoaded, totalBytes) => {
                const mbLoaded = (bytesLoaded / (1024 * 1024)).toFixed(1);
                const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
                setProgress(percent, 'Parsing Baseline', `${mbLoaded} MB / ${mbTotal} MB processed`);
            }
        );

        renderSummaryTable();
        setProgress(95, 'Writing State', 'Saving per-table watermarks...');

        const result = await writeBaselineWatermarks(file, note);
        setProgress(100, 'Completed', 'Baseline watermarks initialized.');

        logLine(
            `Initialization complete. State docs written: ${result.written}. ` +
            `Tables without numeric ID: ${result.withoutNumericId}.`
        );
        logLine(
            `Statements parsed: ${syncState.parseStats.statements} ` +
            `(CREATE: ${syncState.parseStats.createStatements}, INSERT: ${syncState.parseStats.insertStatements})`
        );
    } catch (error) {
        console.error(error);
        setProgress(100, 'Failed', 'Initialization failed. Check log.');
        logLine(`Initialization failed: ${error.message}`, 'error');
        alert(`Initialization failed: ${error.message}`);
    } finally {
        syncState.skipWatermarkLookup = false;
        renderSummaryTable();
        setRunState(false);
    }
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startSync() {
    if (syncState.running) return;

    const file = els.dumpFileInput.files?.[0];
    if (!file) {
        alert('Please choose a SQL dump file first.');
        return;
    }

    const smartScope = isSmartScopeEnabled();
    const allTablesMode = !smartScope && isAllTablesMode();
    let selectedTables = allTablesMode ? [] : getSelectedTables();

    if (!smartScope && !allTablesMode && !selectedTables.length) {
        alert('Please select at least one table.');
        return;
    }

    const dryRun = els.dryRunCheckbox.checked;
    const resetWatermark = els.resetWatermarkCheckbox.checked;
    const note = (els.dumpNoteInput.value || '').trim();

    setRunState(true);
    clearLog();
    clearSummaryTable();

    const tableModeText = smartScope
        ? 'Smart scope (all tables, changed rows only)'
        : allTablesMode
            ? 'All tables from dump (auto-discover)'
            : `Selected ${selectedTables.length} table(s)`;

    setProgress(0, 'Preparing', tableModeText);
    logLine(`File selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    logLine(`Mode: ${dryRun ? 'DRY RUN' : 'WRITE'} | Reset watermark: ${resetWatermark ? 'Yes' : 'No'}`);
    logLine(`Table scope: ${tableModeText}`);
    if (!smartScope && !allTablesMode) {
        logLine(`Tables: ${selectedTables.join(', ')}`);
    }

    try {
        if (smartScope) {
            const discoveredTables = await discoverSmartScopeTables(file, resetWatermark);
            if (!discoveredTables.length) {
                setProgress(100, 'Completed', 'No changed operational tables detected.');
                logLine('No changed operational tables detected. Nothing to sync.');
                clearSummaryTable();
                return;
            }

            selectedTables = discoveredTables;
            keepOnlySummariesForTables(selectedTables);
            renderSummaryTable();

            if (dryRun) {
                setProgress(100, 'Completed', 'Smart scope dry run complete.');
                summarizeRun(true, false);
                return;
            }

            syncState.watermarks = new Map();
            syncState.watermarkFetchPromises = new Map();
            await loadWatermarks(selectedTables);
            resetRunContext(selectedTables, resetWatermark);
            renderSummaryTable();

            const selectedTableSet = new Set(selectedTables);
            setProgress(3, 'Sync Pass', 'Re-reading dump for smart scope write...');

            await scanSqlFile(
                file,
                async (statement) => {
                    await processSqlStatement(statement, selectedTableSet, false, resetWatermark);
                },
                (percent, bytesLoaded, totalBytes) => {
                    const mbLoaded = (bytesLoaded / (1024 * 1024)).toFixed(1);
                    const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
                    setProgress(percent, 'Sync Pass', `${mbLoaded} MB / ${mbTotal} MB processed`);
                }
            );

            setProgress(95, 'Writing data', 'Flushing Firestore batches...');
            await flushBatch(true);
            await updateSyncStates(file, note, false);

            setProgress(100, 'Completed', 'Smart scope sync completed successfully.');
            summarizeRun(false, false);
            return;
        }

        if (allTablesMode) {
            if (resetWatermark) {
                syncState.watermarks = new Map();
                syncState.watermarkFetchPromises = new Map();
            } else {
                await preloadAllWatermarks();
            }
        } else {
            await loadWatermarks(selectedTables);
        }
        resetRunContext(selectedTables, resetWatermark);
        renderSummaryTable();

        const selectedTableSet = allTablesMode ? null : new Set(selectedTables);

        setProgress(3, 'Parsing SQL', 'Reading dump file...');

        await scanSqlFile(
            file,
            async (statement) => {
                await processSqlStatement(statement, selectedTableSet, dryRun, resetWatermark);
            },
            (percent, bytesLoaded, totalBytes) => {
                const mbLoaded = (bytesLoaded / (1024 * 1024)).toFixed(1);
                const mbTotal = (totalBytes / (1024 * 1024)).toFixed(1);
                setProgress(percent, 'Parsing SQL', `${mbLoaded} MB / ${mbTotal} MB processed`);
            }
        );

        if (!dryRun) {
            setProgress(95, 'Writing data', 'Flushing Firestore batches...');
            await flushBatch(true);
            await updateSyncStates(file, note, dryRun);
        }

        setProgress(100, 'Completed', dryRun ? 'Dry run complete.' : 'Sync completed successfully.');
        summarizeRun(dryRun, allTablesMode);
    } catch (error) {
        console.error(error);
        setProgress(100, 'Failed', 'Sync failed. Check log for details.');
        logLine(`Sync failed: ${error.message}`, 'error');
        alert(`Sync failed: ${error.message}`);
    } finally {
        renderSummaryTable();
        setRunState(false);
    }
}

function bindEvents() {
    els.customTablesInput.addEventListener('input', MargaUtils.debounce(() => {
        resetSmartDiscovery();
        renderSelectedTables();
    }, 160));
    els.processAllTablesCheckbox.addEventListener('change', () => {
        resetSmartDiscovery();
        renderSelectedTables();
    });
    els.dumpFileInput.addEventListener('change', () => {
        resetSmartDiscovery();
        renderSelectedTables();
    });
    if (els.smartScopeCheckbox) {
        els.smartScopeCheckbox.addEventListener('change', () => {
            resetSmartDiscovery();
            renderSelectedTables();
            updateScopeControlStates();
        });
    }
    els.resetWatermarkCheckbox.addEventListener('change', () => {
        resetSmartDiscovery();
        renderSelectedTables();
    });
    els.startSyncBtn.addEventListener('click', startSync);
    els.initWatermarkBtn.addEventListener('click', initializeWatermarksFromBaseline);
    els.clearLogBtn.addEventListener('click', clearLog);
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('show');
}

window.toggleSidebar = toggleSidebar;

document.addEventListener('DOMContentLoaded', () => {
    if (!applyUserContext()) return;

    cacheElements();
    initFirebase();
    bindEvents();
    renderPresets();
    updateScopeControlStates();
    clearSummaryTable();
    setProgress(0, 'Idle', 'No active sync.');
});
