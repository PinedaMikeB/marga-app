const MASTER_API_KEY = FIREBASE_CONFIG.apiKey;
const MASTER_BASE_URL = FIREBASE_CONFIG.baseUrl;
const MASTER_LIMIT = 1200;

const MASTER_PURPOSE_LABELS = {
    1: 'Printed Billing',
    2: 'Confirmed Collection',
    3: 'Deliver Toner',
    4: 'Deliver Ink',
    5: 'Service / Preventive Maintenance',
    8: 'Printed Billing',
    9: 'Others'
};

const masterState = {
    rows: [],
    lookups: {
        branches: new Map(),
        companies: new Map(),
        machines: new Map(),
        contracts: new Map(),
        contractDeps: new Map(),
        employees: new Map(),
        troubles: new Map(),
        areas: new Map()
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('masterDateInput');
    dateInput.value = formatDateYmd(new Date());
    dateInput.addEventListener('change', loadMasterSchedule);

    document.getElementById('masterStatusInput')?.addEventListener('change', renderMasterSchedule);
    document.getElementById('masterSearchInput')?.addEventListener('input', renderMasterSchedule);
    document.getElementById('masterRefreshBtn')?.addEventListener('click', loadMasterSchedule);

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
    const parsed = {
        _docId: String(doc?.name || '').split('/').pop() || ''
    };
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
    return Array.isArray(payload)
        ? payload.map((entry) => entry.document).filter(Boolean)
        : [];
}

async function queryDateRange(collection, fieldPath, start, end) {
    return runStructuredQuery({
        from: [{ collectionId: collection }],
        where: {
            compositeFilter: {
                op: 'AND',
                filters: [
                    {
                        fieldFilter: {
                            field: { fieldPath },
                            op: 'GREATER_THAN_OR_EQUAL',
                            value: firestoreValue(start)
                        }
                    },
                    {
                        fieldFilter: {
                            field: { fieldPath },
                            op: 'LESS_THAN_OR_EQUAL',
                            value: firestoreValue(end)
                        }
                    }
                ]
            }
        },
        limit: MASTER_LIMIT
    });
}

async function queryEquals(collection, fieldPath, value) {
    return runStructuredQuery({
        from: [{ collectionId: collection }],
        where: {
            fieldFilter: {
                field: { fieldPath },
                op: 'EQUAL',
                value: firestoreValue(value)
            }
        },
        limit: MASTER_LIMIT
    });
}

async function fetchDoc(collection, docId) {
    if (!docId && docId !== 0) return null;
    const response = await fetch(`${MASTER_BASE_URL}/${collection}/${encodeURIComponent(String(docId))}?key=${encodeURIComponent(MASTER_API_KEY)}`);
    if (response.status === 404) return null;
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to load ${collection}/${docId}`);
    }
    return parseFirestoreDoc(payload);
}

async function fetchMany(collection, ids, cache) {
    const unique = Array.from(new Set(
        ids
            .map((id) => String(id || '').trim())
            .filter((id) => id && id !== '0' && !cache.has(id))
    ));

    await Promise.all(unique.map(async (id) => {
        const doc = await fetchDoc(collection, id).catch(() => null);
        if (doc) cache.set(id, doc);
    }));
}

async function patchDoc(collection, docId, row) {
    const fields = {};
    Object.entries(row).forEach(([key, value]) => {
        if (!key.startsWith('_') && key !== 'searchText') fields[key] = firestoreValue(value);
    });

    const response = await fetch(`${MASTER_BASE_URL}/${collection}/${encodeURIComponent(String(docId))}?key=${encodeURIComponent(MASTER_API_KEY)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || 'Schedule update failed.');
    }
    return payload;
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

function employeeName(employee, fallbackId = '') {
    if (!employee) return fallbackId ? `ID ${fallbackId}` : 'Unassigned';
    const nickname = String(employee.nickname || '').trim();
    const first = String(employee.firstname || '').trim();
    const last = String(employee.lastname || '').trim();
    return nickname || `${first} ${last}`.trim() || String(employee.name || '').trim() || `ID ${fallbackId}`;
}

function normalizeSearch(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function scheduleDateText(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.slice(0, 10);
}

function purposeFromLegacy(row, trouble) {
    const purposeId = Number(row.purpose_id || 0);
    const explicit = MASTER_PURPOSE_LABELS[purposeId] || '';
    const clue = `${explicit} ${trouble?.trouble || ''} ${row.remarks || ''}`.toLowerCase();
    if (clue.includes('toner')) return 'Deliver Toner';
    if (clue.includes('ink') || clue.includes('cartridge')) return 'Deliver Ink';
    if (clue.includes('preventive') || clue.includes('service') || clue.includes('pm')) return 'Service / Preventive Maintenance';
    return explicit || `Purpose ${purposeId || '-'}`;
}

function areaGroupFromBranch(branch, fallback = '') {
    const areaId = String(branch?.area_id || '').trim();
    const area = masterState.lookups.areas.get(areaId);
    const areaName = String(area?.area || area?.areaname || area?.name || area?.description || '').trim();
    if (areaId && areaName) return `Area Group ${areaId} (${areaName})`;
    if (areaName) return `Area Group 1 (${areaName})`;

    const city = String(branch?.city || branch?.address_city || '').trim();
    if (city) return `Area Group ${areaId || 1} (${city})`;
    return fallback || 'Area Group 1 (Unassigned)';
}

function machineModel(machine, row = {}) {
    return String(row.model || row.model_name || machine?.model || machine?.model_id || machine?.description || '').trim();
}

function machineSerial(machine, row = {}) {
    return String(row.serial_number || row.field_serial_selected || machine?.serial || row.serial || '').trim();
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
    const customer = String(company?.companyname || row.company_name || row.client || branch?.companyname || '').trim() || 'Unknown Customer';
    const branchName = String(contractDep?.departmentname || branch?.branchname || row.branch_name || '').trim() || 'Main';
    const model = machineModel(machine, { ...row, model: contract?.model || contract?.model_id });
    const serial = machineSerial(machine, row);
    const assignedTo = employeeName(employee, row.tech_id);

    return {
        source: 'legacy',
        docId: row._docId || row.id || '',
        purpose,
        customer,
        branch: branchName,
        model,
        serial,
        assignedTo,
        status: 'Active',
        areaGroup: areaGroupFromBranch(branch),
        searchText: [purpose, customer, branchName, model, serial, assignedTo, row.invoice_num, trouble?.trouble].join(' ')
    };
}

function buildWebScheduleRow(row) {
    const status = String(row.status || 'Active').trim() || 'Active';
    const purpose = String(row.purpose || row.schedule_status || 'Collection').trim();
    const customer = String(row.customer || row.company_name || '').trim() || 'Unknown Customer';
    const branch = String(row.branch || row.branch_name || '').trim() || 'Main';
    const model = String(row.model || row.model_name || '').trim();
    const serial = String(row.serial || row.serial_number || '').trim();
    const assignedTo = String(row.assigned_to || row.collector || '').trim() || 'Collector';

    return {
        source: 'web',
        docId: row._docId,
        original: row,
        purpose,
        customer,
        branch,
        model,
        serial,
        assignedTo,
        status,
        areaGroup: row.area_group || 'Area Group 1 (Unassigned)',
        searchText: [purpose, customer, branch, model, serial, assignedTo, status, row.schedule_status].join(' ')
    };
}

function buildPlannerScheduleRow(row) {
    const serials = parseJsonArray(row.serial_numbers_json || row.serial_numbers).filter(Boolean);
    const branchNames = parseJsonArray(row.branch_names_json || row.branch_names).filter(Boolean);
    const staff = String(row.assigned_staff_name || row.suggested_staff_name || row.suggested_messenger_name || '').trim();
    const purpose = row.department === 'collection' ? 'Confirmed Collection' : 'Printed Billing';
    const customer = row.company_name || row.account_name || 'Unknown Customer';
    const branch = row.primary_branch_name || branchNames[0] || 'Main';

    return {
        source: 'planner',
        docId: row._docId || row.id || '',
        purpose,
        customer,
        branch,
        model: row.model || '',
        serial: serials[0] || row.serial || '',
        assignedTo: staff || 'Suggested / Unassigned',
        status: row.planner_status || row.task_status || 'Suggested',
        areaGroup: row.area_group || 'Area Group 1 (Unassigned)',
        searchText: [purpose, customer, branch, row.model, serials.join(' '), staff].join(' ')
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

async function loadMasterSchedule() {
    const date = document.getElementById('masterDateInput')?.value || formatDateYmd(new Date());
    const sheet = document.getElementById('masterScheduleSheet');
    const count = document.getElementById('masterCount');
    if (sheet) sheet.innerHTML = '<div class="master-empty">Loading Master Schedule...</div>';
    if (count) count.textContent = 'Loading schedules...';

    try {
        const start = `${date} 00:00:00`;
        const end = `${date} 23:59:59`;
        const [legacyDocs, plannerDocs, webDocs] = await Promise.all([
            queryDateRange('tbl_schedule', 'task_datetime', start, end).catch((error) => {
                console.warn('Legacy schedule query failed.', error);
                return [];
            }),
            queryEquals('tbl_schedule_planner', 'schedule_date', date).catch((error) => {
                console.warn('Schedule planner query failed.', error);
                return [];
            }),
            queryEquals('marga_master_schedule', 'schedule_date', date).catch((error) => {
                console.warn('Web master schedule query failed.', error);
                return [];
            })
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
            if (a.areaGroup !== b.areaGroup) return a.areaGroup.localeCompare(b.areaGroup);
            if (a.purpose !== b.purpose) return a.purpose.localeCompare(b.purpose);
            return a.customer.localeCompare(b.customer);
        });

        renderMasterSchedule();
    } catch (error) {
        console.error('Master Schedule load failed:', error);
        if (count) count.textContent = 'Unable to load';
        if (sheet) sheet.innerHTML = `<div class="master-empty">Master Schedule failed to load: ${escapeHtml(error.message || error)}</div>`;
    }
}

function getVisibleRows() {
    const statusFilter = String(document.getElementById('masterStatusInput')?.value || 'active').toLowerCase();
    const search = normalizeSearch(document.getElementById('masterSearchInput')?.value || '');

    return masterState.rows.filter((row) => {
        const isCancelled = String(row.status || '').toLowerCase() === 'cancelled';
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
    if (!sheet) return;

    if (!rows.length) {
        sheet.innerHTML = '<div class="master-empty">No schedules found for this date/filter.</div>';
        return;
    }

    const groups = new Map();
    rows.forEach((row) => {
        const key = row.areaGroup || 'Area Group 1 (Unassigned)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });

    sheet.innerHTML = Array.from(groups.entries()).map(([group, groupRows]) => `
        <section class="master-group">
            <h2>${escapeHtml(group)}</h2>
            <table class="master-table">
                <thead>
                    <tr>
                        <th>Purpose</th>
                        <th>Customer Name</th>
                        <th>Branch</th>
                        <th>Model</th>
                        <th>Serial</th>
                        <th>Assigned To</th>
                        <th>Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${groupRows.map(renderMasterScheduleRow).join('')}
                </tbody>
            </table>
        </section>
    `).join('');
}

function renderMasterScheduleRow(row) {
    const cancelled = String(row.status || '').toLowerCase() === 'cancelled';
    const action = row.source === 'web' && !cancelled
        ? `<button class="btn btn-secondary btn-sm" type="button" onclick="cancelMasterSchedule('${escapeHtml(row.docId)}')">Cancel Trial Schedule</button>`
        : '<span class="master-status">Read only</span>';

    return `
        <tr>
            <td>${escapeHtml(row.purpose || '-')}</td>
            <td>${escapeHtml(row.customer || '-')}</td>
            <td>${escapeHtml(row.branch || '-')}</td>
            <td class="numeric">${escapeHtml(row.model || '-')}</td>
            <td class="numeric">${escapeHtml(row.serial || '-')}</td>
            <td>${escapeHtml(row.assignedTo || '-')}</td>
            <td><span class="schedule-pill ${cancelled ? 'cancelled' : ''}">${escapeHtml(row.status || 'Active')}</span></td>
            <td class="action-cell">${action}</td>
        </tr>
    `;
}

async function cancelMasterSchedule(docId) {
    const row = masterState.rows.find((item) => item.source === 'web' && item.docId === docId);
    if (!row) return;

    const count = document.getElementById('masterCount');
    if (count) count.textContent = 'Cancelling schedule...';

    try {
        const updated = {
            ...row.original,
            status: 'Cancelled',
            cancelled_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        await patchDoc('marga_master_schedule', docId, updated);
        row.original = updated;
        row.status = 'Cancelled';
        renderMasterSchedule();
    } catch (error) {
        console.error('Cancel schedule failed:', error);
        if (count) count.textContent = `Cancel failed: ${error.message || error}`;
    }
}

window.cancelMasterSchedule = cancelMasterSchedule;
