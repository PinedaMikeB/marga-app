const MASTER_API_KEY = FIREBASE_CONFIG.apiKey;
const MASTER_BASE_URL = FIREBASE_CONFIG.baseUrl;
const MASTER_LIMIT = 1200;

const DEFAULT_AREAS = [
    'South 1', 'South 2', 'South 3',
    'Quezon 1', 'Quezon 2', 'Quezon 3',
    'PMS 1', 'PMS 2',
    'Manila 1', 'Manila 2',
    'Makati 1', 'Makati 2', 'Makati 3',
    'Rizal 1', 'Rizal 2',
    'All', 'Others', 'N/A'
];

const DEFAULT_CITIES = [
    'Alabang', 'Alaminos', 'Angeles', 'Angono', 'Antipolo', 'Bacoor', 'Bago', 'Baguio',
    'Bais', 'Balanga', 'Binan', 'Calamba', 'Cavite City', 'Dasmarinas', 'General Trias',
    'Imus', 'Laguna', 'Las Pinas', 'Muntinlupa', 'Tagaytay', 'Trece Martires'
];

const MASTER_PURPOSE_LABELS = {
    1: 'Printed Billing',
    2: 'Confirmed Collection',
    3: 'Deliver Toner',
    4: 'Deliver Ink',
    5: 'Service',
    8: 'Printed Billing',
    9: 'Others'
};

const CLIENT_INFO_TYPES = [
    { key: 'service', label: 'Service Info' },
    { key: 'billing', label: 'Billing Info' },
    { key: 'collection', label: 'Collection Info' },
    { key: 'delivery', label: 'Delivery Info' }
];

const masterState = {
    rows: [],
    settingsLoaded: false,
    reassigning: false,
    selectedArea: DEFAULT_AREAS[0],
    selectedTechId: '',
    selectedBranchId: '',
    customAreas: new Set(),
    customCities: new Set(),
    areaCityRows: new Map(),
    techAreaRows: new Map(),
    clientAreaRows: new Map(),
    lookups: {
        branches: new Map(),
        companies: new Map(),
        machines: new Map(),
        contracts: new Map(),
        contractDeps: new Map(),
        employees: new Map(),
        positions: new Map(),
        troubles: new Map(),
        areas: new Map()
    },
    settings: {
        branches: [],
        employees: []
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('masterDateInput');
    dateInput.value = formatDateYmd(new Date());
    dateInput.addEventListener('change', loadMasterSchedule);

    document.getElementById('masterStatusInput')?.addEventListener('change', renderMasterSchedule);
    document.getElementById('masterSearchInput')?.addEventListener('input', renderMasterSchedule);
    document.getElementById('masterRefreshBtn')?.addEventListener('click', loadMasterSchedule);
    document.getElementById('masterPrintBtn')?.addEventListener('click', printMasterSchedule);
    document.getElementById('masterPrintScopeInput')?.addEventListener('change', updatePrintStaffVisibility);

    document.querySelectorAll('[data-master-view]').forEach((button) => {
        button.addEventListener('click', () => switchMasterView(button.dataset.masterView));
    });
    document.querySelectorAll('[data-settings-tab]').forEach((button) => {
        button.addEventListener('click', () => switchSettingsTab(button.dataset.settingsTab));
    });

    bindSettingsControls();
    loadMasterSchedule();
});

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function formatDateYmd(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseFirestoreValue(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.integerValue !== undefined) return Number(value.integerValue);
    if (value.doubleValue !== undefined) return Number(value.doubleValue);
    if (value.booleanValue !== undefined) return value.booleanValue;
    if (value.timestampValue !== undefined) return value.timestampValue;
    if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(parseFirestoreValue);
    if (value.mapValue !== undefined) {
        const parsed = {};
        Object.entries(value.mapValue.fields || {}).forEach(([key, child]) => {
            parsed[key] = parseFirestoreValue(child);
        });
        return parsed;
    }
    return null;
}

function parseFirestoreDoc(doc) {
    const parsed = { _docId: String(doc?.name || '').split('/').pop() || '' };
    Object.entries(doc?.fields || {}).forEach(([key, value]) => {
        parsed[key] = parseFirestoreValue(value);
    });
    return parsed;
}

function firestoreValue(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    return { stringValue: String(value ?? '') };
}

async function runStructuredQuery(structuredQuery) {
    const response = await fetch(`${MASTER_BASE_URL}:runQuery?key=${encodeURIComponent(MASTER_API_KEY)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json();
    if (!response.ok || payload?.error || payload?.[0]?.error) {
        throw new Error(payload?.error?.message || payload?.[0]?.error?.message || 'Firestore query failed.');
    }
    return Array.isArray(payload) ? payload.map((entry) => entry.document).filter(Boolean) : [];
}

async function queryDateRange(collection, fieldPath, start, end) {
    return runStructuredQuery({
        from: [{ collectionId: collection }],
        where: {
            compositeFilter: {
                op: 'AND',
                filters: [
                    { fieldFilter: { field: { fieldPath }, op: 'GREATER_THAN_OR_EQUAL', value: firestoreValue(start) } },
                    { fieldFilter: { field: { fieldPath }, op: 'LESS_THAN_OR_EQUAL', value: firestoreValue(end) } }
                ]
            }
        },
        limit: MASTER_LIMIT
    });
}

async function queryEquals(collection, fieldPath, value) {
    return runStructuredQuery({
        from: [{ collectionId: collection }],
        where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: firestoreValue(value) } },
        limit: MASTER_LIMIT
    });
}

async function fetchCollection(collection, options = {}) {
    const { pageSize = 1000, maxPages = 20, fieldMask = null } = options;
    const rows = [];
    let token = '';

    for (let page = 0; page < maxPages; page += 1) {
        const params = new URLSearchParams({ pageSize: String(pageSize), key: MASTER_API_KEY });
        if (token) params.set('pageToken', token);
        if (Array.isArray(fieldMask)) fieldMask.forEach((path) => params.append('mask.fieldPaths', path));
        const response = await fetch(`${MASTER_BASE_URL}/${collection}?${params.toString()}`);
        if (response.status === 404) return rows;
        const payload = await response.json();
        if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to load ${collection}`);
        rows.push(...(payload.documents || []).map(parseFirestoreDoc));
        if (!payload.nextPageToken) break;
        token = payload.nextPageToken;
    }

    return rows;
}

async function fetchDoc(collection, docId) {
    if (!docId && docId !== 0) return null;
    const response = await fetch(`${MASTER_BASE_URL}/${collection}/${encodeURIComponent(String(docId))}?key=${MASTER_API_KEY}`);
    if (response.status === 404) return null;
    const payload = await response.json();
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to load ${collection}/${docId}`);
    return parseFirestoreDoc(payload);
}

async function fetchMany(collection, ids, cache) {
    const unique = Array.from(new Set(
        ids.map((id) => String(id || '').trim()).filter((id) => id && id !== '0' && !cache.has(id))
    ));
    await Promise.all(unique.map(async (id) => {
        const doc = await fetchDoc(collection, id).catch(() => null);
        if (doc) cache.set(id, doc);
    }));
}

async function setDoc(collection, docId, row) {
    const fields = {};
    Object.entries(row).forEach(([key, value]) => {
        if (!key.startsWith('_') && key !== 'searchText') fields[key] = firestoreValue(value);
    });
    const response = await fetch(`${MASTER_BASE_URL}/${collection}/${encodeURIComponent(String(docId))}?key=${MASTER_API_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || 'Save failed.');
    return payload;
}

async function updateDocFields(collection, docId, row) {
    const safeDocId = encodeURIComponent(String(docId || '').trim());
    const entries = Object.entries(row).filter(([key]) => !key.startsWith('_') && key !== 'searchText');
    if (!safeDocId || !entries.length) return null;

    const params = new URLSearchParams({ key: MASTER_API_KEY });
    entries.forEach(([key]) => params.append('updateMask.fieldPaths', key));

    const fields = {};
    entries.forEach(([key, value]) => {
        fields[key] = firestoreValue(value);
    });

    const response = await fetch(`${MASTER_BASE_URL}/${collection}/${safeDocId}?${params.toString()}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || 'Update failed.');
    return payload;
}

async function deleteDoc(collection, docId) {
    const response = await fetch(`${MASTER_BASE_URL}/${collection}/${encodeURIComponent(String(docId))}?key=${MASTER_API_KEY}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error?.message || 'Delete failed.');
    }
}

function slug(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'blank';
}

function clean(value) {
    return String(value || '').trim();
}

function normalizeSearch(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function employeeName(employee, fallbackId = '') {
    if (!employee) return fallbackId ? `ID ${fallbackId}` : 'Unassigned';
    const nickname = clean(employee.nickname);
    const first = clean(employee.firstname);
    const last = clean(employee.lastname);
    return nickname || `${first} ${last}`.trim() || clean(employee.name) || `ID ${fallbackId}`;
}

function employeeRole(employee) {
    const position = masterState.lookups.positions.get(String(employee?.position_id || ''));
    const label = clean(position?.position || position?.position_name || position?.name || employee?.position).toLowerCase();
    const positionId = Number(employee?.position_id || 0);
    if (positionId === 5 || label.includes('technician') || label.includes('tech')) return 'Technician';
    if (positionId === 9 || label.includes('messenger') || label.includes('driver')) return label.includes('driver') ? 'Driver' : 'Messenger';
    if (label.includes('driver')) return 'Driver';
    return label ? clean(position?.position || position?.name || employee?.position) : 'Staff';
}

function isScheduleStaff(employee) {
    const role = employeeRole(employee).toLowerCase();
    return role.includes('technician') || role.includes('messenger') || role.includes('driver');
}

function scheduleStaffOptions() {
    const employees = masterState.settings.employees;
    const filtered = employees.filter(isScheduleStaff);
    return filtered.length ? filtered : employees;
}

function purposeFromLegacy(row, trouble) {
    const purposeId = Number(row.purpose_id || 0);
    const explicit = MASTER_PURPOSE_LABELS[purposeId] || '';
    const clue = `${explicit} ${trouble?.trouble || ''} ${row.remarks || ''}`.toLowerCase();
    if (clue.includes('toner')) return 'Deliver Toner';
    if (clue.includes('ink') || clue.includes('cartridge')) return 'Deliver Ink';
    if (clue.includes('collection')) return 'Confirmed Collection';
    if (clue.includes('billing') || clue.includes('invoice')) return 'Printed Billing';
    return explicit || `Purpose ${purposeId || '-'}`;
}

function branchCity(branch) {
    return clean(branch?.city || branch?.address_city || branch?.branch_city || branch?.municipality);
}

function areaFromCity(city) {
    const row = masterState.areaCityRows.get(slug(city));
    return clean(row?.area);
}

function areaFromBranch(branchId, branch, purpose = 'service') {
    const client = masterState.clientAreaRows.get(String(branchId || ''));
    const clientArea = clean(client?.[`${purpose}_area`] || client?.area);
    if (clientArea) return clientArea;
    return areaFromCity(branchCity(branch)) || clean(branch?.area || branch?.area_name) || 'N/A';
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function machineModel(machine, row = {}) {
    return clean(row.model || row.model_name || machine?.model || machine?.model_id || machine?.description);
}

function machineSerial(machine, row = {}) {
    return clean(row.serial_number || row.field_serial_selected || machine?.serial || row.serial);
}

function buildLegacyScheduleRow(row) {
    const branch = masterState.lookups.branches.get(String(row.branch_id || ''));
    const company = masterState.lookups.companies.get(String(row.company_id || branch?.company_id || ''));
    const machine = masterState.lookups.machines.get(String(row.serial || row.mach_id || ''));
    const trouble = masterState.lookups.troubles.get(String(row.trouble_id || ''));
    const employee = masterState.lookups.employees.get(String(row.tech_id || ''));
    const contract = masterState.lookups.contracts.get(String(row.contractmain_id || row.contract_id || ''));
    const contractDep = masterState.lookups.contractDeps.get(String(row.contractdep_id || row.contract_dep_id || ''));
    const purpose = purposeFromLegacy(row, trouble);
    const purposeKey = /billing|invoice/i.test(purpose) ? 'billing'
        : (/collection/i.test(purpose) ? 'collection' : (/toner|ink|deliver/i.test(purpose) ? 'delivery' : 'service'));
    const branchName = clean(contractDep?.departmentname || branch?.branchname || row.branch_name) || 'Main';
    const model = machineModel(machine, { ...row, model: contract?.model || contract?.model_id });
    const serial = machineSerial(machine, row);
    const assignedTo = employeeName(employee, row.tech_id);
    const area = areaFromBranch(row.branch_id, branch, purposeKey);
    const customer = clean(company?.companyname || row.company_name || row.client || branch?.companyname) || 'Unknown Customer';

    return {
        source: 'legacy',
        rowKey: `legacy_${row._docId || row.id || ''}`,
        docId: row._docId || row.id || '',
        techId: String(row.tech_id || ''),
        branchId: String(row.branch_id || ''),
        companyId: String(row.company_id || branch?.company_id || ''),
        purpose,
        area,
        customer,
        branch: branchName,
        model,
        serial,
        assignedTo,
        status: 'Active',
        searchText: [purpose, area, customer, branchName, model, serial, assignedTo, row.invoice_num, trouble?.trouble].join(' ')
    };
}

function buildWebScheduleRow(row) {
    const purpose = clean(row.purpose || row.schedule_status || 'Collection');
    const branchId = String(row.branch_id || '');
    const branch = masterState.lookups.branches.get(branchId);
    const purposeKey = /billing/i.test(purpose) ? 'billing'
        : (/collection/i.test(purpose) ? 'collection' : (/toner|ink|deliver/i.test(purpose) ? 'delivery' : 'service'));
    const area = clean(row.area || row.area_group) || areaFromBranch(branchId, branch, purposeKey);
    const assignedTo = clean(row.assigned_to || row.collector) || 'Collector';

    return {
        source: 'web',
        rowKey: `web_${row._docId || ''}`,
        docId: row._docId,
        original: row,
        techId: String(row.assigned_to_id || row.tech_id || ''),
        branchId,
        companyId: String(row.company_id || ''),
        purpose,
        area,
        customer: clean(row.customer || row.company_name) || 'Unknown Customer',
        branch: clean(row.branch || row.branch_name) || 'Main',
        model: clean(row.model || row.model_name),
        serial: clean(row.serial || row.serial_number),
        assignedTo,
        status: clean(row.status || 'Active') || 'Active',
        searchText: [purpose, area, row.customer, row.branch, row.model, row.serial, assignedTo, row.status].join(' ')
    };
}

function buildPlannerScheduleRow(row) {
    const serials = parseJsonArray(row.serial_numbers_json || row.serial_numbers).filter(Boolean);
    const branchNames = parseJsonArray(row.branch_names_json || row.branch_names).filter(Boolean);
    const purpose = row.department === 'collection' ? 'Confirmed Collection' : 'Printed Billing';
    const area = clean(row.area || row.area_group) || 'N/A';
    const assignedTo = clean(row.assigned_staff_name || row.suggested_staff_name || row.suggested_messenger_name) || 'Suggested / Unassigned';

    return {
        source: 'planner',
        rowKey: `planner_${row._docId || row.id || ''}`,
        docId: row._docId || row.id || '',
        techId: String(row.assigned_staff_id || row.suggested_staff_id || ''),
        purpose,
        area,
        customer: row.company_name || row.account_name || 'Unknown Customer',
        branch: row.primary_branch_name || branchNames[0] || 'Main',
        model: row.model || '',
        serial: serials[0] || row.serial || '',
        assignedTo,
        status: row.planner_status || row.task_status || 'Suggested',
        searchText: [purpose, area, row.company_name, row.account_name, row.primary_branch_name, serials.join(' '), assignedTo].join(' ')
    };
}

async function hydrateLegacyLookups(rows) {
    const branchIds = rows.map((row) => row.branch_id);
    const companyIds = rows.map((row) => row.company_id);
    const machineIds = rows.map((row) => row.serial || row.mach_id);
    const employeeIds = rows.map((row) => row.tech_id);
    const troubleIds = rows.map((row) => row.trouble_id);
    const contractIds = rows.map((row) => row.contractmain_id || row.contract_id);
    const contractDepIds = rows.map((row) => row.contractdep_id || row.contract_dep_id);

    await Promise.all([
        fetchMany('tbl_branchinfo', branchIds, masterState.lookups.branches),
        fetchMany('tbl_companylist', companyIds, masterState.lookups.companies),
        fetchMany('tbl_machine', machineIds, masterState.lookups.machines),
        fetchMany('tbl_employee', employeeIds, masterState.lookups.employees),
        fetchMany('tbl_trouble', troubleIds, masterState.lookups.troubles),
        fetchMany('tbl_contractmain', contractIds, masterState.lookups.contracts),
        fetchMany('tbl_contractdep', contractDepIds, masterState.lookups.contractDeps)
    ]);

    const branchCompanyIds = Array.from(masterState.lookups.branches.values()).map((branch) => branch?.company_id);
    const areaIds = Array.from(masterState.lookups.branches.values()).map((branch) => branch?.area_id);
    await Promise.all([
        fetchMany('tbl_companylist', branchCompanyIds, masterState.lookups.companies),
        fetchMany('tbl_area', areaIds, masterState.lookups.areas)
    ]);
}

async function loadMasterConfigs() {
    const [areaCities, techAreas, clientAreas] = await Promise.all([
        fetchCollection('marga_master_schedule_area_cities', { maxPages: 10 }).catch(() => []),
        fetchCollection('marga_master_schedule_tech_areas', { maxPages: 10 }).catch(() => []),
        fetchCollection('marga_master_schedule_client_areas', { maxPages: 20 }).catch(() => [])
    ]);

    masterState.areaCityRows = new Map();
    masterState.techAreaRows = new Map();
    masterState.clientAreaRows = new Map();
    masterState.customAreas = new Set();
    masterState.customCities = new Set();

    areaCities.forEach((row) => {
        const area = clean(row.area);
        const city = clean(row.city);
        if (!area || !city) return;
        masterState.areaCityRows.set(slug(city), row);
        masterState.customAreas.add(area);
        masterState.customCities.add(city);
    });

    techAreas.forEach((row) => {
        const techId = clean(row.tech_id);
        const area = clean(row.area);
        if (!techId || !area) return;
        if (!masterState.techAreaRows.has(techId)) masterState.techAreaRows.set(techId, new Map());
        masterState.techAreaRows.get(techId).set(area, row);
        masterState.customAreas.add(area);
    });

    clientAreas.forEach((row) => {
        const branchId = clean(row.branch_id || row._docId?.replace(/^branch_/, ''));
        if (!branchId) return;
        masterState.clientAreaRows.set(branchId, row);
        CLIENT_INFO_TYPES.forEach((type) => {
            if (row[`${type.key}_area`]) masterState.customAreas.add(row[`${type.key}_area`]);
            if (row[`${type.key}_city`]) masterState.customCities.add(row[`${type.key}_city`]);
        });
    });
}

async function loadMasterSchedule() {
    const date = document.getElementById('masterDateInput')?.value || formatDateYmd(new Date());
    const sheet = document.getElementById('masterScheduleSheet');
    const count = document.getElementById('masterCount');
    if (sheet) sheet.innerHTML = '<div class="master-empty">Loading Master Schedule...</div>';
    if (count) count.textContent = 'Loading schedules...';

    try {
        await loadMasterConfigs();
        await ensureSettingsData();
        const start = `${date} 00:00:00`;
        const end = `${date} 23:59:59`;
        const [legacyDocs, plannerDocs, webDocs] = await Promise.all([
            queryDateRange('tbl_schedule', 'task_datetime', start, end).catch(() => []),
            queryEquals('tbl_schedule_planner', 'schedule_date', date).catch(() => []),
            queryEquals('marga_master_schedule', 'schedule_date', date).catch(() => [])
        ]);

        const legacyRows = legacyDocs.map(parseFirestoreDoc);
        const plannerRows = plannerDocs.map(parseFirestoreDoc);
        const webRows = webDocs.map(parseFirestoreDoc);
        await hydrateLegacyLookups(legacyRows);

        masterState.rows = [
            ...webRows.map(buildWebScheduleRow),
            ...legacyRows.map(buildLegacyScheduleRow),
            ...plannerRows.map(buildPlannerScheduleRow)
        ].sort((a, b) => {
            if (a.assignedTo !== b.assignedTo) return a.assignedTo.localeCompare(b.assignedTo);
            if (a.area !== b.area) return a.area.localeCompare(b.area);
            if (a.purpose !== b.purpose) return a.purpose.localeCompare(b.purpose);
            return a.customer.localeCompare(b.customer);
        });

        renderMasterSchedule();
        renderSettingsIfVisible();
    } catch (error) {
        console.error('Master Schedule load failed:', error);
        if (count) count.textContent = 'Unable to load';
        if (sheet) sheet.innerHTML = `<div class="master-empty">Master Schedule failed to load: ${escapeHtml(error.message || error)}</div>`;
    }
}

function getVisibleRows() {
    const statusFilter = clean(document.getElementById('masterStatusInput')?.value || 'active').toLowerCase();
    const search = normalizeSearch(document.getElementById('masterSearchInput')?.value || '');

    return masterState.rows.filter((row) => {
        const isCancelled = clean(row.status).toLowerCase() === 'cancelled';
        if (statusFilter === 'active' && isCancelled) return false;
        if (statusFilter === 'cancelled' && !isCancelled) return false;
        if (search && !normalizeSearch(row.searchText).includes(search)) return false;
        return true;
    });
}

function renderMasterSchedule() {
    const rows = getVisibleRows();
    const sheet = document.getElementById('masterScheduleSheet');
    const count = document.getElementById('masterCount');
    if (count) count.textContent = `${rows.length.toLocaleString()} schedule${rows.length === 1 ? '' : 's'}`;
    renderPrintStaffOptions();
    if (!sheet) return;

    if (!rows.length) {
        sheet.innerHTML = '<div class="master-empty">No schedules found for this date/filter.</div>';
        return;
    }

    const groups = new Map();
    rows.forEach((row) => {
        const key = row.assignedTo || 'Unassigned';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });

    sheet.innerHTML = `
        <section class="master-group">
            <h1 style="margin:0 0 18px;font-size:28px;color:#111827;">Master Schedule</h1>
        </section>
        ${Array.from(groups.entries()).map(([group, groupRows]) => `
            <section class="master-group">
                <h2>${escapeHtml(group)}</h2>
                <table class="master-table">
                    <thead>
                        <tr>
                            <th>Purpose</th>
                            <th>Area</th>
                            <th>Customer Name</th>
                            <th>Branch</th>
                            <th>Model</th>
                            <th>Serial</th>
                            <th>Assigned To</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${groupRows.map(renderMasterScheduleRow).join('')}
                    </tbody>
                </table>
            </section>
        `).join('')}
    `;
}

function renderMasterScheduleRow(row) {
    const staffOptions = renderStaffSelectOptions(row);
    return `
        <tr data-row-key="${escapeHtml(row.rowKey)}">
            <td>${escapeHtml(row.purpose || '-')}</td>
            <td>${escapeHtml(row.area || '-')}</td>
            <td>${escapeHtml(row.customer || '-')}</td>
            <td>${escapeHtml(row.branch || '-')}</td>
            <td class="numeric">${escapeHtml(row.model || '-')}</td>
            <td class="numeric">${escapeHtml(row.serial || '-')}</td>
            <td>
                <select class="staff-select" onchange="reassignScheduleFromSelect('${escapeHtml(row.rowKey)}', this.value)">
                    ${staffOptions}
                </select>
            </td>
        </tr>
    `;
}

function renderStaffSelectOptions(row) {
    const staff = scheduleStaffOptions();
    const selectedId = clean(row.techId);
    const selectedKnown = selectedId && staff.some((employee) => String(employee.id) === selectedId);
    const options = [];
    if (!selectedKnown && row.assignedTo) {
        options.push(`<option value="" selected>${escapeHtml(row.assignedTo)}</option>`);
    }
    options.push(...staff.map((employee) => {
        const id = String(employee.id);
        const selected = selectedId ? id === selectedId : employeeName(employee, id) === row.assignedTo;
        return `<option value="${escapeHtml(id)}"${selected ? ' selected' : ''}>${escapeHtml(employeeName(employee, id))}</option>`;
    }));
    return options.join('');
}

function findScheduleRow(rowKey) {
    return masterState.rows.find((row) => row.rowKey === rowKey);
}

function getStaffById(staffId) {
    return masterState.lookups.employees.get(String(staffId || '')) || null;
}

async function updateScheduleOwner(row, employee) {
    const staffId = String(employee?.id || '').trim();
    const staffName = employeeName(employee, staffId);
    if (!row || !staffId) return;

    if (row.source === 'legacy') {
        await updateDocFields('tbl_schedule', row.docId, { tech_id: Number(staffId) || staffId });
    } else if (row.source === 'web') {
        await updateDocFields('marga_master_schedule', row.docId, {
            assigned_to_id: staffId,
            assigned_to: staffName,
            updated_at: new Date().toISOString()
        });
    } else if (row.source === 'planner') {
        await updateDocFields('tbl_schedule_planner', row.docId, {
            assigned_staff_id: staffId,
            assigned_staff_name: staffName,
            updated_at: new Date().toISOString()
        });
    }

    row.techId = staffId;
    row.assignedTo = staffName;
    row.searchText = [row.purpose, row.area, row.customer, row.branch, row.model, row.serial, row.assignedTo].join(' ');
}

async function reassignScheduleFromSelect(rowKey, staffId) {
    const row = findScheduleRow(rowKey);
    const employee = getStaffById(staffId);
    if (!row || !employee || masterState.reassigning) {
        renderMasterSchedule();
        return;
    }

    const oldStaff = row.assignedTo || 'Unassigned';
    const newStaff = employeeName(employee, staffId);
    if (oldStaff === newStaff) return;

    const scope = clean(document.getElementById('masterMoveScopeInput')?.value || 'row');
    const targets = scope === 'staff'
        ? masterState.rows.filter((item) => item.assignedTo === oldStaff && clean(item.status).toLowerCase() !== 'cancelled')
        : [row];

    if (targets.length > 1) {
        const ok = window.confirm(`Move ${targets.length} schedule row(s) assigned to ${oldStaff} to ${newStaff}?`);
        if (!ok) {
            renderMasterSchedule();
            return;
        }
    }

    masterState.reassigning = true;
    const count = document.getElementById('masterCount');
    if (count) count.textContent = `Moving ${targets.length} schedule row(s)...`;

    try {
        for (const target of targets) {
            await updateScheduleOwner(target, employee);
        }
        masterState.rows.sort((a, b) => {
            if (a.assignedTo !== b.assignedTo) return a.assignedTo.localeCompare(b.assignedTo);
            if (a.area !== b.area) return a.area.localeCompare(b.area);
            return a.customer.localeCompare(b.customer);
        });
        renderMasterSchedule();
        if (count) count.textContent = `Moved ${targets.length} schedule row(s) to ${newStaff}.`;
    } catch (error) {
        console.error('Schedule reassignment failed:', error);
        if (count) count.textContent = `Move failed: ${error.message || error}`;
        renderMasterSchedule();
    } finally {
        masterState.reassigning = false;
    }
}

function activeRows() {
    return masterState.rows.filter((row) => clean(row.status).toLowerCase() !== 'cancelled');
}

function uniqueAssignedStaff(rows = activeRows()) {
    return Array.from(new Set(rows.map((row) => row.assignedTo || 'Unassigned'))).filter(Boolean).sort();
}

function renderPrintStaffOptions() {
    const select = document.getElementById('masterPrintStaffInput');
    if (!select) return;
    const current = select.value;
    const staff = uniqueAssignedStaff();
    select.innerHTML = staff.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    if (staff.includes(current)) select.value = current;
    updatePrintStaffVisibility();
}

function updatePrintStaffVisibility() {
    const scope = clean(document.getElementById('masterPrintScopeInput')?.value || 'all');
    const staffInput = document.getElementById('masterPrintStaffInput');
    if (staffInput) staffInput.disabled = scope !== 'staff';
}

function rowsForPrint() {
    const scope = clean(document.getElementById('masterPrintScopeInput')?.value || 'all');
    if (scope === 'visible') return getVisibleRows();
    if (scope === 'staff') {
        const staff = clean(document.getElementById('masterPrintStaffInput')?.value);
        return activeRows().filter((row) => row.assignedTo === staff);
    }
    return activeRows();
}

function renderScheduleHtml(rows, title = 'Master Schedule') {
    const groups = new Map();
    rows.forEach((row) => {
        const key = row.assignedTo || 'Unassigned';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });

    return `
        <h1>${escapeHtml(title)}</h1>
        ${Array.from(groups.entries()).map(([staff, groupRows]) => `
            <section class="print-group">
                <h2>${escapeHtml(staff)}</h2>
                <table>
                    <thead>
                        <tr>
                            <th>Purpose</th>
                            <th>Area</th>
                            <th>Customer Name</th>
                            <th>Branch</th>
                            <th>Model</th>
                            <th>Serial</th>
                            <th>Assigned To</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${groupRows.map((row) => `
                            <tr>
                                <td>${escapeHtml(row.purpose || '-')}</td>
                                <td>${escapeHtml(row.area || '-')}</td>
                                <td>${escapeHtml(row.customer || '-')}</td>
                                <td>${escapeHtml(row.branch || '-')}</td>
                                <td>${escapeHtml(row.model || '-')}</td>
                                <td>${escapeHtml(row.serial || '-')}</td>
                                <td>${escapeHtml(row.assignedTo || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </section>
        `).join('')}
    `;
}

function printMasterSchedule() {
    const rows = rowsForPrint();
    if (!rows.length) {
        window.alert('No schedule rows to print for the selected option.');
        return;
    }

    const date = document.getElementById('masterDateInput')?.value || formatDateYmd(new Date());
    const scope = clean(document.getElementById('masterPrintScopeInput')?.value || 'all');
    const staff = clean(document.getElementById('masterPrintStaffInput')?.value);
    const suffix = scope === 'staff' && staff ? ` - ${staff}` : '';
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) {
        window.alert('Please allow pop-ups to print the schedule.');
        return;
    }

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Master Schedule ${escapeHtml(date)}${escapeHtml(suffix)}</title>
            <style>
                body { font-family: Arial, sans-serif; color: #111827; padding: 18px; }
                h1 { font-size: 28px; margin: 0 0 18px; }
                h2 { font-size: 18px; margin: 24px 0 5px; }
                table { border-collapse: collapse; min-width: 960px; font-size: 12px; }
                th, td { border: 1px solid #111827; padding: 4px 6px; text-align: left; vertical-align: top; }
                th { font-weight: 800; }
                .print-group { page-break-inside: avoid; margin-bottom: 24px; }
                @page { size: landscape; margin: 12mm; }
            </style>
        </head>
        <body>${renderScheduleHtml(rows, `Master Schedule - ${date}${suffix}`)}</body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
}

function allAreas() {
    return Array.from(new Set([...DEFAULT_AREAS, ...masterState.customAreas])).filter(Boolean).sort((a, b) => {
        const ai = DEFAULT_AREAS.indexOf(a);
        const bi = DEFAULT_AREAS.indexOf(b);
        if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        return a.localeCompare(b);
    });
}

function allCities() {
    const branchCities = masterState.settings.branches.map((branch) => branchCity(branch)).filter(Boolean);
    return Array.from(new Set([...DEFAULT_CITIES, ...masterState.customCities, ...branchCities])).filter(Boolean).sort();
}

function renderOptions(select, values, selected = '') {
    if (!select) return;
    select.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('');
}

function bindSettingsControls() {
    document.getElementById('areaList')?.addEventListener('change', (event) => {
        masterState.selectedArea = event.target.value || masterState.selectedArea;
        renderAreaSettings();
    });
    document.getElementById('addAreaBtn')?.addEventListener('click', addArea);
    document.getElementById('addCityBtn')?.addEventListener('click', () => assignCityToArea(clean(document.getElementById('newCityInput')?.value)));
    document.getElementById('assignCityBtn')?.addEventListener('click', () => assignCityToArea(document.getElementById('availableCityList')?.value));
    document.getElementById('unassignCityBtn')?.addEventListener('click', () => unassignCityFromArea(document.getElementById('assignedCityList')?.value));

    document.getElementById('techList')?.addEventListener('change', (event) => {
        masterState.selectedTechId = event.target.value || masterState.selectedTechId;
        renderTechSettings();
    });
    document.getElementById('addTechAreaBtn')?.addEventListener('click', addTechArea);
    document.getElementById('assignTechAreaBtn')?.addEventListener('click', () => assignAreaToTech(document.getElementById('techAvailableAreaList')?.value));
    document.getElementById('unassignTechAreaBtn')?.addEventListener('click', () => unassignAreaFromTech(document.getElementById('techAssignedAreaList')?.value));

    document.getElementById('clientSearchInput')?.addEventListener('input', renderClientResults);
}

async function ensureSettingsData() {
    if (masterState.settingsLoaded) return;
    setSettingsStatus('Loading setup data...');

    const [employeeRows, branchRows, companyRows, positionRows] = await Promise.all([
        fetchCollection('tbl_employee', {
            fieldMask: ['id', 'firstname', 'lastname', 'nickname', 'name', 'position_id'],
            maxPages: 40
        }).catch(() => []),
        fetchCollection('tbl_branchinfo', {
            fieldMask: ['id', 'company_id', 'branchname', 'branch_address', 'bldg', 'floor', 'street', 'brgy', 'city', 'email'],
            maxPages: 40
        }).catch(() => []),
        fetchCollection('tbl_companylist', {
            fieldMask: ['id', 'companyname'],
            maxPages: 30
        }).catch(() => []),
        fetchCollection('tbl_empos', {
            fieldMask: ['id', 'position', 'position_name', 'name'],
            maxPages: 10
        }).catch(() => [])
    ]);

    employeeRows.forEach((employee) => {
        if (employee.id) masterState.lookups.employees.set(String(employee.id), employee);
    });
    companyRows.forEach((company) => {
        if (company.id) masterState.lookups.companies.set(String(company.id), company);
    });
    branchRows.forEach((branch) => {
        if (branch.id) masterState.lookups.branches.set(String(branch.id), branch);
    });
    positionRows.forEach((position) => {
        if (position.id) masterState.lookups.positions.set(String(position.id), position);
    });

    masterState.settings.employees = employeeRows
        .filter((employee) => employee.id)
        .sort((a, b) => employeeName(a, a.id).localeCompare(employeeName(b, b.id)));
    masterState.settings.branches = branchRows
        .filter((branch) => branch.id)
        .sort((a, b) => {
            const ac = clean(masterState.lookups.companies.get(String(a.company_id))?.companyname);
            const bc = clean(masterState.lookups.companies.get(String(b.company_id))?.companyname);
            return `${ac} ${a.branchname || ''}`.localeCompare(`${bc} ${b.branchname || ''}`);
        });

    masterState.settingsLoaded = true;
    setSettingsStatus('Setup data loaded.');
}

async function switchMasterView(view) {
    document.querySelectorAll('[data-master-view]').forEach((button) => {
        button.classList.toggle('active', button.dataset.masterView === view);
    });
    document.getElementById('masterScheduleView')?.classList.toggle('hidden', view !== 'schedule');
    document.getElementById('masterSettingsView')?.classList.toggle('hidden', view !== 'settings');
    if (view === 'settings') {
        await ensureSettingsData();
        renderSettings();
    }
}

function switchSettingsTab(tab) {
    document.querySelectorAll('[data-settings-tab]').forEach((button) => {
        button.classList.toggle('active', button.dataset.settingsTab === tab);
    });
    document.getElementById('areaSettingsPanel')?.classList.toggle('hidden', tab !== 'area');
    document.getElementById('techSettingsPanel')?.classList.toggle('hidden', tab !== 'tech');
    document.getElementById('clientSettingsPanel')?.classList.toggle('hidden', tab !== 'client');
    renderSettings();
}

function renderSettingsIfVisible() {
    if (!document.getElementById('masterSettingsView')?.classList.contains('hidden')) renderSettings();
}

function renderSettings() {
    const active = document.querySelector('[data-settings-tab].active')?.dataset.settingsTab || 'area';
    if (active === 'area') renderAreaSettings();
    if (active === 'tech') renderTechSettings();
    if (active === 'client') renderClientSettings();
}

function renderAreaSettings() {
    const areas = allAreas();
    if (!areas.includes(masterState.selectedArea)) masterState.selectedArea = areas[0] || '';
    renderOptions(document.getElementById('areaList'), areas, masterState.selectedArea);

    const assigned = Array.from(masterState.areaCityRows.values())
        .filter((row) => clean(row.area) === masterState.selectedArea)
        .map((row) => clean(row.city))
        .filter(Boolean)
        .sort();
    const available = allCities().filter((city) => !assigned.includes(city));
    renderOptions(document.getElementById('assignedCityList'), assigned);
    renderOptions(document.getElementById('availableCityList'), available);
}

function renderTechSettings() {
    const techs = scheduleStaffOptions();
    if (!masterState.selectedTechId && techs[0]) masterState.selectedTechId = String(techs[0].id);
    const list = document.getElementById('techList');
    if (list) {
        list.innerHTML = techs.map((employee) => `
            <option value="${escapeHtml(employee.id)}"${String(employee.id) === masterState.selectedTechId ? ' selected' : ''}>
                ${escapeHtml(employeeName(employee, employee.id))} - ${escapeHtml(employeeRole(employee))}
            </option>
        `).join('');
    }

    const assigned = Array.from(masterState.techAreaRows.get(masterState.selectedTechId)?.keys() || []).sort();
    const available = allAreas().filter((area) => !assigned.includes(area));
    renderOptions(document.getElementById('techAssignedAreaList'), assigned);
    renderOptions(document.getElementById('techAvailableAreaList'), available);
}

function renderClientSettings() {
    renderClientResults();
    renderClientEditor();
}

function renderClientResults() {
    const results = document.getElementById('clientResults');
    if (!results) return;
    const search = normalizeSearch(document.getElementById('clientSearchInput')?.value || '');
    const rows = masterState.settings.branches
        .filter((branch) => {
            const company = masterState.lookups.companies.get(String(branch.company_id));
            const text = normalizeSearch(`${company?.companyname || ''} ${branch.branchname || ''}`);
            return !search || text.includes(search);
        })
        .slice(0, 80);

    results.innerHTML = rows.length ? rows.map((branch) => {
        const company = masterState.lookups.companies.get(String(branch.company_id));
        const selected = String(branch.id) === masterState.selectedBranchId;
        return `
            <button class="client-result${selected ? ' active' : ''}" type="button" onclick="selectClientBranch('${escapeHtml(branch.id)}')">
                <strong>${escapeHtml(company?.companyname || 'Unknown Company')}</strong>
                <span>${escapeHtml(branch.branchname || 'Main')}</span>
            </button>
        `;
    }).join('') : '<div class="master-empty">No branch found.</div>';
}

function renderClientEditor() {
    const editor = document.getElementById('clientAreaEditor');
    if (!editor) return;
    const branch = masterState.lookups.branches.get(String(masterState.selectedBranchId || ''));
    if (!branch) {
        editor.innerHTML = '<div class="master-empty">Select a company or branch to set service, billing, collection, and delivery area.</div>';
        return;
    }
    const company = masterState.lookups.companies.get(String(branch.company_id));
    const row = masterState.clientAreaRows.get(String(branch.id)) || {};
    const areas = allAreas();
    const cities = allCities();

    editor.innerHTML = `
        <div class="settings-row" style="margin:0 0 12px;">
            <input type="text" value="${escapeHtml(company?.companyname || '')}" readonly>
            <input type="text" value="${escapeHtml(branch.branchname || '')}" readonly>
            <button class="btn btn-primary btn-sm" type="button" onclick="saveClientArea()">Save</button>
        </div>
        <div class="client-form-grid">
            ${CLIENT_INFO_TYPES.map((type) => `
                <section class="client-info-card">
                    <h3>${escapeHtml(type.label)}</h3>
                    <div class="settings-field">
                        <label>Address</label>
                        <textarea id="${type.key}AddressInput" rows="3">${escapeHtml(row[`${type.key}_address`] || branch.branch_address || '')}</textarea>
                    </div>
                    <div class="settings-field">
                        <label>Con. Person</label>
                        <input id="${type.key}ContactInput" type="text" value="${escapeHtml(row[`${type.key}_contact_person`] || '')}">
                    </div>
                    <div class="settings-field">
                        <label>Con. Num.</label>
                        <input id="${type.key}NumberInput" type="text" value="${escapeHtml(row[`${type.key}_contact_number`] || '')}">
                    </div>
                    <div class="settings-field">
                        <label>Select Area</label>
                        <select id="${type.key}AreaInput">
                            ${areas.map((area) => `<option value="${escapeHtml(area)}"${area === (row[`${type.key}_area`] || 'South 1') ? ' selected' : ''}>${escapeHtml(area)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="settings-field">
                        <label>City</label>
                        <select id="${type.key}CityInput">
                            ${cities.map((city) => `<option value="${escapeHtml(city)}"${city === (row[`${type.key}_city`] || branchCity(branch) || 'Laguna') ? ' selected' : ''}>${escapeHtml(city)}</option>`).join('')}
                        </select>
                    </div>
                </section>
            `).join('')}
        </div>
    `;
}

function setSettingsStatus(message) {
    const node = document.getElementById('settingsStatus');
    if (node) node.textContent = message;
}

async function addArea() {
    const area = clean(document.getElementById('newAreaInput')?.value);
    if (!area) return;
    masterState.customAreas.add(area);
    masterState.selectedArea = area;
    document.getElementById('newAreaInput').value = '';
    renderAreaSettings();
    renderTechSettings();
    setSettingsStatus(`Added area ${area}. Assign cities or technicians to save mappings.`);
}

async function assignCityToArea(city) {
    city = clean(city);
    if (!city || !masterState.selectedArea) return;
    const row = { area: masterState.selectedArea, city, updated_at: new Date().toISOString() };
    const docId = `${slug(masterState.selectedArea)}_${slug(city)}`;
    await setDoc('marga_master_schedule_area_cities', docId, row);
    masterState.areaCityRows.set(slug(city), { ...row, _docId: docId });
    masterState.customAreas.add(masterState.selectedArea);
    masterState.customCities.add(city);
    document.getElementById('newCityInput').value = '';
    renderAreaSettings();
    setSettingsStatus(`Assigned ${city} to ${masterState.selectedArea}.`);
}

async function unassignCityFromArea(city) {
    city = clean(city);
    const row = masterState.areaCityRows.get(slug(city));
    if (!row) return;
    await deleteDoc('marga_master_schedule_area_cities', row._docId || `${slug(row.area)}_${slug(city)}`);
    masterState.areaCityRows.delete(slug(city));
    renderAreaSettings();
    setSettingsStatus(`Unassigned ${city}.`);
}

async function addTechArea() {
    const area = clean(document.getElementById('newTechAreaInput')?.value);
    if (!area) return;
    masterState.customAreas.add(area);
    document.getElementById('newTechAreaInput').value = '';
    await assignAreaToTech(area);
}

async function assignAreaToTech(area) {
    area = clean(area);
    if (!area || !masterState.selectedTechId) return;
    const employee = masterState.lookups.employees.get(masterState.selectedTechId);
    const row = {
        tech_id: masterState.selectedTechId,
        tech_name: employeeName(employee, masterState.selectedTechId),
        area,
        updated_at: new Date().toISOString()
    };
    const docId = `${slug(masterState.selectedTechId)}_${slug(area)}`;
    await setDoc('marga_master_schedule_tech_areas', docId, row);
    if (!masterState.techAreaRows.has(masterState.selectedTechId)) masterState.techAreaRows.set(masterState.selectedTechId, new Map());
    masterState.techAreaRows.get(masterState.selectedTechId).set(area, { ...row, _docId: docId });
    masterState.customAreas.add(area);
    renderTechSettings();
    setSettingsStatus(`Assigned ${area} to ${row.tech_name}.`);
}

async function unassignAreaFromTech(area) {
    area = clean(area);
    const row = masterState.techAreaRows.get(masterState.selectedTechId)?.get(area);
    if (!row) return;
    await deleteDoc('marga_master_schedule_tech_areas', row._docId || `${slug(masterState.selectedTechId)}_${slug(area)}`);
    masterState.techAreaRows.get(masterState.selectedTechId).delete(area);
    renderTechSettings();
    setSettingsStatus(`Unassigned ${area}.`);
}

function selectClientBranch(branchId) {
    masterState.selectedBranchId = String(branchId || '');
    renderClientSettings();
}

async function saveClientArea() {
    const branch = masterState.lookups.branches.get(String(masterState.selectedBranchId || ''));
    if (!branch) return;
    const company = masterState.lookups.companies.get(String(branch.company_id));
    const row = {
        branch_id: String(branch.id),
        company_id: String(branch.company_id || ''),
        company_name: clean(company?.companyname),
        branch_name: clean(branch.branchname),
        updated_at: new Date().toISOString()
    };

    CLIENT_INFO_TYPES.forEach((type) => {
        row[`${type.key}_address`] = clean(document.getElementById(`${type.key}AddressInput`)?.value);
        row[`${type.key}_contact_person`] = clean(document.getElementById(`${type.key}ContactInput`)?.value);
        row[`${type.key}_contact_number`] = clean(document.getElementById(`${type.key}NumberInput`)?.value);
        row[`${type.key}_area`] = clean(document.getElementById(`${type.key}AreaInput`)?.value);
        row[`${type.key}_city`] = clean(document.getElementById(`${type.key}CityInput`)?.value);
    });

    const docId = `branch_${branch.id}`;
    await setDoc('marga_master_schedule_client_areas', docId, row);
    masterState.clientAreaRows.set(String(branch.id), { ...row, _docId: docId });
    CLIENT_INFO_TYPES.forEach((type) => {
        if (row[`${type.key}_area`]) masterState.customAreas.add(row[`${type.key}_area`]);
        if (row[`${type.key}_city`]) masterState.customCities.add(row[`${type.key}_city`]);
    });
    renderClientSettings();
    setSettingsStatus(`Saved area setup for ${row.company_name || row.branch_name}.`);
}

window.selectClientBranch = selectClientBranch;
window.saveClientArea = saveClientArea;
window.reassignScheduleFromSelect = reassignScheduleFromSelect;
