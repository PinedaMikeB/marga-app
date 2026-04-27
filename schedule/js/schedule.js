if (!MargaAuth.requireAccess('schedule')) {
    throw new Error('Unauthorized access to schedule planner.');
}

const PLANNER_QUERY_LIMIT = 1200;
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

const plannerState = {
    date: '',
    rows: [],
    filteredRows: [],
    lookups: {
        employees: new Map(),
        positions: new Map(),
        troubles: new Map(),
        branches: new Map(),
        companies: new Map(),
        machines: new Map(),
        areas: new Map()
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    if (user) {
        document.getElementById('userName').textContent = user.name;
        document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
        document.getElementById('userAvatar').textContent = String(user.name || 'A').charAt(0).toUpperCase();
    }

    MargaAuth.applyModulePermissions();

    const dateInput = document.getElementById('scheduleDateInput');
    dateInput.value = formatDateYmd(new Date());
    dateInput.addEventListener('change', () => loadSchedulePlanner());

    document.getElementById('scheduleRefreshBtn').addEventListener('click', () => loadSchedulePlanner());
    document.getElementById('scheduleSearchInput').addEventListener('input', () => renderSchedulePlanner());

    loadSchedulePlanner();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

function sanitize(value) {
    return MargaUtils.escapeHtml(String(value ?? ''));
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
    const fields = doc?.fields || {};
    const parsed = {};
    Object.entries(fields).forEach(([key, value]) => {
        parsed[key] = parseFirestoreValue(value);
    });
    if (doc?.name) parsed._docId = doc.name.split('/').pop();
    return parsed;
}

async function runStructuredQuery(structuredQuery) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`, {
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

function firestoreValue(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    return { stringValue: String(value ?? '') };
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
        limit: PLANNER_QUERY_LIMIT
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
        limit: PLANNER_QUERY_LIMIT
    });
}

async function fetchDoc(collection, docId) {
    if (!docId && docId !== 0) return null;
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(String(docId))}?key=${FIREBASE_CONFIG.apiKey}`);
    if (response.status === 404) return null;
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to load ${collection}/${docId}`);
    }
    return parseFirestoreDoc(payload);
}

async function fetchMany(collection, ids, cache) {
    const uniqueIds = Array.from(new Set(
        ids
            .map((id) => String(id || '').trim())
            .filter((id) => id && id !== '0')
    ));
    await Promise.all(uniqueIds.map(async (id) => {
        if (cache.has(id)) return;
        const doc = await fetchDoc(collection, id).catch(() => null);
        if (doc) cache.set(id, doc);
    }));
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

function employeeRole(employee) {
    if (!employee) return 'Unknown';
    const position = plannerState.lookups.positions.get(String(employee.position_id || 0));
    const positionId = Number(employee.position_id || 0);
    const label = String(position?.position || employee.position || '').toLowerCase();
    if (positionId === 5 || label.includes('technician') || label.includes('tech')) return 'Technician';
    if (positionId === 9 || label.includes('messenger') || label.includes('driver')) return 'Messenger';
    if (label.includes('production')) return 'Production';
    return 'Staff';
}

function getPurposeLabel(id) {
    return PURPOSE_LABELS[Number(id || 0)] || `Purpose ${id || '-'}`;
}

function getPurposeClass(label) {
    const lower = String(label || '').toLowerCase();
    if (lower.includes('collection')) return 'collection';
    if (lower.includes('reading')) return 'reading';
    return '';
}

function formatScheduleDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '-';
    const datePart = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
    return raw;
}

function normalizeSearch(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function shouldShowLegacyMessengerRow(row) {
    const staffId = Number(row.tech_id || 0);
    const employee = plannerState.lookups.employees.get(String(staffId));
    const role = employeeRole(employee);
    const purposeId = Number(row.purpose_id || 0);
    if (role === 'Technician') return false;
    if (role === 'Messenger') return true;
    return purposeId !== 5;
}

function buildLegacyScheduleRow(row) {
    const branch = plannerState.lookups.branches.get(String(row.branch_id || 0));
    const company = plannerState.lookups.companies.get(String(branch?.company_id || row.company_id || 0));
    const machine = plannerState.lookups.machines.get(String(row.serial || 0));
    const trouble = plannerState.lookups.troubles.get(String(row.trouble_id || 0));
    const employee = plannerState.lookups.employees.get(String(row.tech_id || 0));
    const purposeLabel = getPurposeLabel(row.purpose_id);
    const branchName = branch?.branchname || row.branch_name || '';
    const clientName = company?.companyname || row.company_name || row.client || branchName || 'Unknown Client';
    const invoiceNo = row.invoice_num || row.invoice_no || row.invoiceno || row.invoice_id || row.invoiceid || '0';

    return {
        source: 'legacy',
        id: row.id || row._docId || '',
        client: clientName,
        branch: branchName,
        serial: machine?.serial || row.field_serial_selected || row.serial_number || row.serial || '-',
        purpose: purposeLabel,
        purposeClass: getPurposeClass(purposeLabel),
        trouble: trouble?.trouble || row.trouble || row.remarks || '-',
        scheduleDate: formatScheduleDate(row.task_datetime),
        invoiceNo,
        aging: row.ageing || row.aging || row.age || 'NEW',
        staff: employeeName(employee, row.tech_id),
        status: 'Assigned',
        statusClass: 'assigned',
        searchText: [
            row.id,
            clientName,
            branchName,
            machine?.serial,
            row.serial,
            purposeLabel,
            trouble?.trouble,
            invoiceNo,
            employeeName(employee, row.tech_id)
        ].join(' ')
    };
}

function buildPlannerScheduleRow(row) {
    const serials = parseJsonArray(row.serial_numbers_json || row.serial_numbers).filter(Boolean);
    const branchNames = parseJsonArray(row.branch_names_json || row.branch_names).filter(Boolean);
    const staffName = String(row.assigned_staff_name || row.suggested_staff_name || row.suggested_messenger_name || '').trim();
    const staffId = String(row.assigned_staff_id || row.suggested_staff_id || row.suggested_messenger_id || '').trim();
    const status = String(row.planner_status || row.task_status || 'suggested').replace(/_/g, ' ');
    const purpose = row.task_label || 'Deliver Invoice';

    return {
        source: 'planner',
        id: row.id || row._docId || '',
        client: row.company_name || row.account_name || 'Unknown Client',
        branch: row.primary_branch_name || branchNames[0] || '',
        serial: serials[0] || '-',
        purpose: row.department === 'collection' ? 'Collection' : 'Billing',
        purposeClass: getPurposeClass(row.department === 'collection' ? 'Collection' : 'Billing'),
        trouble: purpose,
        scheduleDate: formatScheduleDate(row.schedule_date || row.preferred_schedule_date || row.requested_date),
        invoiceNo: row.invoice_no || '0',
        aging: 'NEW',
        staff: staffName || (staffId ? `ID ${staffId}` : 'Suggested / Unassigned'),
        status,
        statusClass: row.assigned_staff_id ? 'assigned' : (row.suggested_staff_id || row.suggested_staff_name ? 'suggested' : 'unscheduled'),
        searchText: [
            row.id,
            row.company_name,
            row.account_name,
            row.primary_branch_name,
            serials.join(' '),
            row.invoice_no,
            staffName,
            status
        ].join(' ')
    };
}

async function loadSchedulePlanner() {
    const selectedDate = document.getElementById('scheduleDateInput').value || formatDateYmd(new Date());
    const status = document.getElementById('plannerStatus');
    const subtitle = document.getElementById('scheduleSubtitle');
    plannerState.date = selectedDate;
    status.textContent = 'Loading';
    subtitle.textContent = `Loading messenger schedules for ${selectedDate}.`;
    document.getElementById('scheduleTableBody').innerHTML = '<tr><td colspan="10" class="schedule-empty">Loading schedules...</td></tr>';

    try {
        const start = `${selectedDate} 00:00:00`;
        const end = `${selectedDate} 23:59:59`;
        const [legacyDocs, plannerDocs] = await Promise.all([
            queryDateRange('tbl_schedule', 'task_datetime', start, end).catch((error) => {
                console.warn('Legacy schedule query failed.', error);
                return [];
            }),
            queryEquals('tbl_schedule_planner', 'schedule_date', selectedDate).catch((error) => {
                console.warn('Schedule planner query failed.', error);
                return [];
            })
        ]);

        const legacyRows = legacyDocs.map(parseFirestoreDoc).filter(Boolean);
        const plannerRows = plannerDocs.map(parseFirestoreDoc).filter(Boolean);

        await hydrateScheduleLookups(legacyRows);

        const rows = [
            ...legacyRows.filter(shouldShowLegacyMessengerRow).map(buildLegacyScheduleRow),
            ...plannerRows.map(buildPlannerScheduleRow)
        ].sort((a, b) => {
            if (a.staff !== b.staff) return a.staff.localeCompare(b.staff);
            if (a.scheduleDate !== b.scheduleDate) return a.scheduleDate.localeCompare(b.scheduleDate);
            return String(a.id).localeCompare(String(b.id));
        });

        plannerState.rows = rows;
        status.textContent = 'Loaded';
        subtitle.textContent = `${rows.length} messenger schedule${rows.length === 1 ? '' : 's'} for ${selectedDate}.`;
        document.getElementById('scheduleDateTitle').textContent = `Messenger Schedules - ${selectedDate}`;
        renderSchedulePlanner();
    } catch (error) {
        console.error('Schedule Planner load failed.', error);
        status.textContent = 'Error';
        subtitle.textContent = 'Schedule Planner failed to load.';
        document.getElementById('scheduleTableBody').innerHTML = `<tr><td colspan="10" class="schedule-empty">Error: ${sanitize(error.message || error)}</td></tr>`;
    }
}

async function hydrateScheduleLookups(rows) {
    const employeeIds = rows.map((row) => row.tech_id);
    const troubleIds = rows.map((row) => row.trouble_id);
    const branchIds = rows.map((row) => row.branch_id);
    const companyIds = rows.map((row) => row.company_id);
    const machineIds = rows.map((row) => row.serial);

    await Promise.all([
        fetchMany('tbl_employee', employeeIds, plannerState.lookups.employees),
        fetchMany('tbl_trouble', troubleIds, plannerState.lookups.troubles),
        fetchMany('tbl_branchinfo', branchIds, plannerState.lookups.branches),
        fetchMany('tbl_machine', machineIds, plannerState.lookups.machines)
    ]);

    const positionIds = Array.from(plannerState.lookups.employees.values()).map((employee) => employee?.position_id);
    const branchCompanyIds = Array.from(plannerState.lookups.branches.values()).map((branch) => branch?.company_id);
    const areaIds = Array.from(plannerState.lookups.branches.values()).map((branch) => branch?.area_id);

    await Promise.all([
        fetchMany('tbl_empos', positionIds, plannerState.lookups.positions),
        fetchMany('tbl_companylist', [...companyIds, ...branchCompanyIds], plannerState.lookups.companies),
        fetchMany('tbl_area', areaIds, plannerState.lookups.areas)
    ]);
}

function renderKpis(rows) {
    const billing = rows.filter((row) => /billing|invoice|reading/i.test(`${row.purpose} ${row.trouble}`)).length;
    const collection = rows.filter((row) => /collection/i.test(`${row.purpose} ${row.trouble}`)).length;
    const unassigned = rows.filter((row) => /unassigned|suggested/i.test(`${row.staff} ${row.status}`)).length;
    const values = [rows.length, billing, collection, unassigned];
    document.querySelectorAll('#scheduleKpis strong').forEach((node, index) => {
        node.textContent = String(values[index] || 0);
    });
}

function renderSchedulePlanner() {
    const searchTerm = normalizeSearch(document.getElementById('scheduleSearchInput').value);
    const rows = searchTerm
        ? plannerState.rows.filter((row) => normalizeSearch(row.searchText).includes(searchTerm))
        : plannerState.rows;

    plannerState.filteredRows = rows;
    renderKpis(rows);
    document.getElementById('scheduleCount').textContent = `${rows.length} schedule${rows.length === 1 ? '' : 's'}`;

    const tbody = document.getElementById('scheduleTableBody');
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="10" class="schedule-empty">No messenger schedules for this date/filter.</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map((row) => `
        <tr class="${row.source === 'planner' ? 'schedule-planner-row' : ''}">
            <td data-label="Sched ID">${sanitize(row.id)}</td>
            <td data-label="Client">
                <div class="schedule-client">${sanitize(row.client)}</div>
                <div class="schedule-branch">${sanitize(row.branch || 'Main')}</div>
            </td>
            <td data-label="Serial">${sanitize(row.serial)}</td>
            <td data-label="Purpose"><span class="schedule-purpose ${sanitize(row.purposeClass)}">${sanitize(row.purpose)}</span></td>
            <td data-label="Trouble">${sanitize(row.trouble)}</td>
            <td data-label="Sched Date">${sanitize(row.scheduleDate)}</td>
            <td data-label="Invoice Num">${sanitize(row.invoiceNo)}</td>
            <td data-label="Aging">${sanitize(row.aging)}</td>
            <td data-label="Tech/MSGR">${sanitize(row.staff)}</td>
            <td data-label="Status"><span class="schedule-status ${sanitize(row.statusClass)}">${sanitize(row.status)}</span></td>
        </tr>
    `).join('');
}
