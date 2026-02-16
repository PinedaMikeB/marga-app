if (!MargaAuth.requireAccess('service')) {
    throw new Error('Unauthorized access to service module.');
}

const OPS_MAX_TASK_ROWS = 300;
const OPS_QUERY_LIMIT = 5000;
const OPS_CARRYOVER_DAYS = 14;
const ZERO_DATETIME = '0000-00-00 00:00:00';
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
const LOOKUP_COLLECTION_LIMITS = {
    tbl_employee: 2000,
    tbl_empos: 400,
    tbl_trouble: 2200,
    tbl_branchinfo: 7000,
    tbl_branchcontact: 9000,
    tbl_companylist: 3000,
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
    includeCarryover: true
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    if (user) {
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userRole').textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
        document.getElementById('userAvatar').textContent = user.name.charAt(0).toUpperCase();
    }

    const purposeFilter = document.getElementById('opsPurposeFilter');
    const statusFilter = document.getElementById('opsStatusFilter');
    const carryoverToggle = document.getElementById('opsCarryoverToggle');
    const carryoverBtn = document.getElementById('opsCarryoverBtn');
    const defaultPurpose = getDefaultPurposeFilter(user?.role || 'viewer');
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

    carryoverToggle.addEventListener('change', () => {
        opsState.includeCarryover = carryoverToggle.checked;
        loadOperationsBoard();
    });

    document.getElementById('opsRefreshBtn').addEventListener('click', () => loadOperationsBoard());
    document.getElementById('opsPanelCloseBtn').addEventListener('click', closeOpsStaffPanel);
    document.getElementById('opsPanelOverlay').addEventListener('click', closeOpsStaffPanel);
    document.getElementById('opsPanelPrintAllBtn').addEventListener('click', () => {
        if (!opsState.panelStaffId) return;
        printStaffScheduleRows(opsState.panelStaffId);
    });
    carryoverBtn.addEventListener('click', () => batchCarryoverPending());

    const newReqBtn = document.getElementById('opsNewRequestBtn');
    const canCreate = MargaAuth.isAdmin() || user?.role === 'service';
    newReqBtn.style.display = canCreate ? 'inline-flex' : 'none';
    newReqBtn.addEventListener('click', () => openNewRequestModal());

    document.getElementById('newReqCloseBtn').addEventListener('click', closeNewRequestModal);
    document.getElementById('newReqCancelBtn').addEventListener('click', closeNewRequestModal);
    document.getElementById('newReqOverlay').addEventListener('click', closeNewRequestModal);
    document.getElementById('newReqSaveBtn').addEventListener('click', () => saveNewServiceRequest());

    const dispatchNote = document.getElementById('dispatchHeaderNote');
    dispatchNote.textContent = getRoleDispatchNote(user?.role || 'viewer');

    opsState.purposeFilter = purposeFilter.value;
    opsState.statusFilter = statusFilter.value;
    opsState.includeCarryover = carryoverToggle.checked;
    loadOperationsBoard();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

function getDefaultPurposeFilter(role) {
    if (role === 'billing') return '1';
    if (role === 'collection') return '2';
    return 'all';
}

function getRoleDispatchNote(role) {
    if (role === 'billing') {
        return 'Billing view: default filter is Billing. You can switch to other task types as needed.';
    }
    if (role === 'collection') {
        return 'Collection view: default filter is Collection. You can switch to other task types as needed.';
    }
    if (role === 'service') {
        return 'Service view: monitor technicians, messengers, and dispatch queue for today.';
    }
    return 'Unified daily schedules for service, collection, billing, delivery, and reading tasks.';
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
    return 'Staff';
}

function getRoleClass(role) {
    if (role === 'Technician') return 'role-tech';
    if (role === 'Messenger') return 'role-messenger';
    return 'role-unknown';
}

function getOpsStatusKey(row, selectedDate) {
    const scheduleId = Number(row.id || 0);
    if (scheduleId > 0 && opsCache.closedScheduleIds.has(scheduleId)) return 'closed';
    if (Number(row.iscancel || 0) === 1) return 'cancelled';

    const finished = String(row.date_finished || '').trim();
    if (finished && finished !== ZERO_DATETIME) return 'closed';

    if (Number(row.isongoing || 0) === 1) return 'ongoing';

    const taskDate = String(row.task_datetime || '').slice(0, 10);
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

function formatTaskDateTime(value) {
    if (!value) return '-';
    const normalized = String(value).replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return value;
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

    const todayCount = rows.filter((row) => String(row.task_datetime || '').startsWith(selectedDate)).length;
    const carryCount = counts.carryover || 0;

    grid.innerHTML = `
        <div class="ops-kpi-card">
            <div class="ops-kpi-label">Scheduled Today</div>
            <div class="ops-kpi-value">${todayCount}</div>
        </div>
        <div class="ops-kpi-card" data-filter="carryover">
            <div class="ops-kpi-label">Carryover</div>
            <div class="ops-kpi-value">${carryCount}</div>
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
        const staffId = Number(row.tech_id || 0);
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
        .filter((row) => Number(row.tech_id || 0) === Number(staffId))
        .sort((a, b) => {
            const left = String(a.task_datetime || '');
            const right = String(b.task_datetime || '');
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

    const employee = opsCache.employees.get(String(row.tech_id || 0)) || null;
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
        .filter((staff) => staff.role === 'Technician' || staff.role === 'Messenger')
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
    setNewReqOpen(false);
}

function clearNewRequestPrefill() {
    document.getElementById('newReqCaller').value = '';
    document.getElementById('newReqPhone').value = '';
}

async function openNewRequestModal() {
    const user = MargaAuth.getUser();
    const canCreate = MargaAuth.isAdmin() || user?.role === 'service';
    if (!canCreate) {
        alert('New request is available for Admin / Service roles only.');
        return;
    }

    setNewReqOpen(true);

    document.getElementById('newReqDate').value = opsState.selectedDate || formatDateYmd(new Date());
    clearNewRequestPrefill();

    // Load lookup collections needed for the form. (Uses DESC scans, no composite indexes.)
    await Promise.all([
        ensureCollectionLoaded('tbl_companylist', opsCache.companies),
        ensureCollectionLoaded('tbl_branchinfo', opsCache.branches),
        ensureCollectionLoaded('tbl_area', opsCache.areas),
        ensureCollectionLoaded('tbl_trouble', opsCache.troubles),
        ensureBranchContactsLoaded(),
        ensureAssignableEmployeesLoaded()
    ]);

    const companySearch = document.getElementById('newReqCompanySearch');
    const companySelect = document.getElementById('newReqCompany');
    const branchSearch = document.getElementById('newReqBranchSearch');
    const branchSelect = document.getElementById('newReqBranch');
    const troubleSelect = document.getElementById('newReqTrouble');
    const assigneeSelect = document.getElementById('newReqAssignee');
    const callerInput = document.getElementById('newReqCaller');
    const phoneInput = document.getElementById('newReqPhone');

    companySearch.value = '';
    branchSearch.value = '';

    const companies = [...opsCache.companies.values()]
        .filter(Boolean)
        .map((c) => ({ id: Number(c.id || 0), name: String(c.companyname || '').trim() }))
        .filter((c) => c.id > 0 && c.name)
        .sort((a, b) => a.name.localeCompare(b.name));

    function renderCompanyOptions(query) {
        const q = String(query || '').trim().toLowerCase();
        const filtered = q
            ? companies.filter((c) => c.name.toLowerCase().includes(q) || String(c.id).includes(q))
            : companies;

        companySelect.innerHTML = `<option value="">Select company...</option>` + filtered
            .slice(0, 2500)
            .map((c) => `<option value="${c.id}">${sanitize(c.name)}</option>`)
            .join('');
    }

    renderCompanyOptions('');
    companySearch.oninput = () => renderCompanyOptions(companySearch.value);

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

    function fillBranchesForCompany(companyId, query = '') {
        const branches = [...opsCache.branches.values()]
            .filter(Boolean)
            .filter((b) => Number(b.company_id || 0) === Number(companyId))
            .map((b) => ({ id: Number(b.id || 0), name: String(b.branchname || '').trim(), area_id: Number(b.area_id || 0) }))
            .filter((b) => b.id > 0)
            .sort((a, b) => a.name.localeCompare(b.name));

        const q = String(query || '').trim().toLowerCase();
        const filtered = q
            ? branches.filter((b) => b.name.toLowerCase().includes(q) || String(b.id).includes(q))
            : branches;

        branchSelect.innerHTML = `<option value="">Select branch...</option>` + filtered
            .slice(0, 2500)
            .map((b) => `<option value="${b.id}">${sanitize(b.name || `Branch #${b.id}`)}</option>`)
            .join('');
    }

    companySelect.onchange = () => {
        branchSearch.value = '';
        fillBranchesForCompany(companySelect.value, '');
        branchSelect.value = '';
    };

    branchSearch.oninput = () => fillBranchesForCompany(companySelect.value, branchSearch.value);

    branchSelect.onchange = () => {
        const branchId = Number(branchSelect.value || 0);
        if (!branchId) return;

        const branch = opsCache.branches.get(String(branchId)) || null;
        const contacts = opsCache.branchContactsByBranch.get(branchId) || [];
        const best = contacts.find((c) => (c.contact_person || '').trim() || (c.contact_number || '').trim()) || null;

        if (!callerInput.value.trim()) {
            callerInput.value = String(best?.contact_person || branch?.signatory || '').trim();
        }

        if (!phoneInput.value.trim()) {
            phoneInput.value = String(best?.contact_number || '').trim();
        }
    };

    branchSelect.innerHTML = `<option value="">Select branch...</option>`;
}

async function saveNewServiceRequest() {
    const user = MargaAuth.getUser();
    const canCreate = MargaAuth.isAdmin() || user?.role === 'service';
    if (!canCreate) {
        alert('New request is available for Admin / Service roles only.');
        return;
    }

    const origin = document.getElementById('newReqOrigin').value || 'other';
    const purposeId = Number(document.getElementById('newReqPurpose').value || 5);
    const date = document.getElementById('newReqDate').value;
    const time = document.getElementById('newReqTime').value || '08:00';
    const companyId = Number(document.getElementById('newReqCompany').value || 0);
    const branchId = Number(document.getElementById('newReqBranch').value || 0);
    const caller = (document.getElementById('newReqCaller').value || '').trim();
    const phone = (document.getElementById('newReqPhone').value || '').trim();
    const troubleId = Number(document.getElementById('newReqTrouble').value || 0);
    const assigneeId = Number(document.getElementById('newReqAssignee').value || 0);
    const remarks = (document.getElementById('newReqRemarks').value || '').trim();

    if (!date) {
        alert('Please choose a schedule date.');
        return;
    }
    if (!companyId) {
        alert('Please select a company.');
        return;
    }
    if (!branchId) {
        alert('Please select a branch.');
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

    const base = {
        id: nextId,
        company_id: companyId,
        branch_id: branchId,
        area_id: areaId,
        serial: 0,
        caller: caller || '-',
        phone_number: phone || '',
        purpose_id: purposeId,
        task_datetime: taskDatetime,
        original_sched: taskDatetime,
        tech_id: assigneeId || 0,
        trouble_id: troubleId,
        remarks: remarks || '',
        status: 1,
        isongoing: 0,
        date_finished: ZERO_DATETIME,
        iscancel: 0,
        scheduled: 1,
        // App-specific tracking (safe in Firestore, doesn't break legacy)
        request_origin: origin,
        from_mobileapp: 1
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
        withcomplain: 0,
        amt_collected: 0,
        withrequest: 0,
        from_other_source: 0,
        invoice_count: 0,
        commitment_date: ZERO_DATETIME,
        shutdown_date: ZERO_DATETIME,
        committed_by: '',
        oldest_invoice_age: 0,
        soa_status: 0,
        willsettle: 0,
        contractmain_id: 0,
        firebase_key: '',
        iscancelleddate: '',
        super_urgent: 0,
        csr_status: 0,
        csr_remarks: '',
        meter_reading: 0,
        tl_status: 0,
        tl_remarks: '',
        customer_request: '',
        collocutor: '',
        dev_remarks: ''
    };

    const saveBtn = document.getElementById('newReqSaveBtn');
    saveBtn.disabled = true;
    try {
        await setDocument('tbl_schedule', nextId, fullDoc);
        closeNewRequestModal();
        await loadOperationsBoard();
        alert(`Service request saved as schedule #${nextId}.`);
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
    const todayCount = rows.filter((row) => String(row.task_datetime || '').slice(0, 10) === selectedDate).length;
    const carryCount = rows.filter((row) => {
        const taskDate = String(row.task_datetime || '').slice(0, 10);
        return taskDate && selectedDate && taskDate < selectedDate;
    }).length;

    panelTitle.textContent = `${assigneeName} - ${role}`;
    if (opsState.includeCarryover && carryCount > 0 && selectedDate) {
        panelSubtitle.textContent = `${rows.length} schedule(s): ${todayCount} on ${selectedDate}, ${carryCount} carryover`;
    } else {
        panelSubtitle.textContent = `${rows.length} schedule(s) on ${selectedDate || 'selected date'}`;
    }
    panelMeta.textContent = MargaAuth.isAdmin()
        ? 'Admin mode: Edit, Transfer, and Delete actions are enabled.'
        : 'View mode only.';

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

        const actions = [
            `<button type="button" class="btn btn-secondary btn-sm ops-row-action" data-action="edit" data-schedule-id="${row.id}">Edit</button>`,
            `<button type="button" class="btn btn-secondary btn-sm ops-row-action" data-action="transfer" data-schedule-id="${row.id}">Transfer</button>`
        ];

        if (MargaAuth.isAdmin()) {
            actions.push(
                `<button type="button" class="btn btn-danger btn-sm ops-row-action" data-action="delete" data-schedule-id="${row.id}">Delete</button>`
            );
        }

        return `
            <tr>
                <td data-label="Time">${sanitize(formatTaskDateTime(row.task_datetime))}</td>
                <td data-label="Task">
                    <div>#${sanitize(row.id)} - ${sanitize(purposeLabel)} / ${sanitize(troubleLabel)} <span class="ops-status-pill ${sanitize(statusMeta.className)}">${sanitize(statusMeta.label)}</span></div>
                    <div class="ops-subtext">${sanitize(row.remarks || row.caller || '-')}</div>
                </td>
                <td data-label="Client / Branch">
                    <div>${sanitize(clientName)}</div>
                    <div class="ops-subtext">${sanitize(branchName)}</div>
                </td>
                <td data-label="Action"><div class="ops-row-actions">${actions.join('')}</div></td>
            </tr>
        `;
    }).join('');

    panelBody.querySelectorAll('.ops-row-action').forEach((button) => {
        button.addEventListener('click', async () => {
            const scheduleId = Number(button.dataset.scheduleId || 0);
            const action = button.dataset.action;
            const row = getScheduleById(scheduleId);
            if (!row) return;

            button.disabled = true;
            try {
                if (action === 'edit') {
                    await editScheduleRow(row);
                } else if (action === 'transfer') {
                    await transferScheduleRow(row);
                } else if (action === 'delete') {
                    await deleteScheduleRow(row);
                }
            } finally {
                button.disabled = false;
            }
        });
    });
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
        remarks: nextRemarks.trim()
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

    await patchDocument('tbl_schedule', row.id, { tech_id: nextStaffId });

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
                <td>${sanitize(formatTaskDateTime(row.task_datetime))}</td>
                <td>#${sanitize(row.id)}</td>
                <td>${sanitize(clientName)}<div class="sub">${sanitize(branchName)}</div></td>
                <td>${sanitize(areaName)}</td>
                <td>${sanitize(purposeLabel)} / ${sanitize(troubleLabel)}</td>
                <td>${sanitize(notes)}</td>
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
        const employee = employeeMap.get(String(row.tech_id || 0)) || null;
        const position = employee ? positionMap.get(String(employee.position_id || 0)) : null;
        const role = getRole(employee, position);
        const assignee = getEmployeeName(employee, row.tech_id || 0);
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
                <td data-label="Time">${sanitize(formatTaskDateTime(row.task_datetime))}</td>
                <td data-label="Task ID">#${sanitize(row.id)}</td>
                <td data-label="Client / Branch">
                    <div>${sanitize(clientName)}</div>
                    <div class="ops-subtext">${sanitize(branchName)}</div>
                </td>
                <td data-label="Area">${sanitize(areaName)}</td>
                <td data-label="Task">
                    <div>${sanitize(taskText)}</div>
                    <div class="ops-subtext">${sanitize(row.remarks || row.caller || '-')}</div>
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

function renderOperationsBoard() {
    const selectedDate = opsState.selectedDate || formatDateYmd(new Date());
    const purposeFilter = opsState.purposeFilter || 'all';
    const statusFilter = opsState.statusFilter || 'all';

    const byPurpose = filterRowsByPurpose(opsState.allRows, purposeFilter);
    const filtered = filterRowsByStatus(byPurpose, selectedDate, statusFilter);
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

    renderOpsStatusKpis(byPurpose, selectedDate);
    renderOpsStaffTable(filtered, logsByStaff, opsCache.employees, opsCache.positions);
    renderOpsTaskTable(filtered.slice(0, OPS_MAX_TASK_ROWS), logsBySchedule, {
        employeeMap: opsCache.employees,
        positionMap: opsCache.positions,
        troubleMap: opsCache.troubles,
        branchMap: opsCache.branches,
        companyMap: opsCache.companies,
        areaMap: opsCache.areas
    });

    const assigneeCount = [...new Set(filtered.map((row) => Number(row.tech_id || 0)).filter((id) => id > 0))].length;
    const withLogsCount = [...selectedScheduleIds].filter((id) => logsBySchedule.has(id)).length;
    const unmappedCount = [...new Set(filtered.map((row) => Number(row.tech_id || 0)).filter((id) => id > 0))]
        .filter((id) => !opsCache.employees.get(String(id))).length;

    const meta = document.getElementById('opsMeta');
    meta.textContent = `Showing ${filtered.length} task(s) after filters. Assigned staff: ${assigneeCount}. With time logs: ${withLogsCount}. Unmapped staff IDs: ${unmappedCount}.`;

    const carryoverBtn = document.getElementById('opsCarryoverBtn');
    const canCarry = MargaAuth.isAdmin() || (MargaAuth.getUser()?.role === 'service');
    const pendingToday = byPurpose
        .filter((row) => String(row.task_datetime || '').startsWith(selectedDate))
        .filter((row) => ['pending', 'ongoing'].includes(getOpsStatusKey(row, selectedDate))).length;
    carryoverBtn.style.display = canCarry && pendingToday > 0 ? 'inline-flex' : 'none';

    if (document.getElementById('opsStaffPanel').classList.contains('open') && opsState.panelStaffId) {
        renderOpsStaffPanel(opsState.panelStaffId);
    }
}

async function loadOperationsBoard() {
    const selectedDate = document.getElementById('opsDateInput').value || formatDateYmd(new Date());
    const purposeFilter = document.getElementById('opsPurposeFilter').value || 'all';
    const subtitle = document.getElementById('opsSubtitle');
    const meta = document.getElementById('opsMeta');
    const panelVisible = document.getElementById('opsStaffPanel').classList.contains('open');
    const includeCarryover = document.getElementById('opsCarryoverToggle').checked;

    const purposeLabel = purposeFilter === 'all' ? 'All Tasks' : getPurposeLabel(Number(purposeFilter));
    subtitle.textContent = `Loading ${purposeLabel} dispatch data for ${selectedDate}...`;
    meta.textContent = 'Querying Firestore by date range...';

    document.querySelector('#opsStaffTable tbody').innerHTML =
        '<tr><td colspan="6" class="loading-cell">Loading...</td></tr>';
    document.querySelector('#opsTaskTable tbody').innerHTML =
        '<tr><td colspan="9" class="loading-cell">Loading...</td></tr>';

    try {
        const start = `${selectedDate} 00:00:00`;
        const end = `${selectedDate} 23:59:59`;
        const lookbackStartDate = addDaysYmd(selectedDate, -OPS_CARRYOVER_DAYS);
        const carryStart = `${lookbackStartDate} 00:00:00`;

        const [scheduleDocs, carryoverDocs, schedtimeDocs] = await Promise.all([
            queryByDateRange('tbl_schedule', 'task_datetime', { start, end }),
            includeCarryover
                ? queryByDateRange('tbl_schedule', 'task_datetime', {
                    start: carryStart,
                    end: start,
                    endOp: 'LESS_THAN'
                })
                : Promise.resolve([]),
            queryByDateRange('tbl_schedtime', 'schedule_date', { start, end })
        ]);

        await ensureClosedScheduleIdsLoaded();

        const dayRows = scheduleDocs.map(parseFirestoreDoc).filter(Boolean);
        const carryRows = carryoverDocs
            .map(parseFirestoreDoc)
            .filter(Boolean)
            // Avoid Firestore composite-index requirements by filtering these client-side.
            .filter((row) => String(row.date_finished || '').trim() === ZERO_DATETIME)
            .filter((row) => Number(row.iscancel || 0) === 0);
        // If this legacy table is present, exclude carryover tasks already marked closed elsewhere.
        const carryRowsFiltered = carryRows.filter((row) => !opsCache.closedScheduleIds.has(Number(row.id || 0)));

        const merged = new Map();
        dayRows.forEach((row) => merged.set(Number(row.id || 0), row));
        carryRowsFiltered.forEach((row) => {
            const id = Number(row.id || 0);
            if (!merged.has(id)) merged.set(id, row);
        });

        const mergedRows = [...merged.values()]
            .filter((row) => Number(row.id || 0) > 0)
            .sort((a, b) => {
                const left = String(a.task_datetime || '');
                const right = String(b.task_datetime || '');
                if (left !== right) return left.localeCompare(right);
                return Number(a.id || 0) - Number(b.id || 0);
            });

        const schedtimeRows = schedtimeDocs.map(parseFirestoreDoc).filter(Boolean);

        opsState.selectedDate = selectedDate;
        opsState.allRows = mergedRows;
        opsState.schedtimeRows = schedtimeRows;
        opsState.purposeFilter = purposeFilter;
        opsState.includeCarryover = includeCarryover;

        const byPurpose = filterRowsByPurpose(mergedRows, purposeFilter);
        const assigneeIds = byPurpose.map((row) => Number(row.tech_id || 0));
        const troubleIds = byPurpose.map((row) => Number(row.trouble_id || 0));
        const branchIds = byPurpose.map((row) => Number(row.branch_id || 0)).filter((id) => id > 0);
        schedtimeRows.forEach((log) => {
            const branchId = Number(log.branch_id || 0);
            if (branchId > 0) branchIds.push(branchId);
        });
        const companyIdsFromSchedule = byPurpose.map((row) => Number(row.company_id || 0)).filter((id) => id > 0);

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

        subtitle.textContent = `Operations for ${selectedDate} (${purposeLabel}): ${byPurpose.length} task(s), ${schedtimeRows.length} execution log(s).`;
        meta.textContent = `Loaded ${dayRows.length} schedule(s) for ${selectedDate}. ${includeCarryover ? `Carryover: pending from last ${OPS_CARRYOVER_DAYS} day(s).` : 'Carryover disabled.'}`;

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
    const selectedDate = opsState.selectedDate || formatDateYmd(new Date());
    const canCarry = MargaAuth.isAdmin() || (MargaAuth.getUser()?.role === 'service');
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
                await patchDocument('tbl_schedule', current.id, { task_datetime: nextDateTime });
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
