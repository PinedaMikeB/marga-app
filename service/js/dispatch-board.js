if (!MargaAuth.requireAccess('service')) {
    throw new Error('Unauthorized access to service module.');
}

const OPS_MAX_TASK_ROWS = 300;
const OPS_QUERY_LIMIT = 5000;
const OPS_CARRYOVER_DAYS = 14;
const ZERO_DATETIME = '0000-00-00 00:00:00';
const LEGACY_EMPTY_DATETIME_VALUES = new Set([
    '',
    ZERO_DATETIME,
    'undefined',
    'undefined 00:00:00',
    'null',
    'null 00:00:00',
    'invalid date',
    'nan'
]);
const ROUTE_COLLECTION_PRIMARY = 'tbl_printedscheds';
const ROUTE_COLLECTION_FALLBACK = 'tbl_savedscheds';
const SERIAL_LOOKUP_MIN_CHARS = 4;
const PURPOSE_LABELS = {
    1: 'Billing',
    2: 'Collection',
    3: 'Deliver Ink / Toner',
    4: 'Deliver Cartridge',
    5: 'Service',
    6: 'Sales',
    7: 'Purchasing',
    8: 'Reading',
    9: 'Others'
};
const RELEASE_CATEGORY_DEFAULTS = {
    3: 'Toner / Ink',
    4: 'Cartridge'
};
const LOOKUP_COLLECTION_LIMITS = {
    tbl_employee: 2000,
    tbl_empos: 400,
    tbl_trouble: 2200,
    tbl_branchinfo: 7000,
    tbl_branchcontact: 9000,
    tbl_companylist: 3000,
    tbl_machine: 12000,
    tbl_contractmain: 7000,
    tbl_contractdep: 7000,
    tbl_area: 1500
};

const opsCache = {
    employees: new Map(),
    positions: new Map(),
    troubles: new Map(),
    branches: new Map(),
    branchContactsByBranch: new Map(),
    companies: new Map(),
    areas: new Map(),
    machines: new Map(),
    machinesBySerial: new Map(),
    contracts: new Map(),
    contractDeps: new Map(),
    activeCustomerGraphRows: [],
    activeGraphCompanies: [],
    activeGraphBranchesByCompany: new Map(),
    activeGraphBySerial: new Map(),
    closedScheduleIds: new Set(),
    fullyLoaded: new Set(),
    assignableLoaded: false
};

const opsState = {
    selectedDate: '',
    allRows: [],
    selectedRows: [],
    schedtimeRows: [],
    logsBySchedule: new Map(),
    logsByStaff: new Map(),
    panelStaffId: null,
    purposeFilter: 'all',
    statusFilter: 'all',
    assigneeRoleFilter: 'all',
    includeCarryover: false,
    routeSourceLabel: 'Printed',
    newRequestMachine: null,
    newRequestGraphRow: null,
    newRequestLookupSeq: 0
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    if (user) {
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
        document.getElementById('userAvatar').textContent = user.name.charAt(0).toUpperCase();
    }

    const purposeFilter = document.getElementById('opsPurposeFilter');
    const statusFilter = document.getElementById('opsStatusFilter');
    const assigneeRoleFilter = document.getElementById('opsAssigneeRoleFilter');
    const carryoverToggle = document.getElementById('opsCarryoverToggle');
    const carryoverBtn = document.getElementById('opsCarryoverBtn');
    const defaultPurpose = getDefaultPurposeFilter();
    if (defaultPurpose !== 'all') {
        purposeFilter.value = defaultPurpose;
    }

    document.querySelectorAll('[data-module]').forEach((el) => {
        const module = el.dataset.module;
        if (!module || module === 'dashboard') return;
        if (!MargaAuth.hasAccess(module)) {
            el.classList.add('disabled');
            el.addEventListener('click', (e) => {
                e.preventDefault();
                alert('You do not have permission to access this module.');
            });
        }
    });

    const dateInput = document.getElementById('opsDateInput');
    dateInput.value = formatDateYmd(new Date());
    dateInput.addEventListener('change', () => loadOperationsBoard());

    purposeFilter.addEventListener('change', () => {
        opsState.purposeFilter = purposeFilter.value;
        loadOperationsBoard();
    });

    statusFilter.addEventListener('change', () => {
        opsState.statusFilter = statusFilter.value;
        renderOperationsBoard();
    });

    assigneeRoleFilter.addEventListener('change', () => {
        opsState.assigneeRoleFilter = assigneeRoleFilter.value || 'all';
        renderOperationsBoard();
    });

    carryoverToggle.checked = false;
    carryoverToggle.disabled = true;
    carryoverToggle.closest('.ops-toggle')?.setAttribute('title', 'Printed route view only');

    document.getElementById('opsRefreshBtn').addEventListener('click', () => loadOperationsBoard());
    document.getElementById('opsPanelCloseBtn').addEventListener('click', closeOpsStaffPanel);
    document.getElementById('opsPanelOverlay').addEventListener('click', closeOpsStaffPanel);
    document.getElementById('opsPanelPrintAllBtn').addEventListener('click', () => {
        if (!opsState.panelStaffId) return;
        printStaffScheduleRows(opsState.panelStaffId);
    });
    carryoverBtn.style.display = 'none';

    const newReqBtn = document.getElementById('opsNewRequestBtn');
    const canCreate = MargaAuth.isAdmin() || MargaAuth.hasRole('service');
    newReqBtn.style.display = canCreate ? 'inline-flex' : 'none';
    newReqBtn.addEventListener('click', () => openNewRequestModal());

    document.getElementById('newReqCloseBtn').addEventListener('click', closeNewRequestModal);
    document.getElementById('newReqCancelBtn').addEventListener('click', closeNewRequestModal);
    document.getElementById('newReqOverlay').addEventListener('click', closeNewRequestModal);
    document.getElementById('newReqSaveBtn').addEventListener('click', () => saveNewServiceRequest());

    const dispatchNote = document.getElementById('dispatchHeaderNote');
    dispatchNote.textContent = getRoleDispatchNote();

    opsState.purposeFilter = purposeFilter.value;
    opsState.statusFilter = statusFilter.value;
    opsState.assigneeRoleFilter = assigneeRoleFilter.value || 'all';
    opsState.includeCarryover = false;
    loadOperationsBoard();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

function getDefaultPurposeFilter() {
    if (MargaAuth.hasRole('billing')) return '1';
    if (MargaAuth.hasRole('collection')) return '2';
    return 'all';
}

function getRoleDispatchNote() {
    if (MargaAuth.hasRole('billing')) {
        return 'Billing dispatch view: default filter is Billing. You can switch to other task types and assignee groups as needed.';
    }
    if (MargaAuth.hasRole('collection')) {
        return 'Collection dispatch view: default filter is Collection. You can switch to other task types and assignee groups as needed.';
    }
    if (MargaAuth.hasRole('service')) {
        return 'Service dispatch view: show all selected-date schedules, with printed/saved route details attached when available.';
    }
    return 'Unified dispatch view for service, collection, billing, delivery, and reading schedules.';
}

function formatDateYmd(date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function addDaysYmd(ymd, days) {
    const [y, m, d] = String(ymd).split('-').map((v) => Number(v));
    const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    date.setUTCDate(date.getUTCDate() + days);
    return formatDateYmd(new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseFirestoreValue(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.integerValue !== undefined) return Number(value.integerValue);
    if (value.doubleValue !== undefined) return Number(value.doubleValue);
    if (value.booleanValue !== undefined) return value.booleanValue;
    if (value.timestampValue !== undefined) return value.timestampValue;
    return null;
}

function parseFirestoreDoc(doc) {
    if (!doc?.fields) return null;
    const parsed = {};
    Object.entries(doc.fields).forEach(([key, raw]) => {
        parsed[key] = parseFirestoreValue(raw);
    });
    if (doc.name) {
        parsed._docId = doc.name.split('/').pop();
    }
    return parsed;
}

async function runFirestoreQuery(collectionId, limit) {
    const body = {
        structuredQuery: {
            from: [{ collectionId }],
            orderBy: [{ field: { fieldPath: 'id' }, direction: 'DESCENDING' }],
            limit
        }
    };

    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );
    const payload = await response.json();

    if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) {
        const message = payload?.error?.message || payload?.[0]?.error?.message || 'Query failed.';
        throw new Error(message);
    }

    if (!Array.isArray(payload)) return [];
    return payload.map((row) => row.document).filter(Boolean);
}

async function ensureClosedScheduleIdsLoaded() {
    if (opsCache.fullyLoaded.has('tbl_closedscheds')) return;

    // This table may be empty depending on what has been synced to Firestore.
    const docs = await runFirestoreQuery('tbl_closedscheds', 5000).catch(() => []);
    docs
        .map(parseFirestoreDoc)
        .filter(Boolean)
        .forEach((row) => {
            const schedId = Number(row.sched_id || row.schedid || 0);
            if (schedId > 0) opsCache.closedScheduleIds.add(schedId);
        });

    opsCache.fullyLoaded.add('tbl_closedscheds');
}

function toFirestoreQueryValue(value) {
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) return { integerValue: String(Math.trunc(value)) };
    return { stringValue: String(value ?? '') };
}

function makeFieldFilter(fieldPath, op, value) {
    return {
        fieldFilter: {
            field: { fieldPath },
            op,
            value: toFirestoreQueryValue(value)
        }
    };
}

async function runFirestoreStructuredQuery(structuredQuery) {
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredQuery })
        }
    );
    const payload = await response.json();

    if (!response.ok || (Array.isArray(payload) && payload[0]?.error)) {
        const message = payload?.error?.message || payload?.[0]?.error?.message || 'Query failed.';
        throw new Error(message);
    }

    if (!Array.isArray(payload)) return [];
    return payload.map((row) => row.document).filter(Boolean);
}

async function queryByDateRange(collectionId, fieldPath, { start, end, endOp = 'LESS_THAN_OR_EQUAL', filters = [], limit = OPS_QUERY_LIMIT }) {
    const allFilters = [
        makeFieldFilter(fieldPath, 'GREATER_THAN_OR_EQUAL', start),
        makeFieldFilter(fieldPath, endOp, end),
        ...filters
    ];

    const structuredQuery = {
        from: [{ collectionId }],
        where: { compositeFilter: { op: 'AND', filters: allFilters } },
        orderBy: [{ field: { fieldPath }, direction: 'ASCENDING' }],
        limit
    };

    return runFirestoreStructuredQuery(structuredQuery);
}

async function fetchDocById(collection, id) {
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${id}?key=${FIREBASE_CONFIG.apiKey}`
    );
    const payload = await response.json();
    if (!response.ok || payload?.error) return null;
    return parseFirestoreDoc(payload);
}

async function ensureCollectionLoaded(collection, cacheMap) {
    if (opsCache.fullyLoaded.has(collection)) return;

    const limit = LOOKUP_COLLECTION_LIMITS[collection] || 2500;
    const docs = await runFirestoreQuery(collection, limit);
    docs
        .map(parseFirestoreDoc)
        .filter(Boolean)
        .forEach((doc) => {
            const id = Number(doc.id || 0);
            if (id > 0) {
                cacheMap.set(String(id), doc);
            }
        });

    opsCache.fullyLoaded.add(collection);
}

async function ensureBranchContactsLoaded() {
    if (opsCache.fullyLoaded.has('tbl_branchcontact')) return;

    // If this isn't synced yet, it will simply be empty.
    const docs = await runFirestoreQuery('tbl_branchcontact', LOOKUP_COLLECTION_LIMITS.tbl_branchcontact || 9000).catch(() => []);
    docs
        .map(parseFirestoreDoc)
        .filter(Boolean)
        .forEach((row) => {
            const branchId = Number(row.branch_id || 0);
            if (!branchId) return;
            if (!opsCache.branchContactsByBranch.has(branchId)) {
                opsCache.branchContactsByBranch.set(branchId, []);
            }
            opsCache.branchContactsByBranch.get(branchId).push(row);
        });

    opsCache.fullyLoaded.add('tbl_branchcontact');
}

function normalizeSerialNumber(value) {
    return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function normalizeContactNumber(value) {
    return String(value || '').replace(/\D+/g, '');
}

function normalizeReleaseCategoryValue(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const lowered = text.toLowerCase();
    if (lowered.includes('toner') || lowered.includes('ink')) return 'Toner / Ink';
    if (lowered.includes('cartridge')) return 'Cartridge';
    if (lowered.includes('part')) return 'Parts';
    if (lowered.includes('other')) return 'Others';
    return text;
}

function getSelectedReleaseUnit() {
    return document.querySelector('input[name="newReqReleaseUnit"]:checked')?.value === 'set' ? 'set' : 'pc';
}

function buildReleaseRequestSummary({ category, itemRstd, unit }) {
    const normalizedCategory = normalizeReleaseCategoryValue(category);
    const item = String(itemRstd || '').trim();
    const requestLabel = item || normalizedCategory;
    if (!requestLabel) return '';
    return `1 ${unit === 'set' ? 'set' : 'pc'} ${requestLabel}`.trim();
}

function cacheMachineBySerial(machine) {
    const key = normalizeSerialNumber(machine?.serial);
    if (!key) return;
    opsCache.machinesBySerial.set(key, machine);
}

async function queryMachineDocsBySerial(serialValue) {
    const structuredQuery = {
        from: [{ collectionId: 'tbl_machine' }],
        where: makeFieldFilter('serial', 'EQUAL', serialValue),
        limit: 10
    };

    return runFirestoreStructuredQuery(structuredQuery);
}

async function findMachineBySerial(serialText) {
    const normalized = normalizeSerialNumber(serialText);
    if (!normalized || normalized.length < SERIAL_LOOKUP_MIN_CHARS) return null;

    const cached = opsCache.machinesBySerial.get(normalized);
    if (cached) return cached;

    const variants = [...new Set([
        String(serialText || '').trim(),
        normalized,
        normalized.toLowerCase()
    ].filter(Boolean))];

    const docs = (await Promise.all(
        variants.map((variant) => queryMachineDocsBySerial(variant).catch(() => []))
    )).flat();

    const machines = docs
        .map(parseFirestoreDoc)
        .filter(Boolean);

    machines.forEach(cacheMachineBySerial);

    return machines.find((machine) => normalizeSerialNumber(machine.serial) === normalized) || null;
}

function buildAccountName(companyName, branchName) {
    const company = String(companyName || '').trim();
    const branch = String(branchName || '').trim();
    if (!branch || branch.toLowerCase() === 'main') return company || 'Unknown';
    if (!company) return branch;
    const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const companyText = normalize(company);
    const branchText = normalize(branch);
    if (branchText.includes(companyText) || companyText.includes(branchText)) return branch;
    return `${company} - ${branch}`;
}

function getBranchDisplayName(branch, contractDep) {
    const branchName = String(branch?.branchname || '').trim() || `Branch #${branch?.id || ''}`.trim();
    const departmentName = String(contractDep?.departmentname || '').trim();
    if (!departmentName) return branchName;
    const normalizedBranch = branchName.toLowerCase();
    const normalizedDepartment = departmentName.toLowerCase();
    if (normalizedBranch.includes(normalizedDepartment)) return branchName;
    return `${branchName} - ${departmentName}`;
}

function getContractSerialNumber(contract, machine) {
    return String(contract?.xserial || machine?.serial || '').trim();
}

function resolveContractBranch(contract) {
    const contractDepId = String(contract?.contract_id || '').trim();
    const contractDep = opsCache.contractDeps.get(contractDepId) || null;
    const branchId = String(contractDep?.branch_id || contract?.contract_id || '').trim();
    const branch = branchId ? opsCache.branches.get(branchId) || null : null;
    return { branch, contractDep, branchId };
}

function rebuildActiveCustomerGraph() {
    const rows = [];
    const companyMap = new Map();
    const branchesByCompany = new Map();
    const bySerial = new Map();

    opsCache.machinesBySerial.clear();
    opsCache.machines.forEach(cacheMachineBySerial);

    opsCache.contracts.forEach((contract) => {
        if (Number(contract?.status || 0) !== 1) return;

        const machineId = Number(contract?.mach_id || 0) || 0;
        const machine = machineId > 0 ? opsCache.machines.get(String(machineId)) || null : null;
        const { branch, contractDep } = resolveContractBranch(contract);
        if (!branch || Number(branch.inactive || 0) === 1) return;

        const companyId = Number(branch.company_id || 0) || 0;
        const company = companyId > 0 ? opsCache.companies.get(String(companyId)) || null : null;
        if (!company) return;

        const branchId = Number(branch.id || 0) || 0;
        const companyName = String(company.companyname || '').trim() || `Company #${companyId}`;
        const branchName = getBranchDisplayName(branch, contractDep);
        const serialNumber = getContractSerialNumber(contract, machine);
        const accountName = buildAccountName(companyName, branchName);
        const row = {
            companyId,
            companyName,
            branchId,
            branchName,
            accountName,
            contractId: Number(contract.id || 0) || 0,
            contractDepId: Number(contract.contract_id || 0) || 0,
            machineId,
            serialNumber,
            machineDescription: String(machine?.description || '').trim(),
            branch,
            company,
            contract,
            machine
        };

        rows.push(row);

        if (!companyMap.has(String(companyId))) {
            companyMap.set(String(companyId), { id: companyId, name: companyName, activeAccountCount: 0 });
        }
        companyMap.get(String(companyId)).activeAccountCount += 1;

        if (!branchesByCompany.has(String(companyId))) {
            branchesByCompany.set(String(companyId), new Map());
        }
        const branchBucket = branchesByCompany.get(String(companyId));
        const branchKey = String(branchId);
        if (!branchBucket.has(branchKey)) {
            branchBucket.set(branchKey, {
                id: branchId,
                name: branchName,
                accountName,
                activeMachineCount: 0,
                rows: []
            });
        }
        const branchRow = branchBucket.get(branchKey);
        branchRow.activeMachineCount += machineId > 0 ? 1 : 0;
        branchRow.rows.push(row);

        const serialKey = normalizeSerialNumber(serialNumber);
        if (serialKey && !bySerial.has(serialKey)) {
            bySerial.set(serialKey, row);
        }
    });

    opsCache.activeCustomerGraphRows = rows.sort((left, right) => (
        left.companyName.localeCompare(right.companyName)
        || left.branchName.localeCompare(right.branchName)
        || String(left.serialNumber || '').localeCompare(String(right.serialNumber || ''))
    ));
    opsCache.activeGraphCompanies = [...companyMap.values()].sort((left, right) => left.name.localeCompare(right.name));
    opsCache.activeGraphBranchesByCompany = new Map(
        [...branchesByCompany.entries()].map(([companyId, branchMap]) => [
            companyId,
            [...branchMap.values()].sort((left, right) => left.name.localeCompare(right.name))
        ])
    );
    opsCache.activeGraphBySerial = bySerial;
}

async function ensureActiveCustomerGraphLoaded() {
    await Promise.all([
        ensureCollectionLoaded('tbl_companylist', opsCache.companies),
        ensureCollectionLoaded('tbl_branchinfo', opsCache.branches),
        ensureCollectionLoaded('tbl_contractmain', opsCache.contracts),
        ensureCollectionLoaded('tbl_contractdep', opsCache.contractDeps),
        ensureCollectionLoaded('tbl_machine', opsCache.machines)
    ]);
    rebuildActiveCustomerGraph();
}

function findGraphRowBySerial(serialText) {
    const normalized = normalizeSerialNumber(serialText);
    if (!normalized || normalized.length < SERIAL_LOOKUP_MIN_CHARS) return null;
    return opsCache.activeGraphBySerial.get(normalized) || null;
}

function getMachineDisplayName(machine) {
    if (!machine) return '';
    return String(machine.description || machine.modelname || machine.model || machine.serial || '').trim();
}

function resolveMachineCustomer(machine) {
    const branchId = Number(machine?.client_id || machine?.branch_id || 0);
    const branch = branchId > 0 ? opsCache.branches.get(String(branchId)) || null : null;
    const companyId = Number(branch?.company_id || machine?.company_id || 0);
    const company = companyId > 0 ? opsCache.companies.get(String(companyId)) || null : null;
    const directCompany = !company && branchId > 0 ? opsCache.companies.get(String(branchId)) || null : null;

    return {
        branch,
        company: company || directCompany || null,
        branchId: Number(branch?.id || branchId || 0),
        companyId: Number((company || directCompany)?.id || companyId || 0)
    };
}

function setNewReqSerialStatus(message, tone = '') {
    const status = document.getElementById('newReqSerialStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-match', tone === 'match');
    status.classList.toggle('is-warning', tone === 'warning');
    status.classList.toggle('is-error', tone === 'error');
}

async function fetchManyDocs(collection, ids, cacheMap) {
    const uniqueIds = [...new Set(ids)]
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0);
    if (!uniqueIds.length) return;

    await ensureCollectionLoaded(collection, cacheMap);

    const pending = uniqueIds.filter((id) => !cacheMap.has(String(id)));
    if (!pending.length) return;

    await Promise.all(pending.map(async (id) => {
        const doc = await fetchDocById(collection, id);
        if (doc) {
            cacheMap.set(String(id), doc);
        }
    }));
}

function toFirestoreFieldValue(value) {
    if (value === null) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return { integerValue: String(Math.trunc(value)) };
    return { stringValue: String(value ?? '') };
}

async function patchDocument(collection, docId, fields) {
    const updateKeys = Object.keys(fields);
    if (!updateKeys.length) return;

    const params = updateKeys
        .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join('&');

    const body = { fields: {} };
    updateKeys.forEach((key) => {
        body.fields[key] = toFirestoreFieldValue(fields[key]);
    });

    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}&${params}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );

    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to update ${collection}/${docId}`);
    }

    return payload;
}

async function deleteDocument(collection, docId) {
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}`,
        { method: 'DELETE' }
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to delete ${collection}/${docId}`);
    }
}

async function setDocument(collection, docId, fields) {
    const body = { fields: {} };
    Object.entries(fields).forEach(([key, value]) => {
        body.fields[key] = toFirestoreFieldValue(value);
    });

    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${docId}?key=${FIREBASE_CONFIG.apiKey}`,
        {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        }
    );

    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to set ${collection}/${docId}`);
    }
    return payload;
}

async function ensureAssignableEmployeesLoaded() {
    if (opsCache.assignableLoaded) return;

    await ensureCollectionLoaded('tbl_employee', opsCache.employees);
    const employees = [...opsCache.employees.values()].filter(Boolean);
    const positionIds = [...new Set(employees.map((employee) => Number(employee.position_id || 0)).filter((id) => id > 0))];
    await fetchManyDocs('tbl_empos', positionIds, opsCache.positions);

    opsCache.assignableLoaded = true;
}

function getEmployeeName(employee, id) {
    if (!employee) return `ID ${id} (unmapped)`;
    const nickname = (employee.nickname || '').trim();
    const first = (employee.firstname || '').trim();
    const last = (employee.lastname || '').trim();
    if (nickname) return nickname;
    return `${first} ${last}`.trim() || `ID ${id}`;
}

function getRole(employee, position) {
    if (!employee) return 'Legacy / Unknown';
    const positionId = Number(employee.position_id || 0);
    const positionName = String(position?.position || '').toLowerCase();

    if (positionId === 5 || positionName.includes('technician') || positionName.includes('tech')) {
        return 'Technician';
    }
    if (positionId === 9 || positionName.includes('messenger') || positionName.includes('driver')) {
        return 'Messenger';
    }
    if (positionName.includes('production') || positionName.includes('prod')) {
        return 'Production';
    }
    return 'Staff';
}

function getRoleClass(role) {
    if (role === 'Technician') return 'role-tech';
    if (role === 'Messenger') return 'role-messenger';
    if (role === 'Production') return 'role-production';
    return 'role-unknown';
}

function getAssigneeRoleKey(row) {
    const staffId = getAssignedStaffId(row);
    if (!staffId) return 'unassigned';
    const employee = opsCache.employees.get(String(staffId)) || null;
    const position = employee ? opsCache.positions.get(String(employee.position_id || 0)) : null;
    const role = getRole(employee, position);
    if (role === 'Technician') return 'technician';
    if (role === 'Messenger') return 'messenger';
    if (employee) return 'staff';
    return 'unmapped';
}

function getAssigneeRoleFilterLabel(value) {
    if (value === 'technician') return 'Technicians';
    if (value === 'messenger') return 'Messengers';
    if (value === 'unassigned') return 'Unassigned';
    return 'All Assignees';
}

function getRouteTaskDateTime(row) {
    const routeValue = String(row?.route_task_datetime || '').trim();
    if (routeValue) return routeValue;
    return String(row?.task_datetime || '').trim();
}

function getAssignedStaffId(row) {
    return Number(row?.route_tech_id || row?.tech_id || 0);
}

function getRouteNotes(row) {
    return String(row?.route_remarks || row?.remarks || row?.caller || '').trim();
}

function pickLatestRouteRows(rows, selectedDate) {
    const latestBySchedule = new Map();

    rows.forEach((row) => {
        const scheduleId = Number(row.schedule_id || 0);
        if (scheduleId <= 0) return;
        if (selectedDate && String(row.task_datetime || '').slice(0, 10) !== selectedDate) return;
        const current = latestBySchedule.get(scheduleId);
        if (!current || Number(row.id || 0) > Number(current.id || 0)) {
            latestBySchedule.set(scheduleId, row);
        }
    });

    return [...latestBySchedule.values()];
}

async function fetchScheduleDocsByIds(ids) {
    const uniqueIds = [...new Set(ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
    if (!uniqueIds.length) return new Map();

    const docs = await Promise.all(uniqueIds.map((id) => fetchDocById('tbl_schedule', String(id))));
    return new Map(
        docs
            .filter(Boolean)
            .map((doc) => [String(doc.id || doc._docId || ''), doc])
            .filter(([key]) => key)
    );
}

async function buildRouteBoundScheduleRows(routeRows, routeSourceLabel) {
    const scheduleIds = routeRows.map((row) => Number(row.schedule_id || 0)).filter((id) => id > 0);
    const scheduleMap = await fetchScheduleDocsByIds(scheduleIds);

    return routeRows
        .map((routeRow) => {
            const scheduleId = Number(routeRow.schedule_id || 0);
            const schedule = scheduleMap.get(String(scheduleId));
            if (!schedule) return null;

            return {
                ...schedule,
                task_datetime: String(routeRow.task_datetime || schedule.task_datetime || ''),
                tech_id: Number(routeRow.tech_id || schedule.tech_id || 0) || 0,
                route_id: Number(routeRow.id || 0) || 0,
                route_doc_id: routeRow._docId || String(routeRow.id || ''),
                route_source: routeSourceLabel,
                route_tech_id: Number(routeRow.tech_id || 0) || 0,
                route_task_datetime: String(routeRow.task_datetime || ''),
                route_status: routeRow.status ?? '',
                route_iscancelled: Number(routeRow.iscancelled || routeRow.iscancel || 0) || 0,
                route_date_finished: String(routeRow.date_finished || ''),
                route_remarks: String(routeRow.remarks || '').trim()
            };
        })
        .filter(Boolean);
}

function overlayRouteRowsOnSchedules(scheduleRows, printedRows, savedRows) {
    const routeBySchedule = new Map();

    savedRows.forEach((row) => {
        const scheduleId = Number(row.schedule_id || 0);
        if (scheduleId > 0) {
            routeBySchedule.set(scheduleId, { ...row, _routeSource: 'saved' });
        }
    });

    printedRows.forEach((row) => {
        const scheduleId = Number(row.schedule_id || 0);
        if (scheduleId > 0) {
            routeBySchedule.set(scheduleId, { ...row, _routeSource: 'printed' });
        }
    });

    const mergedRows = scheduleRows.map((schedule) => {
        const scheduleId = Number(schedule.id || schedule._docId || 0);
        const routeRow = routeBySchedule.get(scheduleId);
        if (!routeRow) {
            return {
                ...schedule,
                route_id: 0,
                route_doc_id: '',
                route_source: 'schedule',
                route_tech_id: 0,
                route_task_datetime: '',
                route_status: '',
                route_iscancelled: 0,
                route_date_finished: '',
                route_remarks: ''
            };
        }

        return {
            ...schedule,
            task_datetime: String(routeRow.task_datetime || schedule.task_datetime || ''),
            tech_id: Number(routeRow.tech_id || schedule.tech_id || 0) || 0,
            route_id: Number(routeRow.id || 0) || 0,
            route_doc_id: routeRow._docId || String(routeRow.id || ''),
            route_source: routeRow._routeSource || 'saved',
            route_tech_id: Number(routeRow.tech_id || 0) || 0,
            route_task_datetime: String(routeRow.task_datetime || ''),
            route_status: routeRow.status ?? '',
            route_iscancelled: Number(routeRow.iscancelled || routeRow.iscancel || 0) || 0,
            route_date_finished: String(routeRow.date_finished || ''),
            route_remarks: String(routeRow.remarks || '').trim()
        };
    });

    const boundScheduleIds = new Set(mergedRows.map((row) => Number(row.id || 0)).filter((id) => id > 0));
    const orphanRouteRows = [...routeBySchedule.values()].filter((row) => !boundScheduleIds.has(Number(row.schedule_id || 0)));

    return {
        mergedRows,
        routeCoverage: {
            printedCount: printedRows.length,
            savedCount: savedRows.length,
            boundCount: mergedRows.filter((row) => Number(row.route_id || 0) > 0).length,
            orphanCount: orphanRouteRows.length
        }
    };
}

function getOpsStatusKey(row, selectedDate) {
    const scheduleId = Number(row.id || 0);
    if (Number(row.route_iscancelled || 0) === 1) return 'cancelled';
    if (scheduleId > 0 && opsCache.closedScheduleIds.has(scheduleId)) return 'closed';
    if (Number(row.iscancel || 0) === 1) return 'cancelled';

    const routeFinished = normalizeLegacyDateTime(row.route_date_finished);
    if (routeFinished) return 'closed';
    const routeStatus = row.route_status === '' || row.route_status === undefined || row.route_status === null
        ? null
        : Number(row.route_status);
    if (routeStatus === 0) return 'closed';

    const finished = normalizeLegacyDateTime(row.date_finished);
    if (finished) return 'closed';

    if (Number(row.isongoing || 0) === 1) return 'ongoing';

    const taskDate = getRouteTaskDateTime(row).slice(0, 10);
    if (taskDate && selectedDate && taskDate < selectedDate) return 'carryover';

    return 'pending';
}

function getOpsStatusMeta(row, selectedDate) {
    const key = getOpsStatusKey(row, selectedDate);
    if (key === 'pending') return { key, label: 'Pending', className: 'status-pending' };
    if (key === 'carryover') return { key, label: 'Carryover', className: 'status-carryover' };
    if (key === 'ongoing') return { key, label: 'Ongoing', className: 'status-ongoing' };
    if (key === 'closed') return { key, label: 'Closed', className: 'status-closed' };
    if (key === 'cancelled') return { key, label: 'Cancelled', className: 'status-cancelled' };
    return { key, label: 'Pending', className: 'status-pending' };
}

function getPurposeLabel(id) {
    return PURPOSE_LABELS[id] || `Purpose ${id}`;
}

function normalizeLegacyDateTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const compact = text.replace(/[T]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (LEGACY_EMPTY_DATETIME_VALUES.has(compact)) return '';
    if (compact.startsWith('undefined ')) return '';
    if (compact.startsWith('null ')) return '';
    return text;
}

function formatTaskDateTime(value) {
    const safeValue = normalizeLegacyDateTime(value);
    if (!safeValue) return '-';
    const normalized = String(safeValue).replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return safeValue;
    return parsed.toLocaleString('en-PH', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function sanitize(text) {
    return MargaUtils.escapeHtml(String(text ?? ''));
}

function renderOpsStatusKpis(rows, selectedDate) {
    const grid = document.getElementById('opsSummaryGrid');
    const counts = rows.reduce((acc, row) => {
        const key = getOpsStatusKey(row, selectedDate);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    const todayCount = rows.filter((row) => getRouteTaskDateTime(row).startsWith(selectedDate)).length;

    grid.innerHTML = `
        <div class="ops-kpi-card">
            <div class="ops-kpi-label">Scheduled Today</div>
            <div class="ops-kpi-value">${todayCount}</div>
        </div>
        <div class="ops-kpi-card" data-filter="pending">
            <div class="ops-kpi-label">Pending</div>
            <div class="ops-kpi-value">${counts.pending || 0}</div>
        </div>
        <div class="ops-kpi-card" data-filter="ongoing">
            <div class="ops-kpi-label">Ongoing (Parts)</div>
            <div class="ops-kpi-value">${counts.ongoing || 0}</div>
        </div>
        <div class="ops-kpi-card" data-filter="closed">
            <div class="ops-kpi-label">Closed</div>
            <div class="ops-kpi-value">${counts.closed || 0}</div>
        </div>
        <div class="ops-kpi-card" data-filter="cancelled">
            <div class="ops-kpi-label">Cancelled</div>
            <div class="ops-kpi-value">${counts.cancelled || 0}</div>
        </div>
    `;

    grid.querySelectorAll('.ops-kpi-card[data-filter]').forEach((card) => {
        card.addEventListener('click', () => {
            const next = String(card.dataset.filter || 'all');
            const select = document.getElementById('opsStatusFilter');
            select.value = next;
            opsState.statusFilter = next;
            renderOperationsBoard();
        });
    });
}

function renderOpsStaffTable(rows, logsByStaff, employeeMap, positionMap) {
    const tbody = document.querySelector('#opsStaffTable tbody');
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No schedules for selected date/filter.</td></tr>';
        return;
    }

    const grouped = new Map();
    rows.forEach((row) => {
        const staffId = getAssignedStaffId(row);
        if (!grouped.has(staffId)) {
            grouped.set(staffId, { rows: [], purposeCounts: new Map() });
        }
        const bucket = grouped.get(staffId);
        bucket.rows.push(row);
        bucket.purposeCounts.set(row.purpose_id, (bucket.purposeCounts.get(row.purpose_id) || 0) + 1);
    });

    const summaryRows = [...grouped.entries()]
        .map(([staffId, bucket]) => {
            const employee = employeeMap.get(String(staffId)) || null;
            const position = employee ? positionMap.get(String(employee.position_id || 0)) : null;
            const role = getRole(employee, position);
            const topMix = [...bucket.purposeCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([purposeId, count]) => `${getPurposeLabel(purposeId)} (${count})`)
                .join(', ');

            return {
                staffId,
                assignee: getEmployeeName(employee, staffId),
                role,
                scheduled: bucket.rows.length,
                logs: logsByStaff.get(staffId) || 0,
                topMix: topMix || '-'
            };
        })
        .sort((a, b) => b.scheduled - a.scheduled);

    tbody.innerHTML = summaryRows.map((row) => `
        <tr>
            <td data-label="Assignee">${sanitize(row.assignee)}</td>
            <td data-label="Role"><span class="ops-role-badge ${getRoleClass(row.role)}">${sanitize(row.role)}</span></td>
            <td data-label="Scheduled">${row.scheduled}</td>
            <td data-label="Time Logs">${row.logs}</td>
            <td data-label="Main Tasks" class="ops-main-tasks-cell">${sanitize(row.topMix)}</td>
            <td data-label="Action" class="ops-staff-action-cell"><button type="button" class="btn btn-secondary btn-sm ops-view-btn" data-staff-id="${row.staffId}">View</button></td>
        </tr>
    `).join('');

    tbody.querySelectorAll('.ops-view-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const staffId = Number(button.dataset.staffId || 0);
            if (!Number.isFinite(staffId) || staffId <= 0) return;
            openOpsStaffPanel(staffId);
        });
    });
}

function setOpsPanelOpen(isOpen) {
    const panel = document.getElementById('opsStaffPanel');
    const overlay = document.getElementById('opsPanelOverlay');
    panel.classList.toggle('open', isOpen);
    overlay.classList.toggle('visible', isOpen);
}

function closeOpsStaffPanel() {
    setOpsPanelOpen(false);
    opsState.panelStaffId = null;
}

function getScheduleById(scheduleId) {
    return opsState.selectedRows.find((row) => Number(row.id) === Number(scheduleId)) || null;
}

function getStaffRows(staffId) {
    return opsState.selectedRows
        .filter((row) => getAssignedStaffId(row) === Number(staffId))
        .sort((a, b) => {
            const left = getRouteTaskDateTime(a);
            const right = getRouteTaskDateTime(b);
            if (left !== right) return left.localeCompare(right);
            return Number(a.id || 0) - Number(b.id || 0);
        });
}

function getScheduleLookups(row) {
    const scheduleId = Number(row.id || 0);
    const scheduleLogs = opsState.logsBySchedule.get(scheduleId) || [];
    const branchIdFromLog = scheduleLogs.find((log) => Number(log.branch_id || 0) > 0)?.branch_id || 0;
    const branchId = Number(row.branch_id || 0) > 0 ? Number(row.branch_id) : Number(branchIdFromLog || 0);
    const companyId = Number(row.company_id || 0);

    const employee = opsCache.employees.get(String(getAssignedStaffId(row) || 0)) || null;
    const position = employee ? opsCache.positions.get(String(employee.position_id || 0)) : null;
    const trouble = opsCache.troubles.get(String(row.trouble_id || 0)) || null;
    const branch = opsCache.branches.get(String(branchId || 0)) || null;
    const company = opsCache.companies.get(String(companyId || branch?.company_id || 0)) || null;
    const area = branch ? opsCache.areas.get(String(branch.area_id || 0)) : null;

    return { employee, position, trouble, branch, company, area, branchId, companyId };
}

function getAssignableStaffList() {
    return [...opsCache.employees.values()]
        .filter(Boolean)
        .map((employee) => {
            const position = opsCache.positions.get(String(employee.position_id || 0)) || null;
            const role = getRole(employee, position);
            return {
                id: Number(employee.id || 0),
                role,
                name: getEmployeeName(employee, employee.id || 0),
                estatus: Number(employee.estatus || 0)
            };
        })
        .filter((staff) => staff.id > 0)
        .filter((staff) => staff.role === 'Technician' || staff.role === 'Production' || staff.role === 'Messenger')
        .filter((staff) => staff.estatus > 0)
        .sort((a, b) => {
            if (a.role !== b.role) return a.role.localeCompare(b.role);
            return a.name.localeCompare(b.name);
        });
}

function setNewReqOpen(isOpen) {
    const overlay = document.getElementById('newReqOverlay');
    const modal = document.getElementById('newReqModal');
    modal.classList.toggle('open', isOpen);
    overlay.classList.toggle('visible', isOpen);
    modal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function closeNewRequestModal() {
    opsState.newRequestLookupSeq += 1;
    setNewReqOpen(false);
}

function clearNewRequestPrefill() {
    document.getElementById('newReqCaller').value = '';
    document.getElementById('newReqPhone').value = '';
    document.getElementById('newReqRemarks').value = '';
}

async function openNewRequestModal() {
    const user = MargaAuth.getUser();
    const canCreate = MargaAuth.isAdmin() || MargaAuth.hasRole('service');
    if (!canCreate) {
        alert('New request is available for Admin / Service roles only.');
        return;
    }

    setNewReqOpen(true);

    document.getElementById('newReqDate').value = opsState.selectedDate || formatDateYmd(new Date());
    clearNewRequestPrefill();

    // Load lookup collections needed for the form. Customer identity comes from the Active Contract Customer Graph.
    await Promise.all([
        ensureActiveCustomerGraphLoaded(),
        ensureCollectionLoaded('tbl_area', opsCache.areas),
        ensureCollectionLoaded('tbl_trouble', opsCache.troubles),
        ensureBranchContactsLoaded(),
        ensureAssignableEmployeesLoaded()
    ]);

    const companySearch = document.getElementById('newReqCompanySearch');
    const companySelect = document.getElementById('newReqCompany');
    const branchSearch = document.getElementById('newReqBranchSearch');
    const branchSelect = document.getElementById('newReqBranch');
    const machineSelect = document.getElementById('newReqMachine');
    const machineMeta = document.getElementById('newReqMachineMeta');
    const modelInput = document.getElementById('newReqModel');
    const troubleSearch = document.getElementById('newReqTroubleSearch');
    const troubleSelect = document.getElementById('newReqTrouble');
    const assigneeSearch = document.getElementById('newReqAssigneeSearch');
    const assigneeSelect = document.getElementById('newReqAssignee');
    const purposeSelect = document.getElementById('newReqPurpose');
    const callerInput = document.getElementById('newReqCaller');
    const phoneInput = document.getElementById('newReqPhone');
    const serialInput = document.getElementById('newReqSerialNumber');
    const releaseCategorySelect = document.getElementById('newReqReleaseCategory');
    const releaseItemRstdInput = document.getElementById('newReqReleaseItemRstd');
    const releaseUnitInputs = Array.from(document.querySelectorAll('input[name="newReqReleaseUnit"]'));
    const companyPanel = document.getElementById('newReqCompanyPanel');
    const branchPanel = document.getElementById('newReqBranchPanel');
    const serialPanel = document.getElementById('newReqSerialPanel');
    const troublePanel = document.getElementById('newReqTroublePanel');
    const assigneePanel = document.getElementById('newReqAssigneePanel');

    companySearch.value = '';
    branchSearch.value = '';
    troubleSearch.value = '';
    assigneeSearch.value = '';
    purposeSelect.value = '5';
    serialInput.value = '';
    modelInput.value = '';
    releaseCategorySelect.value = '';
    releaseCategorySelect.dataset.autoValue = '';
    releaseItemRstdInput.value = '';
    releaseUnitInputs.forEach((input) => {
        input.checked = input.value === 'pc';
    });
    document.getElementById('newReqStatus').value = '1';
    document.getElementById('newReqSuperUrgent').checked = false;
    document.getElementById('newReqWithRequest').checked = false;
    document.getElementById('newReqWithComplain').checked = false;
    document.getElementById('newReqSaveContact').checked = false;
    machineSelect.innerHTML = `<option value="">Select company and branch first...</option>`;
    machineMeta.textContent = 'Select a company and branch to load active machines.';
    opsState.newRequestMachine = null;
    opsState.newRequestGraphRow = null;
    opsState.newRequestLookupSeq += 1;
    setNewReqSerialStatus(`Using Active Contract Customer Graph: ${opsCache.activeCustomerGraphRows.length} active machine/account rows.`);

    const companies = opsCache.activeGraphCompanies;

    function closeComboPanel(panel, input) {
        if (!panel) return;
        panel.classList.remove('open');
        if (input) input.setAttribute('aria-expanded', 'false');
    }

    function closeAllComboPanels(exceptPanel = null) {
        [
            [companyPanel, companySearch],
            [branchPanel, branchSearch],
            [serialPanel, serialInput],
            [troublePanel, troubleSearch],
            [assigneePanel, assigneeSearch]
        ].forEach(([panel, input]) => {
            if (panel !== exceptPanel) closeComboPanel(panel, input);
        });
    }

    function findByInputValue(items, value, getValue) {
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized) return null;
        return items.find((item) => String(getValue(item) || '').trim().toLowerCase() === normalized) || null;
    }

    function renderComboPanel({ input, panel, items, getLabel, getMeta, onSelect, emptyText = 'No matches found.', limit = 80 }) {
        if (!panel || !input) return;
        const source = Array.isArray(items) ? items.filter(Boolean) : [];
        const q = input.value.trim().toLowerCase();
        const filtered = (q
            ? source.filter((item) => {
                const label = String(getLabel(item) || '').toLowerCase();
                const meta = String(getMeta?.(item) || '').toLowerCase();
                return label.includes(q) || meta.includes(q);
            })
            : source
        ).slice(0, limit);

        if (!filtered.length) {
            const emptyMessage = typeof emptyText === 'function' ? emptyText() : emptyText;
            panel.innerHTML = `<div class="marga-combo-empty">${sanitize(emptyMessage)}</div>`;
        } else {
            panel.innerHTML = filtered.map((item, index) => {
                const label = String(getLabel(item) || '').trim();
                const meta = String(getMeta?.(item) || '').trim();
                return `
                    <button type="button" class="marga-combo-option" data-index="${index}" role="option">
                        <span class="marga-combo-name">${sanitize(label)}</span>
                        ${meta ? `<span class="marga-combo-meta">${sanitize(meta)}</span>` : ''}
                    </button>
                `;
            }).join('');
            panel.querySelectorAll('.marga-combo-option').forEach((button) => {
                button.addEventListener('mousedown', (event) => event.preventDefault());
                button.addEventListener('click', () => {
                    const item = filtered[Number(button.dataset.index || 0)];
                    onSelect(item);
                    closeComboPanel(panel, input);
                });
            });
        }

        closeAllComboPanels(panel);
        panel.classList.add('open');
        input.setAttribute('aria-expanded', 'true');
    }

    function installSearchCombo(config) {
        const { input, panel, getItems, getLabel, getMeta, onSelect, onInput, emptyText, limit } = config;
        const open = () => renderComboPanel({
            input,
            panel,
            items: getItems(),
            getLabel,
            getMeta,
            onSelect,
            emptyText,
            limit
        });

        input.onfocus = open;
        input.oninput = () => {
            if (typeof onInput === 'function') onInput(input.value);
            open();
        };
        input.onkeydown = (event) => {
            if (event.key === 'Escape') {
                closeComboPanel(panel, input);
                return;
            }
            if (event.key !== 'Enter') return;
            const first = panel?.querySelector('.marga-combo-option');
            if (!first) return;
            event.preventDefault();
            first.click();
        };
    }

    function getCompanyInputLabel(company) {
        return String(company?.name || '').trim();
    }

    function getBranchInputLabel(branch) {
        return String(branch?.name || '').trim();
    }

    function getSelectedCompanyIdFromInput() {
        const selectedId = Number(companySelect.value || 0) || 0;
        if (selectedId) return selectedId;
        const match = findByInputValue(companies, companySearch.value, getCompanyInputLabel);
        if (!match) return 0;
        companySelect.value = String(match.id);
        return Number(match.id || 0) || 0;
    }

    function getBranchRowsForCompany(companyId) {
        const branchMap = new Map();
        (opsCache.activeGraphBranchesByCompany.get(String(companyId)) || []).forEach((branch) => {
            branchMap.set(String(branch.id), { ...branch, activeMachineCount: Number(branch.activeMachineCount || 0) || 0 });
        });

        [...opsCache.branches.values()]
            .filter((branch) => (
                Number(branch?.company_id || 0) === Number(companyId || 0)
                && Number(branch?.inactive || 0) !== 1
            ))
            .forEach((branch) => {
                const branchId = Number(branch.id || 0) || 0;
                const key = String(branchId);
                const existing = branchMap.get(key);
                const name = String(branch.branchname || '').trim() || `Branch #${branchId}`;
                branchMap.set(key, {
                    id: branchId,
                    name: existing?.name || name,
                    accountName: existing?.accountName || buildAccountName(
                        String((opsCache.companies.get(String(companyId)) || {}).companyname || '').trim(),
                        existing?.name || name
                    ),
                    activeMachineCount: Number(existing?.activeMachineCount || 0) || 0,
                    rows: existing?.rows || [],
                    branch
                });
            });

        return [...branchMap.values()].sort((left, right) => (
            (Number(right.activeMachineCount || 0) > 0 ? 1 : 0) - (Number(left.activeMachineCount || 0) > 0 ? 1 : 0)
            || String(left.name || '').localeCompare(String(right.name || ''))
        ));
    }

    function getStaffInputLabel(staff) {
        if (!staff) return '';
        return `${staff.name} (${staff.role})`;
    }

    function renderCompanyOptions(query, selectedId = '') {
        const q = String(query || '').trim().toLowerCase();
        const filtered = q
            ? companies.filter((c) => c.name.toLowerCase().includes(q) || String(c.id).includes(q))
            : companies;

        const visible = filtered.slice(0, 2500);
        const selectedCompany = selectedId
            ? companies.find((c) => String(c.id) === String(selectedId))
            : null;
        if (selectedCompany && !visible.some((c) => c.id === selectedCompany.id)) {
            visible.unshift(selectedCompany);
        } else if (selectedId && !selectedCompany) {
            const rawCompany = opsCache.companies.get(String(selectedId)) || null;
            if (rawCompany) {
                visible.unshift({
                    id: Number(rawCompany.id || selectedId),
                    name: `${String(rawCompany.companyname || `Company #${selectedId}`).trim()} (non-contract fallback)`
                });
            }
        }

        companySelect.innerHTML = `<option value="">Select active contract customer...</option>` + visible
            .map((c) => {
                const countText = Number(c.activeAccountCount || 0) > 0 ? ` (${c.activeAccountCount} active)` : '';
                return `<option value="${c.id}">${sanitize(c.name)}${sanitize(countText)}</option>`;
            })
            .join('');
        if (selectedId) {
            companySelect.value = String(selectedId);
        }
    }

    renderCompanyOptions('');

    const troubles = [...opsCache.troubles.values()]
        .filter(Boolean)
        .map((t) => ({ id: Number(t.id || 0), name: String(t.trouble || '').trim() }))
        .filter((t) => t.id > 0 && t.name)
        .sort((a, b) => a.name.localeCompare(b.name));

    troubleSelect.innerHTML = `<option value="">Select concern...</option>` + troubles
        .map((t) => `<option value="${t.id}">${sanitize(t.name)}</option>`)
        .join('');

    const staff = getAssignableStaffList();
    assigneeSelect.innerHTML = `<option value="">Unassigned</option>` + staff
        .map((s) => `<option value="${s.id}">${sanitize(s.name)} (${sanitize(s.role)})</option>`)
        .join('');

    let serialComboRows = opsCache.activeCustomerGraphRows
        .filter((row) => row?.serialNumber)
        .sort((left, right) => String(left.serialNumber || '').localeCompare(String(right.serialNumber || '')))
        .slice(0, 5000);

    function fillBranchesForCompany(companyId, query = '', selectedId = '') {
        const branches = getBranchRowsForCompany(companyId);

        const q = String(query || '').trim().toLowerCase();
        const filtered = q
            ? branches.filter((b) => b.name.toLowerCase().includes(q) || String(b.id).includes(q))
            : branches;

        const visible = filtered.slice(0, 2500);
        const selectedBranch = selectedId
            ? branches.find((b) => String(b.id) === String(selectedId))
            : null;
        if (selectedBranch && !visible.some((b) => b.id === selectedBranch.id)) {
            visible.unshift(selectedBranch);
        } else if (selectedId && !selectedBranch) {
            const rawBranch = opsCache.branches.get(String(selectedId)) || null;
            if (rawBranch) {
                visible.unshift({
                    id: Number(rawBranch.id || selectedId),
                    name: `${String(rawBranch.branchname || `Branch #${selectedId}`).trim()} (non-contract fallback)`
                });
            }
        }

        branchSelect.innerHTML = `<option value="">Select branch / department...</option>` + visible
            .map((b) => {
                const activeCount = Number(b.activeMachineCount || 0) || 0;
                const countText = activeCount > 0 ? ` (${activeCount} machine${activeCount === 1 ? '' : 's'})` : ' (no active machine)';
                return `<option value="${b.id}">${sanitize(b.name || `Branch #${b.id}`)}${sanitize(countText)}</option>`;
            })
            .join('');

        if (selectedId) {
            branchSelect.value = String(selectedId);
        }
    }

    function prefillContactForBranch(branchId) {
        const branch = opsCache.branches.get(String(branchId)) || null;
        const contacts = opsCache.branchContactsByBranch.get(Number(branchId)) || [];
        const best = contacts.find((c) => (c.contact_person || '').trim() || (c.contact_number || '').trim()) || null;

        if (!callerInput.value.trim()) {
            callerInput.value = String(best?.contact_person || branch?.signatory || '').trim();
        }

        if (!phoneInput.value.trim()) {
            phoneInput.value = String(best?.contact_number || '').trim();
        }
    }

    function getGraphRowsForBranch(branchId) {
        return opsCache.activeCustomerGraphRows
            .filter((row) => Number(row.branchId || 0) === Number(branchId || 0))
            .sort((left, right) => (
                String(left.serialNumber || '').localeCompare(String(right.serialNumber || ''))
                || String(left.machineDescription || '').localeCompare(String(right.machineDescription || ''))
                || Number(left.contractId || 0) - Number(right.contractId || 0)
            ));
    }

    function setMachineMeta(message, tone = '') {
        machineMeta.textContent = message;
        machineMeta.classList.toggle('is-match', tone === 'match');
        machineMeta.classList.toggle('is-warning', tone === 'warning');
        machineMeta.classList.toggle('is-error', tone === 'error');
    }

    function clearMatchedMachineIfManualChange() {
        if (!opsState.newRequestMachine && !opsState.newRequestGraphRow) return;
        opsState.newRequestMachine = null;
        opsState.newRequestGraphRow = null;
        modelInput.value = '';
        if (serialInput.value.trim()) {
            setNewReqSerialStatus('Serial match cleared after manual company/branch change.', 'warning');
        }
    }

    function applyGraphRowToForm(row) {
        opsState.newRequestGraphRow = row;
        opsState.newRequestMachine = row?.machine || null;
        if (row?.serialNumber) {
            serialInput.value = row.serialNumber;
        }
        companySearch.value = row.companyName;
        renderCompanyOptions(row.companyName, row.companyId);
        branchSearch.value = row.branchName;
        fillBranchesForCompany(row.companyId, row.branchName, row.branchId);
        renderMachineOptionsForBranch(row.branchId, row.contractId);
        prefillContactForBranch(row.branchId);
    }

    function applyMachineSelection(row, options = {}) {
        if (!row) return;
        opsState.newRequestGraphRow = row;
        opsState.newRequestMachine = row.machine || null;
        if (row.serialNumber) {
            serialInput.value = row.serialNumber;
        }
        const machineLabel = row.machineDescription || row.serialNumber || `Machine #${row.machineId}`;
        modelInput.value = row.machineDescription || machineLabel || '';
        setMachineMeta(`Active contract ${row.contractId}: ${machineLabel}.`, 'match');
        if (options.updateStatus !== false) {
            setNewReqSerialStatus(`Selected ${row.serialNumber || machineLabel} from ${row.accountName}.`, 'match');
        }
    }

    function renderMachineOptionsForBranch(branchId, selectedContractId = '') {
        const rows = getGraphRowsForBranch(branchId);
        if (!rows.length) {
            machineSelect.innerHTML = `<option value="">No active machines found for this branch...</option>`;
            modelInput.value = '';
            serialComboRows = [];
            setMachineMeta('No active machines are linked to this branch in the customer graph.', 'warning');
            return;
        }

        serialComboRows = rows.filter((row) => row?.serialNumber);

        machineSelect.innerHTML = `<option value="">Select machine...</option>` + rows
            .map((row) => {
                const serial = row.serialNumber || `Machine #${row.machineId || '-'}`;
                const model = row.machineDescription ? ` - ${row.machineDescription}` : '';
                const selected = String(row.contractId) === String(selectedContractId) ? 'selected' : '';
                return `<option value="${row.contractId}" ${selected}>${sanitize(serial)}${sanitize(model)}</option>`;
            })
            .join('');

        const selectedRow = rows.find((row) => String(row.contractId) === String(selectedContractId)) || (rows.length === 1 ? rows[0] : rows[0]);
        if (selectedRow) {
            machineSelect.value = String(selectedRow.contractId);
            applyMachineSelection(selectedRow, { updateStatus: Boolean(selectedContractId) });
        }

        if (rows.length > 1 && !selectedContractId) {
            setMachineMeta(`${rows.length} active machines found. First machine selected; choose another if needed.`, 'warning');
        }
    }

    function syncReleaseCategoryFromPurpose(force = false) {
        const defaultCategory = RELEASE_CATEGORY_DEFAULTS[Number(purposeSelect.value || 0)] || '';
        const currentCategory = String(releaseCategorySelect.value || '').trim();
        const previousAuto = String(releaseCategorySelect.dataset.autoValue || '').trim();
        if (force || !currentCategory || currentCategory === previousAuto) {
            releaseCategorySelect.value = defaultCategory;
        }
        releaseCategorySelect.dataset.autoValue = defaultCategory;
    }

    async function applySerialLookup() {
        const serialText = serialInput.value.trim();
        const token = ++opsState.newRequestLookupSeq;
        opsState.newRequestMachine = null;
        opsState.newRequestGraphRow = null;
        modelInput.value = '';

        if (!serialText) {
            setNewReqSerialStatus(`Using Active Contract Customer Graph: ${opsCache.activeCustomerGraphRows.length} active machine/account rows.`);
            return;
        }

        if (normalizeSerialNumber(serialText).length < SERIAL_LOOKUP_MIN_CHARS) {
            setNewReqSerialStatus(`Enter at least ${SERIAL_LOOKUP_MIN_CHARS} characters to search.`, 'warning');
            return;
        }

        setNewReqSerialStatus('Looking up serial in Active Contract Customer Graph...');

        try {
            const graphRow = findGraphRowBySerial(serialText);
            if (graphRow) {
                applyGraphRowToForm(graphRow);
                const machineLabel = graphRow.machineDescription || graphRow.serialNumber || `Machine #${graphRow.machineId}`;
                setNewReqSerialStatus(
                    `Matched active contract ${graphRow.contractId}: ${machineLabel} - ${graphRow.accountName}.`,
                    'match'
                );
                return;
            }

            const machine = await findMachineBySerial(serialText);
            if (token !== opsState.newRequestLookupSeq) return;

            if (!machine) {
                setNewReqSerialStatus('No active contract or machine found for this serial. Select an active customer manually.', 'warning');
                return;
            }

            opsState.newRequestMachine = machine;
            modelInput.value = getMachineDisplayName(machine) || '';
            const { branch, company, branchId, companyId } = resolveMachineCustomer(machine);
            const companyName = company?.companyname || '';
            const branchName = branch?.branchname || '';

            if (companyId) {
                companySearch.value = companyName;
                renderCompanyOptions(companyName, companyId);
            }

            if (companyId && branchId && branch) {
                branchSearch.value = branchName;
                fillBranchesForCompany(companyId, branchName, branchId);
                prefillContactForBranch(branchId);
                const machineName = getMachineDisplayName(machine);
                setNewReqSerialStatus(
                    `Machine found outside active contract graph: ${machineName || 'machine'} - ${companyName || `Company #${companyId}`} - ${branchName || `Branch #${branchId}`}.`,
                    'warning'
                );
                return;
            }

            if (companyId) {
                branchSelect.innerHTML = `<option value="">Select branch...</option>`;
                const companyName = company?.companyname || `Company #${companyId}`;
                setNewReqSerialStatus(`Machine found outside active contract graph for ${companyName}, but no branch is tagged. Select active customer manually.`, 'warning');
                return;
            }

            setNewReqSerialStatus('Machine found outside active contract graph, but no customer location is tagged. Select active customer manually.', 'warning');
        } catch (error) {
            console.error('Serial lookup failed:', error);
            if (token !== opsState.newRequestLookupSeq) return;
            setNewReqSerialStatus('Serial lookup failed. Select active customer manually.', 'error');
        }
    }

    const debouncedSerialLookup = MargaUtils.debounce(applySerialLookup, 350);

    serialInput.onblur = applySerialLookup;

    function handleCompanySelection(companyId) {
        clearMatchedMachineIfManualChange();
        branchSearch.value = '';
        fillBranchesForCompany(companyId, '');
        branchSelect.value = '';
        machineSelect.innerHTML = `<option value="">Select branch first...</option>`;
        modelInput.value = '';
        setMachineMeta('Select a branch to load active machines.');
        serialInput.value = '';
    }

    function handleBranchSelection(branchId) {
        if (!branchId) return;
        clearMatchedMachineIfManualChange();
        prefillContactForBranch(branchId);
        renderMachineOptionsForBranch(branchId);
    }

    installSearchCombo({
        input: companySearch,
        panel: companyPanel,
        getItems: () => companies,
        getLabel: getCompanyInputLabel,
        getMeta: (company) => `${Number(company.activeAccountCount || 0)} active`,
        emptyText: 'No active customers found.',
        onInput: () => {
            renderCompanyOptions(companySearch.value, companySelect.value);
            const match = findByInputValue(companies, companySearch.value, getCompanyInputLabel);
            if (!match) {
                companySelect.value = '';
                branchSelect.value = '';
                branchSearch.value = '';
                branchSelect.innerHTML = `<option value="">Select branch / department...</option>`;
                return;
            }
            companySelect.value = String(match.id);
            fillBranchesForCompany(match.id, branchSearch.value, branchSelect.value);
        },
        onSelect: (company) => {
            companySearch.value = getCompanyInputLabel(company);
            renderCompanyOptions(companySearch.value, company.id);
            companySelect.value = String(company.id);
            handleCompanySelection(company.id);
            setTimeout(() => branchSearch.focus(), 0);
        }
    });

    companySelect.onchange = () => handleCompanySelection(companySelect.value);

    installSearchCombo({
        input: branchSearch,
        panel: branchPanel,
        getItems: () => getBranchRowsForCompany(getSelectedCompanyIdFromInput()),
        getLabel: getBranchInputLabel,
        getMeta: (branch) => {
            const count = Number(branch.activeMachineCount || 0) || 0;
            return count > 0 ? `${count} machine${count === 1 ? '' : 's'}` : 'branch/dept';
        },
        emptyText: () => getSelectedCompanyIdFromInput() ? 'No branches found for this customer.' : 'Choose a company first.',
        onInput: () => fillBranchesForCompany(getSelectedCompanyIdFromInput(), branchSearch.value, branchSelect.value),
        onSelect: (branch) => {
            const companyId = getSelectedCompanyIdFromInput();
            branchSearch.value = getBranchInputLabel(branch);
            fillBranchesForCompany(companyId, branchSearch.value, branch.id);
            branchSelect.value = String(branch.id);
            handleBranchSelection(branch.id);
        }
    });

    branchSelect.onchange = () => handleBranchSelection(Number(branchSelect.value || 0));

    installSearchCombo({
        input: serialInput,
        panel: serialPanel,
        getItems: () => serialComboRows,
        getLabel: (row) => row.serialNumber || '',
        getMeta: (row) => row.machineDescription || row.accountName || '',
        emptyText: 'No serials found.',
        onInput: () => debouncedSerialLookup(),
        onSelect: (row) => {
            serialInput.value = row.serialNumber || '';
            applyGraphRowToForm(row);
        }
    });

    installSearchCombo({
        input: troubleSearch,
        panel: troublePanel,
        getItems: () => troubles,
        getLabel: (trouble) => trouble.name,
        getMeta: () => '',
        emptyText: 'No concerns found.',
        onInput: () => {
            const match = findByInputValue(troubles, troubleSearch.value, (trouble) => trouble.name);
            troubleSelect.value = match ? String(match.id) : '';
        },
        onSelect: (trouble) => {
            troubleSearch.value = trouble.name;
            troubleSelect.value = String(trouble.id);
        }
    });

    installSearchCombo({
        input: assigneeSearch,
        panel: assigneePanel,
        getItems: () => staff,
        getLabel: (assignee) => assignee.name,
        getMeta: (assignee) => assignee.role,
        emptyText: 'No technicians, production, or messengers found.',
        onInput: () => {
            const match = findByInputValue(staff, assigneeSearch.value, getStaffInputLabel);
            assigneeSelect.value = match ? String(match.id) : '';
        },
        onSelect: (assignee) => {
            assigneeSearch.value = getStaffInputLabel(assignee);
            assigneeSelect.value = String(assignee.id);
        }
    });

    machineSelect.onchange = () => {
        const contractId = Number(machineSelect.value || 0);
        if (!contractId) return;
        const row = opsCache.activeCustomerGraphRows.find((entry) => Number(entry.contractId || 0) === contractId) || null;
        applyMachineSelection(row);
    };

    purposeSelect.onchange = () => syncReleaseCategoryFromPurpose(false);
    syncReleaseCategoryFromPurpose(true);

    branchSelect.innerHTML = `<option value="">Select branch / department...</option>`;
    document.getElementById('newReqModal').onmousedown = (event) => {
        if (event.target.closest('.marga-combo-panel')) return;
        if ([companySearch, branchSearch, serialInput, troubleSearch, assigneeSearch].includes(event.target)) return;
        closeAllComboPanels();
    };
}

async function saveRequestContactIfNeeded({ branchId, caller, phone }) {
    const shouldSave = document.getElementById('newReqSaveContact')?.checked === true;
    if (!shouldSave) return { status: 'skipped' };

    const normalizedPhone = normalizeContactNumber(phone);
    if (!normalizedPhone) {
        return { status: 'empty' };
    }

    await ensureBranchContactsLoaded();
    const contacts = opsCache.branchContactsByBranch.get(Number(branchId)) || [];
    const existing = contacts.find((contact) => normalizeContactNumber(contact.contact_number) === normalizedPhone);
    if (existing) {
        return { status: 'duplicate' };
    }

    const maxDocs = await runFirestoreQuery('tbl_branchcontact', 1).catch(() => []);
    const maxRow = maxDocs.map(parseFirestoreDoc).filter(Boolean)[0] || null;
    const nextId = Number(maxRow?.id || 0) + 1;
    if (!Number.isFinite(nextId) || nextId <= 0) {
        throw new Error('Unable to allocate contact id.');
    }

    const contactDoc = {
        id: nextId,
        branch_id: Number(branchId || 0) || 0,
        contact_person: caller || '',
        contact_number: phone
    };

    await setDocument('tbl_branchcontact', nextId, contactDoc);
    if (!opsCache.branchContactsByBranch.has(Number(branchId))) {
        opsCache.branchContactsByBranch.set(Number(branchId), []);
    }
    opsCache.branchContactsByBranch.get(Number(branchId)).push(contactDoc);
    return { status: 'created', id: nextId };
}

async function saveNewServiceRequest() {
    const user = MargaAuth.getUser();
    const canCreate = MargaAuth.isAdmin() || MargaAuth.hasRole('service');
    if (!canCreate) {
        alert('New request is available for Admin / Service roles only.');
        return;
    }

    const origin = document.getElementById('newReqOrigin').value || 'other';
    const purposeId = Number(document.getElementById('newReqPurpose').value || 5);
    const date = document.getElementById('newReqDate').value;
    const time = document.getElementById('newReqTime').value || '08:00';
    let companyId = Number(document.getElementById('newReqCompany').value || 0);
    let branchId = Number(document.getElementById('newReqBranch').value || 0);
    const serialNumber = (document.getElementById('newReqSerialNumber')?.value || '').trim();
    const caller = (document.getElementById('newReqCaller').value || '').trim();
    const phone = (document.getElementById('newReqPhone').value || '').trim();
    let troubleId = Number(document.getElementById('newReqTrouble').value || 0);
    let assigneeId = Number(document.getElementById('newReqAssignee').value || 0);
    const remarks = (document.getElementById('newReqRemarks').value || '').trim();
    const releaseCategory = normalizeReleaseCategoryValue(document.getElementById('newReqReleaseCategory')?.value || '');
    const releaseItemRstd = (document.getElementById('newReqReleaseItemRstd')?.value || '').trim();
    const releaseUnit = getSelectedReleaseUnit();
    const releaseSummary = buildReleaseRequestSummary({
        category: releaseCategory,
        itemRstd: releaseItemRstd,
        unit: releaseUnit
    });
    const hasReleaseRequest = Boolean(releaseCategory || releaseItemRstd);
    const statusValue = Number(document.getElementById('newReqStatus')?.value || 1);
    const superUrgent = document.getElementById('newReqSuperUrgent')?.checked ? 1 : 0;
    const withRequest = document.getElementById('newReqWithRequest')?.checked ? 1 : 0;
    const withComplain = document.getElementById('newReqWithComplain')?.checked ? 1 : 0;
    const saveContact = document.getElementById('newReqSaveContact')?.checked === true;

    if (!date) {
        alert('Please choose a schedule date.');
        return;
    }
    if (!companyId) {
        const typedCompany = String(document.getElementById('newReqCompanySearch')?.value || '').trim().toLowerCase();
        const companyMatch = opsCache.activeGraphCompanies.find((company) => String(company.name || '').trim().toLowerCase() === typedCompany) || null;
        companyId = Number(companyMatch?.id || 0);
    }
    if (!branchId && companyId) {
        const typedBranch = String(document.getElementById('newReqBranchSearch')?.value || '').trim().toLowerCase();
        const branches = opsCache.activeGraphBranchesByCompany.get(String(companyId)) || [];
        const branchMatch = branches.find((branch) => String(branch.name || '').trim().toLowerCase() === typedBranch) || null;
        branchId = Number(branchMatch?.id || 0);
    }
    if (!troubleId) {
        const typedTrouble = String(document.getElementById('newReqTroubleSearch')?.value || '').trim().toLowerCase();
        const troubleMatch = [...opsCache.troubles.values()]
            .filter(Boolean)
            .find((trouble) => String(trouble.trouble || '').trim().toLowerCase() === typedTrouble) || null;
        troubleId = Number(troubleMatch?.id || 0);
    }
    if (!assigneeId) {
        const typedAssignee = String(document.getElementById('newReqAssigneeSearch')?.value || '').trim().toLowerCase();
        const assigneeMatch = getAssignableStaffList().find((staff) => `${staff.name} (${staff.role})`.toLowerCase() === typedAssignee) || null;
        assigneeId = Number(assigneeMatch?.id || 0);
    }
    let graphRow = null;
    if (serialNumber) {
        const currentGraphRow = opsState.newRequestGraphRow || null;
        const currentGraphMatches = normalizeSerialNumber(currentGraphRow?.serialNumber) === normalizeSerialNumber(serialNumber);
        graphRow = currentGraphMatches
            ? currentGraphRow
            : (!companyId || !branchId ? findGraphRowBySerial(serialNumber) : null);
        if (graphRow) {
            opsState.newRequestGraphRow = graphRow;
            opsState.newRequestMachine = graphRow.machine || null;
            companyId = companyId || graphRow.companyId || 0;
            branchId = branchId || graphRow.branchId || 0;
        }
    }
    if (serialNumber && !graphRow) {
        const currentMachine = opsState.newRequestMachine || null;
        const currentMatches = normalizeSerialNumber(currentMachine?.serial) === normalizeSerialNumber(serialNumber);
        const machine = currentMatches
            ? currentMachine
            : (!companyId || !branchId ? await findMachineBySerial(serialNumber).catch(() => null) : null);
        if (machine) {
            opsState.newRequestMachine = machine;
            const machineCustomer = resolveMachineCustomer(machine);
            companyId = companyId || machineCustomer.companyId || 0;
            branchId = branchId || machineCustomer.branchId || 0;
        }
    }
    if (!companyId) {
        alert('Please select a company.');
        return;
    }
    if (!branchId) {
        alert('Please select a branch.');
        return;
    }
    if (releaseItemRstd && !releaseCategory) {
        alert('Please choose a release category for Item Rstd.');
        return;
    }
    if (saveContact && !normalizeContactNumber(phone)) {
        alert('Please enter a phone number before saving it to the customer file.');
        return;
    }
    if (!troubleId) {
        alert('Please select a trouble/concern.');
        return;
    }

    const taskDatetime = `${date} ${time.length === 5 ? `${time}:00` : time}`;

    // Allocate next schedule id (max + 1). Note: concurrent creates can collide; acceptable for now.
    const maxDocs = await runFirestoreQuery('tbl_schedule', 1);
    const maxRow = maxDocs.map(parseFirestoreDoc).filter(Boolean)[0] || null;
    const nextId = Number(maxRow?.id || 0) + 1;
    if (!Number.isFinite(nextId) || nextId <= 0) {
        alert('Unable to allocate new schedule id.');
        return;
    }

    const branch = opsCache.branches.get(String(branchId)) || null;
    const areaId = Number(branch?.area_id || 0);
    const bridgeUpdatedAt = new Date().toISOString();
    const bridgeUpdatedBy = Number(user?.staff_id || 0) || 0;
    const matchedMachine = opsState.newRequestMachine || null;
    const matchedMachineBranchId = Number(matchedMachine?.client_id || matchedMachine?.branch_id || 0);
    const typedSerialKey = normalizeSerialNumber(serialNumber);
    const matchedSerialKey = normalizeSerialNumber(matchedMachine?.serial);
    const graphSerialKey = normalizeSerialNumber(graphRow?.serialNumber || opsState.newRequestGraphRow?.serialNumber);
    const graphMachineId = Number(graphRow?.machineId || opsState.newRequestGraphRow?.machineId || 0) || 0;
    const graphBranchId = Number(graphRow?.branchId || opsState.newRequestGraphRow?.branchId || 0) || 0;
    const matchedMachineId = typedSerialKey && graphSerialKey && typedSerialKey === graphSerialKey && graphMachineId > 0 && (!graphBranchId || graphBranchId === branchId)
        ? graphMachineId
        : (typedSerialKey && typedSerialKey === matchedSerialKey && (!matchedMachineBranchId || matchedMachineBranchId === branchId)
            ? Number(matchedMachine?.id || 0)
            : 0);

    const base = {
        id: nextId,
        company_id: companyId,
        branch_id: branchId,
        area_id: areaId,
        serial: matchedMachineId || 0,
        caller: caller || '-',
        phone_number: phone || '',
        purpose_id: purposeId,
        task_datetime: taskDatetime,
        original_sched: taskDatetime,
        tech_id: assigneeId || 0,
        trouble_id: troubleId,
        remarks: remarks || '',
        status: Number.isFinite(statusValue) ? statusValue : 1,
        isongoing: 0,
        date_finished: ZERO_DATETIME,
        iscancel: 0,
        scheduled: 1,
        withcomplain: withComplain,
        withrequest: withRequest,
        super_urgent: superUrgent,
        // App-specific tracking (safe in Firestore, doesn't break legacy)
        request_origin: origin,
        request_serial_number: serialNumber,
        customer_request: releaseSummary,
        contractmain_id: Number(graphRow?.contractId || opsState.newRequestGraphRow?.contractId || 0) || 0,
        active_customer_graph_source: graphRow ? 'active_contract_customer_graph' : (matchedMachineId ? 'machine_fallback' : ''),
        from_mobileapp: 1,
        bridge_updated_at: bridgeUpdatedAt,
        bridge_updated_by: bridgeUpdatedBy,
        ...(hasReleaseRequest ? {
            release_request_category: releaseCategory,
            release_request_item_rstd: releaseItemRstd,
            release_request_unit: releaseUnit,
            release_request_summary: releaseSummary,
            release_request_qty: 1,
            releasing_pending_qty: 1,
            releasing_dr_done: 0
        } : {})
    };

    // Fill other legacy fields with safe defaults to keep downstream code stable.
    const fullDoc = {
        ...base,
        automove: 0,
        empty_cart: 0,
        order_cart: 0,
        priority: 0,
        user_id: 0,
        pcname: 'PWA',
        ipadd: '',
        invoice_num: 0,
        collectioninfo_id: 0,
        returning_cart: 0,
        userlog_id: 0,
        closedby: 0,
        amt_collected: 0,
        from_other_source: 0,
        invoice_count: 0,
        commitment_date: ZERO_DATETIME,
        shutdown_date: ZERO_DATETIME,
        committed_by: '',
        oldest_invoice_age: 0,
        soa_status: 0,
        willsettle: 0,
        firebase_key: '',
        iscancelleddate: '',
        csr_status: 0,
        csr_remarks: '',
        meter_reading: 0,
        tl_status: 0,
        tl_remarks: '',
        customer_request: base.customer_request || '',
        collocutor: '',
        dev_remarks: ''
    };

    const saveBtn = document.getElementById('newReqSaveBtn');
    saveBtn.disabled = true;
    try {
        await setDocument('tbl_schedule', nextId, fullDoc);
        let contactMessage = '';
        try {
            const contactResult = await saveRequestContactIfNeeded({ branchId, caller, phone });
            if (contactResult.status === 'created') {
                contactMessage = ` Contact saved to branch/department file as #${contactResult.id}.`;
            } else if (contactResult.status === 'duplicate') {
                contactMessage = ' Contact number was already on file for this branch/department.';
            }
        } catch (contactError) {
            console.error('Save contact failed:', contactError);
            contactMessage = ` Contact was not saved: ${contactError?.message || contactError}.`;
        }
        closeNewRequestModal();
        await loadOperationsBoard();
        alert(`Service request saved as schedule #${nextId}.${contactMessage}`);
    } catch (err) {
        console.error('Save request failed:', err);
        alert(`Failed to save request: ${err?.message || err}`);
    } finally {
        saveBtn.disabled = false;
    }
}

function openOpsStaffPanel(staffId) {
    opsState.panelStaffId = staffId;
    renderOpsStaffPanel(staffId);
    setOpsPanelOpen(true);
}

function renderOpsStaffPanel(staffId) {
    const panelTitle = document.getElementById('opsPanelTitle');
    const panelSubtitle = document.getElementById('opsPanelSubtitle');
    const panelMeta = document.getElementById('opsPanelMeta');
    const panelBody = document.getElementById('opsPanelBody');

    const employee = opsCache.employees.get(String(staffId)) || null;
    const position = employee ? opsCache.positions.get(String(employee.position_id || 0)) : null;
    const role = getRole(employee, position);
    const assigneeName = getEmployeeName(employee, staffId);
    const rows = getStaffRows(staffId);
    const selectedDate = opsState.selectedDate || '';
    const todayCount = rows.filter((row) => getRouteTaskDateTime(row).slice(0, 10) === selectedDate).length;

    panelTitle.textContent = `${assigneeName} - ${role}`;
    panelSubtitle.textContent = selectedDate
        ? `${rows.length} schedule(s): ${todayCount} on ${selectedDate}`
        : `${rows.length} schedule(s)`;
    panelMeta.textContent = 'All selected-date schedules assigned to this staff member. Printed/saved route details appear when available.';

    const printAllBtn = document.getElementById('opsPanelPrintAllBtn');
    printAllBtn.style.display = rows.length ? 'inline-flex' : 'none';

    if (!rows.length) {
        panelBody.innerHTML = '<tr><td colspan="4" class="loading-cell">No schedules assigned for selected date/filter.</td></tr>';
        return;
    }

    panelBody.innerHTML = rows.map((row) => {
        const { trouble, branch, company, branchId } = getScheduleLookups(row);
        const purposeLabel = getPurposeLabel(row.purpose_id);
        const troubleLabel = trouble?.trouble || (row.trouble_id ? `Trouble ${row.trouble_id}` : 'Unspecified');
        const clientName = company?.companyname || '-';
        const branchName = branch?.branchname || `Branch #${branchId || row.branch_id || 0}`;
        const statusMeta = getOpsStatusMeta(row, opsState.selectedDate);

        const actions = [];

        return `
            <tr>
                <td data-label="Time">${sanitize(formatTaskDateTime(getRouteTaskDateTime(row)))}</td>
                <td data-label="Task">
                    <div>#${sanitize(row.id)} - ${sanitize(purposeLabel)} / ${sanitize(troubleLabel)} <span class="ops-status-pill ${sanitize(statusMeta.className)}">${sanitize(statusMeta.label)}</span></div>
                    <div class="ops-subtext">${sanitize(getRouteNotes(row) || '-')}</div>
                </td>
                <td data-label="Client / Branch">
                    <div>${sanitize(clientName)}</div>
                    <div class="ops-subtext">${sanitize(branchName)}</div>
                </td>
                <td data-label="Action"><div class="ops-row-actions">${sanitize(row.route_source === 'schedule' ? 'Schedule' : `${row.route_source} route`)}</div></td>
            </tr>
        `;
    }).join('');
}

async function editScheduleRow(row) {
    if (!MargaAuth.isAdmin()) {
        alert('Edit is available for admin only.');
        return;
    }

    let nextDateTime = prompt(
        `Edit task datetime for #${row.id} (YYYY-MM-DD HH:MM:SS):`,
        String(row.task_datetime || '')
    );
    if (nextDateTime === null) return;

    nextDateTime = nextDateTime.trim().replace('T', ' ');
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(nextDateTime)) {
        alert('Invalid datetime format. Please use YYYY-MM-DD HH:MM:SS');
        return;
    }

    const nextRemarks = prompt(
        `Edit remarks for #${row.id}:`,
        String(row.remarks || '')
    );
    if (nextRemarks === null) return;

    await patchDocument('tbl_schedule', row.id, {
        task_datetime: nextDateTime,
        remarks: nextRemarks.trim(),
        bridge_updated_at: new Date().toISOString(),
        bridge_updated_by: Number(MargaAuth.getUser()?.staff_id || 0) || 0
    });

    await loadOperationsBoard();
    if (opsState.panelStaffId) renderOpsStaffPanel(opsState.panelStaffId);
    alert(`Schedule #${row.id} updated.`);
}

async function transferScheduleRow(row) {
    if (!MargaAuth.isAdmin()) {
        alert('Transfer is available for admin only.');
        return;
    }

    await ensureAssignableEmployeesLoaded();

    const candidates = getAssignableStaffList();
    if (!candidates.length) {
        alert('No technician/messenger list found.');
        return;
    }

    const selectionText = candidates
        .slice(0, 120)
        .map((staff) => `${staff.id} - ${staff.name} (${staff.role})`)
        .join('\n');

    const selected = prompt(
        `Transfer schedule #${row.id} to staff ID:\n\n${selectionText}`,
        String(row.tech_id || '')
    );
    if (selected === null) return;

    const nextStaffId = Number(selected.trim());
    const target = candidates.find((staff) => staff.id === nextStaffId);
    if (!target) {
        alert('Invalid staff ID selected.');
        return;
    }

    await patchDocument('tbl_schedule', row.id, {
        tech_id: nextStaffId,
        bridge_updated_at: new Date().toISOString(),
        bridge_updated_by: Number(MargaAuth.getUser()?.staff_id || 0) || 0
    });

    await loadOperationsBoard();
    if (opsState.panelStaffId) renderOpsStaffPanel(opsState.panelStaffId);
    alert(`Schedule #${row.id} transferred to ${target.name}.`);
}

function printStaffScheduleRows(staffId) {
    const rows = getStaffRows(staffId);
    if (!rows.length) {
        alert('No schedules to print for this assignee.');
        return;
    }

    const employee = opsCache.employees.get(String(staffId)) || null;
    const position = employee ? opsCache.positions.get(String(employee.position_id || 0)) : null;
    const role = getRole(employee, position);
    const assigneeName = getEmployeeName(employee, staffId);

    const popup = window.open('', '_blank', 'width=1100,height=760');
    if (!popup) {
        alert('Popup blocked. Please allow popups and try again.');
        return;
    }

    const bodyRows = rows.map((row, index) => {
        const { trouble, branch, company, area, branchId } = getScheduleLookups(row);
        const purposeLabel = getPurposeLabel(row.purpose_id);
        const troubleLabel = trouble?.trouble || (row.trouble_id ? `Trouble ${row.trouble_id}` : 'Unspecified');
        const clientName = company?.companyname || '-';
        const branchName = branch?.branchname || `Branch #${branchId || row.branch_id || 0}`;
        const areaName = area?.area_name || '-';
        const notes = row.remarks || row.caller || '-';
        return `
            <tr>
                <td>${index + 1}</td>
                <td>${sanitize(formatTaskDateTime(getRouteTaskDateTime(row)))}</td>
                <td>#${sanitize(row.id)}</td>
                <td>${sanitize(clientName)}<div class="sub">${sanitize(branchName)}</div></td>
                <td>${sanitize(areaName)}</td>
                <td>${sanitize(purposeLabel)} / ${sanitize(troubleLabel)}</td>
                <td>${sanitize(getRouteNotes(row) || notes)}</td>
            </tr>
        `;
    }).join('');

    popup.document.write(`
        <html>
        <head>
            <title>${sanitize(assigneeName)} - Day Sheet</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 18px; color: #1f2937; }
                h1 { margin: 0 0 4px; font-size: 20px; }
                h2 { margin: 0 0 14px; font-size: 13px; color: #475569; font-weight: normal; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #cbd5e1; padding: 6px; font-size: 12px; vertical-align: top; text-align: left; }
                th { background: #f1f5f9; }
                .sub { margin-top: 2px; color: #64748b; font-size: 11px; }
            </style>
        </head>
        <body>
            <h1>MARGA Day Sheet - ${sanitize(assigneeName)} (${sanitize(role)})</h1>
            <h2>Date: ${sanitize(opsState.selectedDate || '-')} | Total Tasks: ${rows.length}</h2>
            <table>
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Time</th>
                        <th>Task ID</th>
                        <th>Client / Branch</th>
                        <th>Area</th>
                        <th>Task</th>
                        <th>Notes</th>
                    </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </body>
        </html>
    `);

    popup.document.close();
    popup.focus();
    popup.print();
}

async function deleteScheduleRow(row) {
    if (!MargaAuth.isAdmin()) {
        alert('Delete is available for admin only.');
        return;
    }

    const proceed = confirm(`Delete schedule #${row.id}? This action cannot be undone.`);
    if (!proceed) return;

    const relatedLogs = opsState.schedtimeRows.filter(
        (log) => Number(log.schedule_id || 0) === Number(row.id)
    );

    if (relatedLogs.length) {
        await Promise.all(
            relatedLogs.map((log) => deleteDocument('tbl_schedtime', log.id).catch(() => null))
        );
    }

    await deleteDocument('tbl_schedule', row.id);

    await loadOperationsBoard();
    if (opsState.panelStaffId) renderOpsStaffPanel(opsState.panelStaffId);
    alert(`Schedule #${row.id} deleted.`);
}

function renderOpsTaskTable(rows, logsBySchedule, lookups) {
    const tbody = document.querySelector('#opsTaskTable tbody');
    const { employeeMap, positionMap, troubleMap, branchMap, companyMap, areaMap } = lookups;

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="loading-cell">No schedules for selected date/filter.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((row) => {
        const staffId = getAssignedStaffId(row);
        const employee = employeeMap.get(String(staffId || 0)) || null;
        const position = employee ? positionMap.get(String(employee.position_id || 0)) : null;
        const role = getRole(employee, position);
        const assignee = getEmployeeName(employee, staffId || 0);
        const trouble = troubleMap.get(String(row.trouble_id || 0));
        const troubleLabel = trouble?.trouble || (row.trouble_id ? `Trouble ${row.trouble_id}` : 'Unspecified');
        const purposeLabel = getPurposeLabel(row.purpose_id);

        const scheduleId = Number(row.id || 0);
        const scheduleLogs = logsBySchedule.get(scheduleId) || [];
        const branchFromLog = scheduleLogs.find((log) => Number(log.branch_id || 0) > 0)?.branch_id || 0;
        const branchId = Number(row.branch_id || 0) > 0 ? Number(row.branch_id) : Number(branchFromLog || 0);
        const branch = branchMap.get(String(branchId || 0));
        const company = companyMap.get(String(row.company_id || branch?.company_id || 0)) || null;
        const area = branch ? areaMap.get(String(branch.area_id || 0)) : null;

        const logInfo = scheduleLogs.length
            ? `${scheduleLogs.length} log${scheduleLogs.length > 1 ? 's' : ''}`
            : '-';

        const clientName = company?.companyname || '-';
        const branchName = branch?.branchname || `Branch #${branchId || row.branch_id || 0}`;
        const areaName = area?.area_name || `Area #${branch?.area_id || 0}`;
        const taskText = `${purposeLabel} / ${troubleLabel}`;
        const statusMeta = getOpsStatusMeta(row, opsState.selectedDate);

        return `
            <tr>
                <td data-label="Time">${sanitize(formatTaskDateTime(getRouteTaskDateTime(row)))}</td>
                <td data-label="Task ID">#${sanitize(row.id)}</td>
                <td data-label="Client / Branch">
                    <div>${sanitize(clientName)}</div>
                    <div class="ops-subtext">${sanitize(branchName)}</div>
                </td>
                <td data-label="Area">${sanitize(areaName)}</td>
                <td data-label="Task">
                    <div>${sanitize(taskText)}</div>
                    <div class="ops-subtext">${sanitize(getRouteNotes(row) || '-')}</div>
                </td>
                <td data-label="Assignee">${sanitize(assignee)}</td>
                <td data-label="Role"><span class="ops-role-badge ${getRoleClass(role)}">${sanitize(role)}</span></td>
                <td data-label="Status"><span class="ops-status-badge ${sanitize(statusMeta.className)}">${sanitize(statusMeta.label)}</span></td>
                <td data-label="Logs">${sanitize(logInfo)}</td>
            </tr>
        `;
    }).join('');
}

function filterRowsByPurpose(rows, purposeFilter) {
    if (purposeFilter === 'all') return rows;
    const purposeId = Number(purposeFilter);
    if (!Number.isFinite(purposeId) || purposeId <= 0) return rows;
    return rows.filter((row) => Number(row.purpose_id || 0) === purposeId);
}

function filterRowsByStatus(rows, selectedDate, statusFilter) {
    if (!statusFilter || statusFilter === 'all') return rows;
    return rows.filter((row) => getOpsStatusKey(row, selectedDate) === statusFilter);
}

function filterRowsByAssigneeRole(rows, assigneeRoleFilter) {
    if (!assigneeRoleFilter || assigneeRoleFilter === 'all') return rows;
    return rows.filter((row) => getAssigneeRoleKey(row) === assigneeRoleFilter);
}

function renderOperationsBoard() {
    const selectedDate = opsState.selectedDate || formatDateYmd(new Date());
    const purposeFilter = opsState.purposeFilter || 'all';
    const statusFilter = opsState.statusFilter || 'all';
    const assigneeRoleFilter = opsState.assigneeRoleFilter || 'all';

    const byPurpose = filterRowsByPurpose(opsState.allRows, purposeFilter);
    const byAssigneeRole = filterRowsByAssigneeRole(byPurpose, assigneeRoleFilter);
    const filtered = filterRowsByStatus(byAssigneeRole, selectedDate, statusFilter);
    opsState.selectedRows = filtered;

    const selectedScheduleIds = new Set(filtered.map((row) => Number(row.id || 0)));
    const logsBySchedule = new Map();
    const logsByStaff = new Map();

    opsState.schedtimeRows.forEach((log) => {
        const staffId = Number(log.tech_id || 0);
        if (staffId > 0) logsByStaff.set(staffId, (logsByStaff.get(staffId) || 0) + 1);

        const scheduleId = Number(log.schedule_id || 0);
        if (scheduleId > 0 && selectedScheduleIds.has(scheduleId)) {
            if (!logsBySchedule.has(scheduleId)) logsBySchedule.set(scheduleId, []);
            logsBySchedule.get(scheduleId).push(log);
        }
    });

    opsState.logsBySchedule = logsBySchedule;
    opsState.logsByStaff = logsByStaff;

    renderOpsStatusKpis(byAssigneeRole, selectedDate);
    renderOpsStaffTable(filtered, logsByStaff, opsCache.employees, opsCache.positions);
    renderOpsTaskTable(filtered.slice(0, OPS_MAX_TASK_ROWS), logsBySchedule, {
        employeeMap: opsCache.employees,
        positionMap: opsCache.positions,
        troubleMap: opsCache.troubles,
        branchMap: opsCache.branches,
        companyMap: opsCache.companies,
        areaMap: opsCache.areas
    });

    const assigneeCount = [...new Set(filtered.map((row) => getAssignedStaffId(row)).filter((id) => id > 0))].length;
    const withLogsCount = [...selectedScheduleIds].filter((id) => logsBySchedule.has(id)).length;
    const unmappedCount = [...new Set(filtered.map((row) => getAssignedStaffId(row)).filter((id) => id > 0))]
        .filter((id) => !opsCache.employees.get(String(id))).length;

    const meta = document.getElementById('opsMeta');
    meta.textContent = `Showing ${filtered.length} task(s) after filters. Assignee group: ${getAssigneeRoleFilterLabel(assigneeRoleFilter)}. Assigned staff: ${assigneeCount}. With time logs: ${withLogsCount}. Unmapped staff IDs: ${unmappedCount}.`;

    const carryoverBtn = document.getElementById('opsCarryoverBtn');
    carryoverBtn.style.display = 'none';

    if (document.getElementById('opsStaffPanel').classList.contains('open') && opsState.panelStaffId) {
        renderOpsStaffPanel(opsState.panelStaffId);
    }
}

async function loadOperationsBoard() {
    const selectedDate = document.getElementById('opsDateInput').value || formatDateYmd(new Date());
    const purposeFilter = document.getElementById('opsPurposeFilter').value || 'all';
    const assigneeRoleFilter = document.getElementById('opsAssigneeRoleFilter')?.value || 'all';
    const subtitle = document.getElementById('opsSubtitle');
    const meta = document.getElementById('opsMeta');
    const panelVisible = document.getElementById('opsStaffPanel').classList.contains('open');
    const includeCarryover = false;

    const purposeLabel = purposeFilter === 'all' ? 'All Tasks' : getPurposeLabel(Number(purposeFilter));
    subtitle.textContent = `Loading ${purposeLabel} schedules for ${selectedDate}...`;
    meta.textContent = 'Querying Firestore schedules, route tables, and execution logs...';

    document.querySelector('#opsStaffTable tbody').innerHTML =
        '<tr><td colspan="6" class="loading-cell">Loading...</td></tr>';
    document.querySelector('#opsTaskTable tbody').innerHTML =
        '<tr><td colspan="9" class="loading-cell">Loading...</td></tr>';

    try {
        const start = `${selectedDate} 00:00:00`;
        const end = `${selectedDate} 23:59:59`;

        const [scheduleDocs, printedDocs, savedDocs, schedtimeDocs] = await Promise.all([
            queryByDateRange('tbl_schedule', 'task_datetime', { start, end }),
            queryByDateRange(ROUTE_COLLECTION_PRIMARY, 'task_datetime', { start, end }).catch(() => []),
            queryByDateRange(ROUTE_COLLECTION_FALLBACK, 'task_datetime', { start, end }).catch(() => []),
            queryByDateRange('tbl_schedtime', 'schedule_date', { start, end })
        ]);

        await ensureClosedScheduleIdsLoaded();

        const scheduleRows = scheduleDocs.map(parseFirestoreDoc).filter(Boolean);
        const printedRows = pickLatestRouteRows(printedDocs.map(parseFirestoreDoc).filter(Boolean), selectedDate);
        const savedRows = pickLatestRouteRows(savedDocs.map(parseFirestoreDoc).filter(Boolean), selectedDate);
        const { mergedRows, routeCoverage } = overlayRouteRowsOnSchedules(scheduleRows, printedRows, savedRows);
        const sortedRows = mergedRows
            .sort((a, b) => {
                const left = getRouteTaskDateTime(a);
                const right = getRouteTaskDateTime(b);
                if (left !== right) return left.localeCompare(right);
                return Number(a.id || 0) - Number(b.id || 0);
            });

        const schedtimeRows = schedtimeDocs.map(parseFirestoreDoc).filter(Boolean);

        opsState.selectedDate = selectedDate;
        opsState.allRows = sortedRows;
        opsState.schedtimeRows = schedtimeRows;
        opsState.purposeFilter = purposeFilter;
        opsState.assigneeRoleFilter = assigneeRoleFilter;
        opsState.includeCarryover = includeCarryover;
        opsState.routeSourceLabel = 'Schedule';

        const assigneeIds = sortedRows.map((row) => getAssignedStaffId(row));
        const troubleIds = sortedRows.map((row) => Number(row.trouble_id || 0));
        const branchIds = sortedRows.map((row) => Number(row.branch_id || 0)).filter((id) => id > 0);
        schedtimeRows.forEach((log) => {
            const branchId = Number(log.branch_id || 0);
            if (branchId > 0) branchIds.push(branchId);
        });
        const companyIdsFromSchedule = sortedRows.map((row) => Number(row.company_id || 0)).filter((id) => id > 0);

        await Promise.all([
            fetchManyDocs('tbl_employee', assigneeIds, opsCache.employees),
            fetchManyDocs('tbl_trouble', troubleIds, opsCache.troubles),
            fetchManyDocs('tbl_branchinfo', branchIds, opsCache.branches)
        ]);

        const positionIds = [...opsCache.employees.values()]
            .filter(Boolean)
            .map((employee) => Number(employee.position_id || 0));

        const companyIds = [...opsCache.branches.values()]
            .filter(Boolean)
            .map((branch) => Number(branch.company_id || 0));
        companyIds.push(...companyIdsFromSchedule);

        const areaIds = [...opsCache.branches.values()]
            .filter(Boolean)
            .map((branch) => Number(branch.area_id || 0));

        await Promise.all([
            fetchManyDocs('tbl_empos', positionIds, opsCache.positions),
            fetchManyDocs('tbl_companylist', companyIds, opsCache.companies),
            fetchManyDocs('tbl_area', areaIds, opsCache.areas)
        ]);

        const visibleRows = filterRowsByAssigneeRole(filterRowsByPurpose(sortedRows, purposeFilter), assigneeRoleFilter);
        subtitle.textContent = `Operations for ${selectedDate} (${purposeLabel}, ${getAssigneeRoleFilterLabel(assigneeRoleFilter)}): ${visibleRows.length} schedule(s), ${schedtimeRows.length} execution log(s).`;
        meta.textContent = `Schedule-first view is active. Route coverage: ${routeCoverage.boundCount}/${sortedRows.length} schedules have printed/saved rows (${routeCoverage.printedCount} printed, ${routeCoverage.savedCount} saved, ${routeCoverage.orphanCount} orphan route row(s)).`;

        if (panelVisible && opsState.panelStaffId) {
            renderOpsStaffPanel(opsState.panelStaffId);
        }

        renderOperationsBoard();
    } catch (error) {
        console.error('Operations board load failed:', error);
        subtitle.textContent = `Failed to load operations data for ${selectedDate}.`;
        meta.textContent = `Error: ${error.message}`;
        document.querySelector('#opsStaffTable tbody').innerHTML =
            '<tr><td colspan="6" class="loading-cell">Unable to load data.</td></tr>';
        document.querySelector('#opsTaskTable tbody').innerHTML =
            '<tr><td colspan="9" class="loading-cell">Unable to load data.</td></tr>';
    }
}

async function batchCarryoverPending() {
    alert('Batch carryover is disabled in printed route mode.');
    return;

    const selectedDate = opsState.selectedDate || formatDateYmd(new Date());
    const canCarry = MargaAuth.isAdmin() || MargaAuth.hasRole('service');
    if (!canCarry) {
        alert('Batch carryover is available for Admin / Service roles only.');
        return;
    }

    const purposeFilter = opsState.purposeFilter || 'all';
    const byPurpose = filterRowsByPurpose(opsState.allRows, purposeFilter);
    const pendingToday = byPurpose
        .filter((row) => String(row.task_datetime || '').startsWith(selectedDate))
        .filter((row) => ['pending', 'ongoing'].includes(getOpsStatusKey(row, selectedDate)));

    if (!pendingToday.length) {
        alert('No pending schedules found for selected date.');
        return;
    }

    const nextDate = addDaysYmd(selectedDate, 1);
    const proceed = confirm(`Carry over ${pendingToday.length} pending schedule(s) from ${selectedDate} to ${nextDate}?`);
    if (!proceed) return;

    const concurrency = 6;
    let index = 0;
    const failures = [];

    const workers = Array.from({ length: concurrency }, async () => {
        while (index < pendingToday.length) {
            const current = pendingToday[index++];
            const timePart = String(current.task_datetime || '').slice(11) || '00:00:00';
            const nextDateTime = `${nextDate} ${timePart}`;
            try {
                await patchDocument('tbl_schedule', current.id, {
                    task_datetime: nextDateTime,
                    bridge_updated_at: new Date().toISOString(),
                    bridge_updated_by: Number(MargaAuth.getUser()?.staff_id || 0) || 0
                });
            } catch (err) {
                failures.push({ id: current.id, message: err?.message || String(err) });
            }
        }
    });

    await Promise.all(workers);

    if (failures.length) {
        console.warn('Carryover failures:', failures);
        alert(`Carryover finished with ${failures.length} failure(s). Check console for details.`);
    } else {
        alert(`Carryover completed. Moved ${pendingToday.length} schedule(s) to ${nextDate}.`);
    }

    const jump = confirm(`Open ${nextDate} now?`);
    if (jump) {
        document.getElementById('opsDateInput').value = nextDate;
    }
    await loadOperationsBoard();
}

window.toggleSidebar = toggleSidebar;
