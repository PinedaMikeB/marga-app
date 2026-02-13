if (!MargaAuth.requireAccess('field')) {
    throw new Error('Unauthorized access to field module.');
}

const FIELD_QUERY_LIMIT = 5000;
const FIELD_CARRYOVER_DAYS = 14;
const ZERO_DATETIME = '0000-00-00 00:00:00';
const SERIAL_CORRECTION_COLLECTION = 'marga_serial_corrections';
const PRODUCTION_QUEUE_COLLECTION = 'marga_production_queue';

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

const FALLBACK_MACHINE_STATUSES = [
    { id: 1, label: 'Running / Print OK' },
    { id: 2, label: 'Running / Print Problem' },
    { id: 3, label: 'Down / No Print' }
];

const caches = {
    trouble: new Map(),
    branch: new Map(),
    company: new Map(),
    area: new Map(),
    machine: new Map(),
    model: new Map(),
    brand: new Map(),
    serialCatalogLoaded: false,
    serialCatalog: [],
    serialByUpper: new Map(),
    machineStatusesLoaded: false,
    machineStatuses: [],
    partsCatalogLoaded: false,
    partsCatalog: [],
    partsByKey: new Map(),
    branchContacts: new Map()
};

const state = {
    selectedDate: '',
    includeCarryover: true,
    statusFilter: 'all',
    staffId: null,
    rows: [],
    modalScheduleId: null,
    modalMachineId: null,
    modalBranchId: null,
    modalExpectedPin: '',
    modalStatusKey: 'pending',
    modalSchedtimeDocId: null,
    modalSchedtimeId: null,
    modalPartsNeeded: [],
    modalReadOnly: false
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    state.staffId = Number(user?.staff_id || 0) || null;
    if (!state.staffId) {
        alert('This account has no staff_id mapped. Please update marga_users with staff_id.');
    }
    const displayName = String(user?.name || user?.username || user?.email || 'User').trim();
    const displayRole = String(user?.role || '').trim();
    const badge = document.getElementById('fieldUserBadge');
    const headerTitle = document.getElementById('fieldHeaderTitle');
    const userLine = document.getElementById('fieldUserLine');
    if (badge) badge.textContent = (displayName.charAt(0) || 'U').toUpperCase();
    if (headerTitle) headerTitle.textContent = `${displayName} - Schedule`;
    if (userLine) userLine.textContent = displayRole ? `Role: ${displayRole}` : 'Role: field';

    const dateInput = document.getElementById('fieldDate');
    dateInput.value = formatDateYmd(new Date());

    document.getElementById('fieldRefresh').addEventListener('click', () => loadMySchedule());
    document.getElementById('fieldCarryover').addEventListener('change', () => {
        state.includeCarryover = document.getElementById('fieldCarryover').checked;
        loadMySchedule();
    });
    document.getElementById('fieldStatusFilter').addEventListener('change', () => {
        state.statusFilter = document.getElementById('fieldStatusFilter').value;
        renderList();
    });
    dateInput.addEventListener('change', () => loadMySchedule());
    document.getElementById('fieldLogout').addEventListener('click', () => MargaAuth.logout());

    document.getElementById('fieldOverlay').addEventListener('click', closeModal);
    document.getElementById('fieldModalClose').addEventListener('click', closeModal);
    document.getElementById('fieldModalCancel').addEventListener('click', closeModal);
    document.getElementById('fieldModalSaveDraft').addEventListener('click', saveDraftUpdate);
    document.getElementById('fieldModalPendingTask').addEventListener('click', markPendingTask);
    document.getElementById('fieldModalCloseTask').addEventListener('click', closeTask);
    document.getElementById('fieldSaveSerialBtn').addEventListener('click', saveSerialMapping);

    document.getElementById('fieldSerialInput').addEventListener('input', handleSerialInputChange);
    document.getElementById('fieldSerialMissingCheck').addEventListener('change', toggleMissingSerialMode);

    document.getElementById('fieldAddPartBtn').addEventListener('click', addPartEntry);
    document.getElementById('fieldPartInput').addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addPartEntry();
    });
    document.getElementById('fieldPartsList').addEventListener('click', removePartEntry);

    document.getElementById('fieldBeforePhoto').addEventListener('change', () => updatePhotoHint('fieldBeforePhoto', 'fieldBeforePhotoHint', 'field_before_photo_name'));
    document.getElementById('fieldAfterPhoto').addEventListener('change', () => updatePhotoHint('fieldAfterPhoto', 'fieldAfterPhotoHint', 'field_after_photo_name'));

    document.getElementById('fieldPresentMeter').addEventListener('input', recomputeTotalConsumed);
    document.getElementById('fieldPreviousMeter').addEventListener('input', recomputeTotalConsumed);
    document.getElementById('fieldTimeInNowBtn').addEventListener('click', markTimeInNow);

    void loadMachineStatusOptions();

    loadMySchedule();
});

function sanitize(text) {
    return MargaUtils.escapeHtml(String(text ?? ''));
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

function toFirestoreFieldValue(value) {
    if (value === null) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) return { integerValue: String(Math.trunc(value)) };
    return { stringValue: String(value ?? '') };
}

async function runQuery(structuredQuery) {
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

async function fetchDoc(collection, id) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${id}?key=${FIREBASE_CONFIG.apiKey}`);
    const payload = await response.json();
    if (!response.ok || payload?.error) return null;
    return parseFirestoreDoc(payload);
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

function appendDevRemarks(previous, tag, notes) {
    const base = String(previous || '').trim();
    const next = String(notes || '').trim();
    const stamp = new Date().toLocaleString('en-PH');
    const line = [tag, next].filter(Boolean).join(' ');
    return [base, `${stamp}: ${line}`].filter(Boolean).join(' | ').slice(0, 240);
}

async function queryByDateRange(collectionId, fieldPath, start, end, endOp = 'LESS_THAN_OR_EQUAL') {
    const structuredQuery = {
        from: [{ collectionId }],
        where: {
            compositeFilter: {
                op: 'AND',
                filters: [
                    {
                        fieldFilter: {
                            field: { fieldPath },
                            op: 'GREATER_THAN_OR_EQUAL',
                            value: { stringValue: start }
                        }
                    },
                    {
                        fieldFilter: {
                            field: { fieldPath },
                            op: endOp,
                            value: { stringValue: end }
                        }
                    }
                ]
            }
        },
        orderBy: [{ field: { fieldPath }, direction: 'ASCENDING' }],
        limit: FIELD_QUERY_LIMIT
    };
    return runQuery(structuredQuery);
}

async function queryEquals(collectionId, fieldPath, value, valueType = 'integer', limit = 100) {
    const typedValue = valueType === 'integer'
        ? { integerValue: String(Math.trunc(Number(value || 0))) }
        : { stringValue: String(value ?? '') };

    const structuredQuery = {
        from: [{ collectionId }],
        where: {
            fieldFilter: {
                field: { fieldPath },
                op: 'EQUAL',
                value: typedValue
            }
        },
        limit
    };
    return runQuery(structuredQuery);
}

async function queryCollection(collectionId, limit = 1000) {
    const structuredQuery = {
        from: [{ collectionId }],
        limit
    };
    return runQuery(structuredQuery);
}

function getStatusKey(row) {
    if (Number(row.iscancel || 0) === 1) return 'cancelled';
    const finished = String(row.date_finished || '').trim();
    if (finished && finished !== ZERO_DATETIME) return 'closed';
    if (Number(row.isongoing || 0) === 1) return 'ongoing';
    const taskDate = String(row.task_datetime || '').slice(0, 10);
    if (taskDate && state.selectedDate && taskDate < state.selectedDate) return 'carryover';
    return 'pending';
}

function getStatusMeta(row) {
    const key = getStatusKey(row);
    if (key === 'pending') return { key, label: 'Pending', className: 'status-pending' };
    if (key === 'carryover') return { key, label: 'Carryover', className: 'status-carryover' };
    if (key === 'ongoing') return { key, label: 'Ongoing', className: 'status-ongoing' };
    if (key === 'closed') return { key, label: 'Closed', className: 'status-closed' };
    if (key === 'cancelled') return { key, label: 'Cancelled', className: 'status-cancelled' };
    return { key, label: 'Pending', className: 'status-pending' };
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

function toDbDateTimeFromLocal(localValue) {
    if (!localValue) return ZERO_DATETIME;
    const normalized = String(localValue).replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return ZERO_DATETIME;
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mi = String(parsed.getMinutes()).padStart(2, '0');
    const ss = String(parsed.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function toLocalInputDateTime(dbValue) {
    const value = String(dbValue || '').trim();
    if (!value || value === ZERO_DATETIME) return '';
    const normalized = value.replace(' ', 'T');
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
        if (value.length >= 16) return value.slice(0, 16).replace(' ', 'T');
        return '';
    }
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    const hh = String(parsed.getHours()).padStart(2, '0');
    const mi = String(parsed.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function nowDbDateTime() {
    return toDbDateTimeFromLocal(toLocalInputDateTime(new Date().toISOString()));
}

function parseIntegerInput(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.max(0, Math.trunc(num));
}

function clampText(value, max = 255) {
    return String(value || '').trim().slice(0, max);
}

function jsonString(value, fallback = '') {
    try {
        return JSON.stringify(value);
    } catch (err) {
        return fallback;
    }
}

async function ensureLookup(collection, id, map) {
    const key = String(id || '');
    if (!key || key === '0') return null;
    if (map.has(key)) return map.get(key);
    const doc = await fetchDoc(collection, key);
    if (doc) map.set(key, doc);
    return doc;
}

async function hydrateLookups(rows) {
    const troubleIds = new Set();
    const branchIds = new Set();
    const companyIds = new Set();
    const areaIds = new Set();
    const machineIds = new Set();

    rows.forEach((r) => {
        if (Number(r.trouble_id || 0) > 0) troubleIds.add(Number(r.trouble_id));
        if (Number(r.branch_id || 0) > 0) branchIds.add(Number(r.branch_id));
        if (Number(r.company_id || 0) > 0) companyIds.add(Number(r.company_id));
        if (Number(r.area_id || 0) > 0) areaIds.add(Number(r.area_id));
        if (Number(r.serial || 0) > 0) machineIds.add(Number(r.serial));
    });

    await Promise.all([
        ...[...troubleIds].map((id) => ensureLookup('tbl_trouble', id, caches.trouble)),
        ...[...branchIds].map((id) => ensureLookup('tbl_branchinfo', id, caches.branch)),
        ...[...companyIds].map((id) => ensureLookup('tbl_companylist', id, caches.company)),
        ...[...areaIds].map((id) => ensureLookup('tbl_area', id, caches.area)),
        ...[...machineIds].map((id) => ensureLookup('tbl_machine', id, caches.machine))
    ]);

    const modelIds = new Set();
    const brandIds = new Set();
    [...machineIds].forEach((id) => {
        const machine = caches.machine.get(String(id));
        if (machine?.model_id) modelIds.add(Number(machine.model_id));
        if (machine?.brand_id) brandIds.add(Number(machine.brand_id));
    });

    await Promise.all([
        ...[...modelIds].map((id) => ensureLookup('tbl_model', id, caches.model)),
        ...[...brandIds].map((id) => ensureLookup('tbl_brand', id, caches.brand))
    ]);
}

function renderKpis(rows) {
    const counts = rows.reduce((acc, r) => {
        const k = getStatusKey(r);
        acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});

    document.getElementById('fieldKpis').innerHTML = `
        <div class="field-kpi"><div class="label">Today</div><div class="value">${rows.filter((r) => String(r.task_datetime || '').startsWith(state.selectedDate)).length}</div></div>
        <div class="field-kpi"><div class="label">Carryover</div><div class="value">${counts.carryover || 0}</div></div>
        <div class="field-kpi"><div class="label">Pending</div><div class="value">${counts.pending || 0}</div></div>
        <div class="field-kpi"><div class="label">Ongoing (Parts)</div><div class="value">${counts.ongoing || 0}</div></div>
        <div class="field-kpi"><div class="label">Closed</div><div class="value">${counts.closed || 0}</div></div>
    `;
}

function renderList() {
    const list = document.getElementById('fieldList');
    const filtered = state.statusFilter === 'all'
        ? state.rows
        : state.rows.filter((r) => getStatusKey(r) === state.statusFilter);

    if (!filtered.length) {
        list.innerHTML = '<div class="loading-cell">No tasks for selected date/filter.</div>';
        return;
    }

    list.innerHTML = filtered.map((row) => {
        const trouble = caches.trouble.get(String(row.trouble_id || 0));
        const troubleLabel = trouble?.trouble || (row.trouble_id ? `Trouble ${row.trouble_id}` : 'Unspecified');
        const purposeLabel = PURPOSE_LABELS[row.purpose_id] || `Purpose ${row.purpose_id}`;

        const branch = caches.branch.get(String(row.branch_id || 0));
        const company = caches.company.get(String(row.company_id || branch?.company_id || 0));
        const area = caches.area.get(String(row.area_id || branch?.area_id || 0));
        const machine = caches.machine.get(String(row.serial || 0));
        const model = machine ? caches.model.get(String(machine.model_id || 0)) : null;
        const brand = machine ? caches.brand.get(String(machine.brand_id || 0)) : null;

        const status = getStatusMeta(row);
        const clientName = company?.companyname || '-';
        const branchName = branch?.branchname || `Branch #${row.branch_id || 0}`;
        const areaName = area?.area_name || '-';
        const machineSerial = machine?.serial || row.field_serial_selected || '-';
        const modelName = model?.model || model?.model_name || '';
        const brandName = brand?.brand || '';
        const machineLine = brandName || modelName
            ? `${sanitize(brandName)} ${sanitize(modelName)}`.trim()
            : 'Machine';
        const partsNote = Number(row.pending_parts || 0) === 1 || Number(row.isongoing || 0) === 1
            ? '<div class="sub"><strong>Pending:</strong> parts preparation in progress.</div>'
            : '';

        return `
            <div class="field-task">
                <div class="field-task-top">
                    <div>
                        <h4>#${sanitize(row.id)} ${sanitize(purposeLabel)} / ${sanitize(troubleLabel)}</h4>
                        <div class="meta">${sanitize(formatTaskDateTime(row.task_datetime))} · <span class="ops-status-badge ${sanitize(status.className)}">${sanitize(status.label)}</span></div>
                        <div class="sub">${sanitize(clientName)} · ${sanitize(branchName)} · ${sanitize(areaName)}</div>
                        <div class="sub">${machineLine} · Serial: <strong>${sanitize(machineSerial)}</strong></div>
                        <div class="sub">${sanitize(row.remarks || row.caller || '-')}</div>
                        ${partsNote}
                    </div>
                    <div class="field-task-actions">
                        <button type="button" class="btn btn-secondary btn-sm" data-action="open" data-id="${row.id}">Update</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    list.querySelectorAll('button[data-action="open"]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const scheduleId = Number(btn.dataset.id || 0);
            if (!scheduleId) return;
            openModal(scheduleId).catch((err) => {
                console.error('Open modal failed:', err);
                alert(`Unable to open task: ${err?.message || err}`);
            });
        });
    });
}

async function loadMySchedule() {
    const date = document.getElementById('fieldDate').value || formatDateYmd(new Date());
    state.selectedDate = date;
    const subtitle = document.getElementById('fieldSubtitle');
    subtitle.textContent = 'Loading tasks...';

    document.getElementById('fieldList').innerHTML = '<div class="loading-cell">Loading...</div>';

    try {
        const dayStart = `${date} 00:00:00`;
        const dayEnd = `${date} 23:59:59`;
        const carryStart = `${addDaysYmd(date, -FIELD_CARRYOVER_DAYS)} 00:00:00`;

        const [dayDocs, carryDocs] = await Promise.all([
            queryByDateRange('tbl_schedule', 'task_datetime', dayStart, dayEnd),
            state.includeCarryover ? queryByDateRange('tbl_schedule', 'task_datetime', carryStart, dayStart, 'LESS_THAN') : Promise.resolve([])
        ]);

        const dayRows = dayDocs.map(parseFirestoreDoc).filter(Boolean);
        const carryRows = carryDocs
            .map(parseFirestoreDoc)
            .filter(Boolean)
            .filter((row) => String(row.date_finished || '').trim() === ZERO_DATETIME)
            .filter((row) => Number(row.iscancel || 0) === 0);

        const merged = new Map();
        dayRows.forEach((row) => merged.set(Number(row.id || 0), row));
        carryRows.forEach((row) => {
            const id = Number(row.id || 0);
            if (!merged.has(id)) merged.set(id, row);
        });

        const all = [...merged.values()]
            .filter((row) => Number(row.tech_id || 0) === Number(state.staffId || 0))
            .sort((a, b) => String(a.task_datetime || '').localeCompare(String(b.task_datetime || '')) || (Number(a.id || 0) - Number(b.id || 0)));

        state.rows = all;
        await hydrateLookups(all);
        renderKpis(all);
        renderList();

        subtitle.textContent = `${all.length} task(s) for ${date}.`;
    } catch (err) {
        console.error('Field load failed:', err);
        subtitle.textContent = 'Failed to load tasks.';
        document.getElementById('fieldList').innerHTML = `<div class="loading-cell">Error: ${sanitize(err.message || err)}</div>`;
    }
}

async function loadMachineStatusOptions() {
    if (caches.machineStatusesLoaded) return;
    let statuses = [];
    try {
        const docs = await queryCollection('tbl_mstatus', 100);
        statuses = docs
            .map(parseFirestoreDoc)
            .filter(Boolean)
            .map((row) => ({
                id: Number(row.id || 0),
                label: String(row.status || row.description || '').trim()
            }))
            .filter((row) => row.id > 0 && row.label);
    } catch (err) {
        console.warn('tbl_mstatus load failed, using fallback statuses.', err);
    }
    if (!statuses.length) statuses = FALLBACK_MACHINE_STATUSES;
    statuses.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    caches.machineStatuses = statuses;
    caches.machineStatusesLoaded = true;

    const select = document.getElementById('fieldMachineStatus');
    select.innerHTML = statuses.map((item) => (
        `<option value="${sanitize(item.id)}" data-label="${sanitize(item.label)}">${sanitize(item.label)}</option>`
    )).join('');
}

async function loadPartsCatalog() {
    if (caches.partsCatalogLoaded) return;
    let rows = [];
    try {
        const docs = await queryCollection('tbl_inventoryparts', 3000);
        rows = docs
            .map(parseFirestoreDoc)
            .filter(Boolean)
            .map((row) => ({
                key: `inv_${row.id}`,
                id: Number(row.id || 0),
                name: String(row.item_name || '').trim(),
                code: String(row.item_code || '').trim(),
                source: 'inventory'
            }))
            .filter((row) => row.id > 0 && row.name);
    } catch (err) {
        console.warn('tbl_inventoryparts load failed:', err);
    }

    if (!rows.length) {
        try {
            const docs = await queryCollection('tbl_partstype', 400);
            rows = docs
                .map(parseFirestoreDoc)
                .filter(Boolean)
                .map((row) => ({
                    key: `ptype_${row.id}`,
                    id: Number(row.id || 0),
                    name: String(row.type || '').trim(),
                    code: '',
                    source: 'partstype'
                }))
                .filter((row) => row.id > 0 && row.name);
        } catch (err) {
            console.warn('tbl_partstype load failed:', err);
        }
    }

    const uniqueByName = new Map();
    rows.forEach((row) => {
        const uniqueKey = `${row.name.toUpperCase()}__${row.code.toUpperCase()}`;
        if (!uniqueByName.has(uniqueKey)) uniqueByName.set(uniqueKey, row);
    });

    caches.partsCatalog = [...uniqueByName.values()]
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    caches.partsByKey = new Map(caches.partsCatalog.map((row) => [row.key, row]));
    caches.partsCatalogLoaded = true;

    const options = document.getElementById('fieldPartOptions');
    options.innerHTML = caches.partsCatalog.map((part) => {
        const label = part.code ? `${part.name} (${part.code})` : part.name;
        return `<option value="${sanitize(label)}"></option>`;
    }).join('');
}

async function loadSerialCatalog() {
    if (caches.serialCatalogLoaded) return;
    let rows = [];
    try {
        const docs = await queryCollection('tbl_machine', 8000);
        rows = docs
            .map(parseFirestoreDoc)
            .filter(Boolean)
            .map((row) => ({
                id: Number(row.id || 0),
                serial: String(row.serial || '').trim(),
                model_id: Number(row.model_id || 0),
                brand_id: Number(row.brand_id || 0),
                bmeter: Number(row.bmeter || 0)
            }))
            .filter((row) => row.id > 0 && row.serial);
    } catch (err) {
        console.warn('tbl_machine catalog load failed:', err);
    }

    caches.serialCatalog = rows;
    caches.serialByUpper = new Map();
    rows.forEach((row) => {
        const key = row.serial.toUpperCase();
        const bucket = caches.serialByUpper.get(key) || [];
        bucket.push(row);
        caches.serialByUpper.set(key, bucket);
    });

    const datalist = document.getElementById('fieldSerialOptions');
    datalist.innerHTML = rows
        .slice(0, 8000)
        .map((row) => `<option value="${sanitize(row.serial)}"></option>`)
        .join('');
    caches.serialCatalogLoaded = true;
}

function resolveMachineFromSerial(serialText) {
    const key = String(serialText || '').trim().toUpperCase();
    if (!key) return null;
    const matches = caches.serialByUpper.get(key) || [];
    if (!matches.length) return null;
    if (matches.length === 1) return matches[0];
    const currentMachineId = Number(state.modalMachineId || 0);
    return matches.find((row) => Number(row.id || 0) === currentMachineId) || matches[0];
}

async function setModalMachineDetails(machine) {
    const modelInput = document.getElementById('fieldModelInput');
    const brandInput = document.getElementById('fieldBrandInput');

    if (!machine) {
        modelInput.value = '';
        brandInput.value = '';
        document.getElementById('fieldSerialMatchHint').textContent = 'Serial not matched in official list.';
        return;
    }

    state.modalMachineId = Number(machine.id || 0) || null;
    document.getElementById('fieldSerialMatchHint').textContent = `Selected machine #${machine.id}`;

    const model = await ensureLookup('tbl_model', machine.model_id, caches.model);
    const brand = await ensureLookup('tbl_brand', machine.brand_id, caches.brand);
    modelInput.value = model?.model || model?.model_name || '';
    brandInput.value = brand?.brand || '';
}

async function handleSerialInputChange() {
    if (document.getElementById('fieldSerialMissingCheck').checked) return;
    const serial = (document.getElementById('fieldSerialInput').value || '').trim();
    if (!serial) {
        await setModalMachineDetails(null);
        return;
    }

    if (!caches.serialCatalogLoaded) {
        await loadSerialCatalog();
    }

    const machine = resolveMachineFromSerial(serial);
    await setModalMachineDetails(machine);
}

function toggleMissingSerialMode() {
    const isMissing = document.getElementById('fieldSerialMissingCheck').checked;
    const serialInput = document.getElementById('fieldSerialInput');
    const missingInput = document.getElementById('fieldMissingSerialInput');

    serialInput.disabled = isMissing || state.modalReadOnly;
    missingInput.disabled = !isMissing || state.modalReadOnly;
    if (isMissing) {
        document.getElementById('fieldSerialMatchHint').textContent = 'Serial will be submitted for admin confirmation.';
    } else if (!serialInput.value) {
        document.getElementById('fieldSerialMatchHint').textContent = 'Type to search serial and select from list.';
    }
}

function recomputeTotalConsumed() {
    const previous = parseIntegerInput(document.getElementById('fieldPreviousMeter').value);
    const present = parseIntegerInput(document.getElementById('fieldPresentMeter').value);
    const total = Number.isFinite(previous) && Number.isFinite(present)
        ? Math.max(0, present - previous)
        : 0;
    document.getElementById('fieldTotalConsumed').value = String(total);
}

function parseSavedPartsList(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((item) => ({
                key: String(item.key || ''),
                name: String(item.name || '').trim(),
                qty: Math.max(1, Number(item.qty || 1)),
                source: String(item.source || '')
            }))
            .filter((item) => item.name);
    } catch (err) {
        return [];
    }
}

function renderPartsList() {
    const container = document.getElementById('fieldPartsList');
    if (!state.modalPartsNeeded.length) {
        container.innerHTML = '<span class="ops-subtext">No parts added.</span>';
        return;
    }

    container.innerHTML = state.modalPartsNeeded.map((item, index) => `
        <span class="field-part-chip">
            ${sanitize(item.name)} x${sanitize(item.qty)}
            <button type="button" data-index="${index}" aria-label="Remove part">×</button>
        </span>
    `).join('');
}

function matchPartFromInput(text) {
    const value = String(text || '').trim().toUpperCase();
    if (!value) return null;
    return caches.partsCatalog.find((part) => {
        const label = part.code ? `${part.name} (${part.code})` : part.name;
        return label.toUpperCase() === value || part.name.toUpperCase() === value || String(part.code || '').toUpperCase() === value;
    }) || null;
}

function addPartEntry() {
    if (state.modalReadOnly) return;
    const partInput = document.getElementById('fieldPartInput');
    const qtyInput = document.getElementById('fieldPartQty');
    const selected = matchPartFromInput(partInput.value);
    if (!selected) {
        alert('Please select a part from database list.');
        return;
    }

    const qty = parseIntegerInput(qtyInput.value) || 1;
    const existing = state.modalPartsNeeded.find((row) => row.key === selected.key);
    if (existing) {
        existing.qty += qty;
    } else {
        state.modalPartsNeeded.push({
            key: selected.key,
            name: selected.code ? `${selected.name} (${selected.code})` : selected.name,
            qty,
            source: selected.source
        });
    }

    partInput.value = '';
    qtyInput.value = '1';
    renderPartsList();
}

function removePartEntry(event) {
    const button = event.target.closest('button[data-index]');
    if (!button || state.modalReadOnly) return;
    const index = Number(button.dataset.index || -1);
    if (index < 0) return;
    state.modalPartsNeeded.splice(index, 1);
    renderPartsList();
}

function updatePhotoHint(inputId, hintId, fallbackField = '') {
    const input = document.getElementById(inputId);
    const hint = document.getElementById(hintId);
    const file = input.files?.[0];
    if (file) {
        hint.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
        return;
    }
    const saved = input.dataset.savedName || '';
    if (saved && fallbackField) {
        hint.textContent = `Saved: ${saved}`;
        return;
    }
    hint.textContent = 'No file selected.';
}

function getFileMeta(inputId) {
    const file = document.getElementById(inputId).files?.[0];
    if (!file) return null;
    return {
        name: String(file.name || '').slice(0, 255),
        size: Math.trunc(Number(file.size || 0)),
        type: String(file.type || '').slice(0, 80),
        modified: Math.trunc(Number(file.lastModified || 0))
    };
}

function setModalOpen(isOpen) {
    const overlay = document.getElementById('fieldOverlay');
    const modal = document.getElementById('fieldModal');
    modal.classList.toggle('open', isOpen);
    overlay.classList.toggle('visible', isOpen);
    modal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function resetModalFields() {
    state.modalScheduleId = null;
    state.modalMachineId = null;
    state.modalBranchId = null;
    state.modalExpectedPin = '';
    state.modalStatusKey = 'pending';
    state.modalSchedtimeDocId = null;
    state.modalSchedtimeId = null;
    state.modalPartsNeeded = [];
    state.modalReadOnly = false;

    document.getElementById('fieldCloseNotes').value = '';
    document.getElementById('fieldClosePin').value = '';
    document.getElementById('fieldSerialInput').value = '';
    document.getElementById('fieldSerialHint').textContent = '';
    document.getElementById('fieldSerialMatchHint').textContent = 'Type to search serial and select from list.';
    document.getElementById('fieldModelInput').value = '';
    document.getElementById('fieldBrandInput').value = '';
    document.getElementById('fieldSerialMissingCheck').checked = false;
    document.getElementById('fieldMissingSerialInput').value = '';
    document.getElementById('fieldPartInput').value = '';
    document.getElementById('fieldPartQty').value = '1';
    document.getElementById('fieldDeliveryDetails').value = '';
    document.getElementById('fieldEmptyPickupDetails').value = '';
    document.getElementById('fieldCustomerSigner').value = '';
    document.getElementById('fieldCustomerContact').value = '';
    document.getElementById('fieldFinalSummary').value = '';
    document.getElementById('fieldPreviousMeter').value = '';
    document.getElementById('fieldPresentMeter').value = '';
    document.getElementById('fieldTotalConsumed').value = '0';
    document.getElementById('fieldTimeIn').value = '';
    document.getElementById('fieldTimeOut').value = '';

    const before = document.getElementById('fieldBeforePhoto');
    const after = document.getElementById('fieldAfterPhoto');
    before.value = '';
    after.value = '';
    before.dataset.savedName = '';
    after.dataset.savedName = '';
    document.getElementById('fieldBeforePhotoHint').textContent = 'No file selected.';
    document.getElementById('fieldAfterPhotoHint').textContent = 'No file selected.';

    document.getElementById('fieldPinHint').textContent = 'Required to mark as Finished.';
    renderPartsList();
    toggleMissingSerialMode();
}

function closeModal() {
    setModalOpen(false);
    resetModalFields();
}

function setFormDisabled(isReadOnly) {
    state.modalReadOnly = isReadOnly;
    const ids = [
        'fieldSerialInput',
        'fieldSerialMissingCheck',
        'fieldMissingSerialInput',
        'fieldSaveSerialBtn',
        'fieldMachineStatus',
        'fieldCloseNotes',
        'fieldPartInput',
        'fieldPartQty',
        'fieldAddPartBtn',
        'fieldBeforePhoto',
        'fieldAfterPhoto',
        'fieldPreviousMeter',
        'fieldPresentMeter',
        'fieldTimeIn',
        'fieldTimeInNowBtn',
        'fieldDeliveryDetails',
        'fieldEmptyPickupDetails',
        'fieldCustomerSigner',
        'fieldCustomerContact',
        'fieldFinalSummary',
        'fieldClosePin',
        'fieldModalSaveDraft',
        'fieldModalPendingTask',
        'fieldModalCloseTask'
    ];

    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = isReadOnly;
    });
    document.getElementById('fieldTimeOut').disabled = true;
    toggleMissingSerialMode();
}

async function resolveExpectedPin(branchId, row = null) {
    const schedulePin = String(row?.customer_pin || '').trim();
    if (schedulePin) return schedulePin;

    const fromBranch = caches.branch.get(String(branchId || 0));
    const inlinePin = String(fromBranch?.service_pin || '').trim();
    if (inlinePin) return inlinePin;

    if (!branchId) return '';
    const pinDoc = await fetchDoc('marga_branch_pins', branchId);
    return String(pinDoc?.pin || '').trim();
}

async function resolveBranchContact(branchId, row) {
    const cacheKey = String(branchId || 0);
    if (caches.branchContacts.has(cacheKey)) {
        return caches.branchContacts.get(cacheKey);
    }

    const fallback = {
        contact_name: String(row?.caller || '').trim(),
        contact_phone: String(row?.phone_number || '').trim()
    };

    if (!branchId) {
        caches.branchContacts.set(cacheKey, fallback);
        return fallback;
    }

    try {
        const docs = await queryEquals('tbl_branchcontact', 'branch_id', Number(branchId), 'integer', 25);
        const rows = docs.map(parseFirestoreDoc).filter(Boolean);
        const first = rows.find((item) => String(item.contact_person || item.contact_number || '').trim()) || null;
        const result = {
            contact_name: String(first?.contact_person || fallback.contact_name || '').trim(),
            contact_phone: String(first?.contact_number || fallback.contact_phone || '').trim()
        };
        caches.branchContacts.set(cacheKey, result);
        return result;
    } catch (err) {
        console.warn('Branch contact lookup failed:', err);
        caches.branchContacts.set(cacheKey, fallback);
        return fallback;
    }
}

async function resolvePreviousMeter(machineId, scheduleId, taskDateTime, fallbackBm = 0) {
    if (!machineId) return Number(fallbackBm || 0) || 0;
    try {
        const docs = await queryEquals('tbl_schedule', 'serial', Number(machineId), 'integer', 1200);
        const rows = docs
            .map(parseFirestoreDoc)
            .filter(Boolean)
            .filter((row) => Number(row.id || 0) !== Number(scheduleId || 0))
            .filter((row) => Number(row.meter_reading || 0) > 0);

        const referenceTs = new Date(String(taskDateTime || '').replace(' ', 'T')).getTime();
        const candidates = rows.filter((row) => {
            const finished = String(row.date_finished || '').trim();
            const basis = finished && finished !== ZERO_DATETIME ? finished : String(row.task_datetime || '').trim();
            const ts = new Date(basis.replace(' ', 'T')).getTime();
            if (!Number.isFinite(ts)) return true;
            if (!Number.isFinite(referenceTs)) return true;
            return ts <= referenceTs;
        });

        candidates.sort((a, b) => {
            const left = String(a.date_finished && a.date_finished !== ZERO_DATETIME ? a.date_finished : a.task_datetime || '');
            const right = String(b.date_finished && b.date_finished !== ZERO_DATETIME ? b.date_finished : b.task_datetime || '');
            if (left !== right) return right.localeCompare(left);
            return Number(b.id || 0) - Number(a.id || 0);
        });

        const found = candidates.find((row) => Number(row.meter_reading || 0) > 0);
        if (found) return Number(found.meter_reading || 0) || 0;
    } catch (err) {
        console.warn('Previous meter lookup failed:', err);
    }
    return Number(fallbackBm || 0) || 0;
}

async function fetchLatestSchedtimeLog(scheduleId) {
    try {
        const docs = await queryEquals('tbl_schedtime', 'schedule_id', Number(scheduleId), 'integer', 40);
        const rows = docs.map(parseFirestoreDoc).filter(Boolean);
        if (!rows.length) return null;
        rows.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
        return rows[0];
    } catch (err) {
        console.warn('Schedtime lookup failed:', err);
        return null;
    }
}

function setMachineStatusFromRow(row) {
    const select = document.getElementById('fieldMachineStatus');
    if (!select.options.length) return;
    const byId = Number(row.field_machine_status_id || row.tl_status || 0);
    const byLabel = String(row.field_machine_status || '').trim().toUpperCase();

    let matched = false;
    if (byId > 0) {
        matched = [...select.options].some((opt) => {
            if (Number(opt.value || 0) !== byId) return false;
            opt.selected = true;
            return true;
        });
    }

    if (!matched && byLabel) {
        matched = [...select.options].some((opt) => {
            const label = String(opt.dataset.label || opt.textContent || '').toUpperCase();
            if (label !== byLabel) return false;
            opt.selected = true;
            return true;
        });
    }

    if (!matched) select.selectedIndex = 0;
}

async function openModal(scheduleId) {
    const row = state.rows.find((r) => Number(r.id || 0) === Number(scheduleId));
    if (!row) return;

    state.modalScheduleId = scheduleId;
    state.modalMachineId = Number(row.serial || 0) || null;
    state.modalBranchId = Number(row.branch_id || 0) || null;
    state.modalStatusKey = getStatusKey(row);
    state.modalPartsNeeded = parseSavedPartsList(row.field_parts_needed_json);
    state.modalSchedtimeDocId = null;
    state.modalSchedtimeId = null;

    const branch = caches.branch.get(String(row.branch_id || 0));
    const company = caches.company.get(String(row.company_id || branch?.company_id || 0));
    const trouble = caches.trouble.get(String(row.trouble_id || 0));
    const purposeLabel = PURPOSE_LABELS[row.purpose_id] || `Purpose ${row.purpose_id}`;
    const troubleLabel = trouble?.trouble || (row.trouble_id ? `Trouble ${row.trouble_id}` : 'Unspecified');

    document.getElementById('fieldModalTitle').textContent = `#${row.id} ${purposeLabel} / ${troubleLabel}`;
    document.getElementById('fieldModalSubtitle').textContent = `${company?.companyname || '-'} · ${branch?.branchname || '-'} · ${formatTaskDateTime(row.task_datetime)}`;

    await Promise.all([
        loadMachineStatusOptions(),
        loadPartsCatalog(),
        loadSerialCatalog()
    ]);
    renderPartsList();

    const machine = caches.machine.get(String(state.modalMachineId || 0)) || resolveMachineFromSerial(row.field_serial_selected);
    document.getElementById('fieldSerialInput').value = String(machine?.serial || row.field_serial_selected || '');
    await setModalMachineDetails(machine || null);

    document.getElementById('fieldSerialMissingCheck').checked = Number(row.field_serial_missing || row.serial_correction_pending || 0) === 1;
    document.getElementById('fieldMissingSerialInput').value = String(row.field_serial_missing_value || row.serial_correction_value || '').trim();
    toggleMissingSerialMode();

    setMachineStatusFromRow(row);

    document.getElementById('fieldCloseNotes').value = String(row.field_work_notes || '').trim();
    document.getElementById('fieldDeliveryDetails').value = String(row.field_delivery_details || '').trim();
    document.getElementById('fieldEmptyPickupDetails').value = String(row.field_empty_pickup_details || '').trim();
    document.getElementById('fieldFinalSummary').value = String(row.field_final_summary || '').trim();

    const branchContact = await resolveBranchContact(row.branch_id, row);
    document.getElementById('fieldCustomerSigner').value = String(row.field_customer_signer || row.collocutor || branchContact.contact_name || row.caller || '').trim();
    document.getElementById('fieldCustomerContact').value = String(row.field_customer_contact || row.phone_number || branchContact.contact_phone || '').trim();

    const beforeSaved = String(row.field_before_photo_name || '').trim();
    const afterSaved = String(row.field_after_photo_name || '').trim();
    const beforeInput = document.getElementById('fieldBeforePhoto');
    const afterInput = document.getElementById('fieldAfterPhoto');
    beforeInput.dataset.savedName = beforeSaved;
    afterInput.dataset.savedName = afterSaved;
    updatePhotoHint('fieldBeforePhoto', 'fieldBeforePhotoHint', 'field_before_photo_name');
    updatePhotoHint('fieldAfterPhoto', 'fieldAfterPhotoHint', 'field_after_photo_name');

    const previousMeter = parseIntegerInput(row.field_previous_meter);
    const presentMeter = parseIntegerInput(row.field_present_meter) ?? parseIntegerInput(row.meter_reading);
    if (previousMeter !== null) {
        document.getElementById('fieldPreviousMeter').value = String(previousMeter);
    } else {
        const fallbackBm = Number(machine?.bmeter || 0);
        const prev = await resolvePreviousMeter(Number(row.serial || 0), Number(row.id || 0), row.task_datetime, fallbackBm);
        document.getElementById('fieldPreviousMeter').value = prev > 0 ? String(prev) : '';
    }
    document.getElementById('fieldPresentMeter').value = presentMeter !== null ? String(presentMeter) : '';
    recomputeTotalConsumed();

    const log = await fetchLatestSchedtimeLog(scheduleId);
    if (log) {
        state.modalSchedtimeId = Number(log.id || 0) || null;
        state.modalSchedtimeDocId = log._docId || String(log.id || '');
    }

    const rowTimeIn = String(row.field_time_in || '').trim();
    const rowTimeOut = String(row.field_time_out || '').trim();
    const logTimeIn = String(log?.time_in || '').trim();
    const logTimeOut = String(log?.time_out || '').trim();

    document.getElementById('fieldTimeIn').value = toLocalInputDateTime(rowTimeIn && rowTimeIn !== ZERO_DATETIME ? rowTimeIn : logTimeIn);
    document.getElementById('fieldTimeOut').value = toLocalInputDateTime(rowTimeOut && rowTimeOut !== ZERO_DATETIME ? rowTimeOut : logTimeOut);

    const pinHint = document.getElementById('fieldPinHint');
    pinHint.textContent = 'Checking customer PIN setup...';
    state.modalExpectedPin = await resolveExpectedPin(state.modalBranchId, row);
    if (state.modalExpectedPin) {
        pinHint.textContent = 'Customer PIN is configured. Enter 4-digit PIN to finish.';
    } else {
        pinHint.textContent = 'No branch PIN configured yet. Finished action is blocked. Use Pending and notify office.';
    }

    const isReadOnly = state.modalStatusKey === 'closed' || state.modalStatusKey === 'cancelled';
    setFormDisabled(isReadOnly);
    if (!isReadOnly && !state.modalExpectedPin) {
        document.getElementById('fieldModalCloseTask').disabled = true;
    }

    setModalOpen(true);
}

function getCurrentRow() {
    const scheduleId = Number(state.modalScheduleId || 0);
    if (!scheduleId) return null;
    return state.rows.find((row) => Number(row.id || 0) === scheduleId) || null;
}

function getSelectedMachine() {
    const serialInput = (document.getElementById('fieldSerialInput').value || '').trim();
    const selected = resolveMachineFromSerial(serialInput);
    if (selected) return selected;
    const machineId = Number(state.modalMachineId || 0);
    if (!machineId) return null;
    const cached = caches.machine.get(String(machineId));
    if (!cached) return null;
    return {
        id: machineId,
        serial: String(cached.serial || '').trim(),
        model_id: Number(cached.model_id || 0),
        brand_id: Number(cached.brand_id || 0),
        bmeter: Number(cached.bmeter || 0)
    };
}

function collectModalFormData() {
    const machineSelect = document.getElementById('fieldMachineStatus');
    const statusOption = machineSelect.selectedOptions?.[0] || null;
    const statusLabel = String(statusOption?.dataset?.label || statusOption?.textContent || '').trim();
    const statusId = parseIntegerInput(machineSelect.value) || 0;

    const selectedMachine = getSelectedMachine();
    const serialInput = String(document.getElementById('fieldSerialInput').value || '').trim();
    const missingSerial = String(document.getElementById('fieldMissingSerialInput').value || '').trim().toUpperCase();
    const serialMissing = document.getElementById('fieldSerialMissingCheck').checked;

    const previousMeter = parseIntegerInput(document.getElementById('fieldPreviousMeter').value);
    const presentMeter = parseIntegerInput(document.getElementById('fieldPresentMeter').value);
    const totalConsumed = Number.isFinite(previousMeter) && Number.isFinite(presentMeter)
        ? Math.max(0, presentMeter - previousMeter)
        : 0;

    const timeInLocal = String(document.getElementById('fieldTimeIn').value || '').trim();
    const timeOutLocal = String(document.getElementById('fieldTimeOut').value || '').trim();

    return {
        notes: String(document.getElementById('fieldCloseNotes').value || '').trim(),
        finalSummary: String(document.getElementById('fieldFinalSummary').value || '').trim(),
        deliveryDetails: String(document.getElementById('fieldDeliveryDetails').value || '').trim(),
        emptyPickupDetails: String(document.getElementById('fieldEmptyPickupDetails').value || '').trim(),
        customerSigner: String(document.getElementById('fieldCustomerSigner').value || '').trim(),
        customerContact: String(document.getElementById('fieldCustomerContact').value || '').trim(),
        pin: String(document.getElementById('fieldClosePin').value || '').trim(),
        machineStatusId: statusId,
        machineStatusLabel: statusLabel,
        serialInput,
        serialMissing,
        missingSerial,
        selectedMachineId: Number(selectedMachine?.id || 0) || null,
        selectedMachineSerial: String(selectedMachine?.serial || serialInput || '').trim(),
        previousMeter,
        presentMeter,
        totalConsumed,
        timeInLocal,
        timeOutLocal,
        timeInDb: toDbDateTimeFromLocal(timeInLocal),
        timeOutDb: toDbDateTimeFromLocal(timeOutLocal),
        partsNeeded: state.modalPartsNeeded.map((item) => ({
            key: String(item.key || ''),
            name: String(item.name || '').trim(),
            qty: Math.max(1, parseIntegerInput(item.qty) || 1),
            source: String(item.source || '')
        })),
        beforePhoto: getFileMeta('fieldBeforePhoto'),
        afterPhoto: getFileMeta('fieldAfterPhoto')
    };
}

function buildSchedulePayload(row, form, tag) {
    const staffId = Number(state.staffId || 0) || 0;
    const nowIso = new Date().toISOString();
    const payload = {
        field_work_notes: form.notes,
        field_final_summary: form.finalSummary,
        field_delivery_details: form.deliveryDetails,
        field_empty_pickup_details: form.emptyPickupDetails,
        field_customer_signer: form.customerSigner,
        field_customer_contact: form.customerContact,
        field_machine_status: form.machineStatusLabel,
        field_machine_status_id: form.machineStatusId,
        field_previous_meter: form.previousMeter ?? 0,
        field_present_meter: form.presentMeter ?? 0,
        field_total_consumed: form.totalConsumed ?? 0,
        field_time_in: form.timeInDb || ZERO_DATETIME,
        field_time_out: form.timeOutDb || ZERO_DATETIME,
        field_parts_needed_json: jsonString(form.partsNeeded, '[]'),
        field_before_photo_name: form.beforePhoto?.name || '',
        field_before_photo_size: Number(form.beforePhoto?.size || 0) || 0,
        field_before_photo_type: form.beforePhoto?.type || '',
        field_after_photo_name: form.afterPhoto?.name || '',
        field_after_photo_size: Number(form.afterPhoto?.size || 0) || 0,
        field_after_photo_type: form.afterPhoto?.type || '',
        field_serial_selected: form.selectedMachineSerial || form.serialInput || '',
        field_serial_selected_machine_id: form.selectedMachineId || 0,
        field_serial_missing: form.serialMissing ? 1 : 0,
        field_serial_missing_value: form.missingSerial || '',
        field_updated_by: staffId,
        field_updated_at: nowIso
    };

    if (Number.isFinite(form.presentMeter)) payload.meter_reading = form.presentMeter;
    if (form.customerSigner) payload.collocutor = clampText(form.customerSigner, 255);
    if (form.customerContact) payload.phone_number = clampText(form.customerContact, 255);
    if (form.machineStatusId > 0) payload.tl_status = form.machineStatusId;
    if (form.machineStatusLabel) payload.tl_remarks = clampText(form.machineStatusLabel, 255);
    if (form.finalSummary) payload.customer_request = clampText(form.finalSummary, 255);

    const notesForLog = form.notes || form.finalSummary || '';
    if (tag && notesForLog) {
        payload.dev_remarks = appendDevRemarks(row.dev_remarks, tag, notesForLog);
    }

    return payload;
}

function applyRowPatch(scheduleId, patch) {
    const row = state.rows.find((item) => Number(item.id || 0) === Number(scheduleId || 0));
    if (!row) return;
    Object.assign(row, patch);
}

async function upsertSchedtimeLog(row, form, mode = 'draft') {
    const scheduleId = Number(row.id || 0);
    if (!scheduleId) return;
    const staffId = Number(state.staffId || 0) || 0;

    const hasTimeIn = form.timeInDb && form.timeInDb !== ZERO_DATETIME;
    const hasTimeOut = form.timeOutDb && form.timeOutDb !== ZERO_DATETIME;
    const hasNotes = Boolean(form.notes || form.finalSummary);
    if (!hasTimeIn && !hasTimeOut && !hasNotes) return;

    let logId = Number(state.modalSchedtimeId || 0) || 0;
    let logDocId = state.modalSchedtimeDocId || '';

    if (!logDocId || !logId) {
        const existing = await fetchLatestSchedtimeLog(scheduleId);
        if (existing) {
            logId = Number(existing.id || 0) || logId;
            logDocId = existing._docId || String(existing.id || '');
        }
    }

    if (!logId) {
        logId = Date.now();
    }
    if (!logDocId) logDocId = String(logId);

    const payload = {
        id: logId,
        schedule_id: scheduleId,
        tech_id: Number(row.tech_id || state.staffId || 0) || 0,
        schedule_date: String(row.task_datetime || nowDbDateTime()),
        branch_id: Number(row.branch_id || 0) || 0,
        issupplier: 0,
        time_in: hasTimeIn ? form.timeInDb : ZERO_DATETIME,
        time_out: hasTimeOut ? form.timeOutDb : ZERO_DATETIME,
        remarks: clampText(form.notes || form.finalSummary, 255),
        inserted_by: staffId,
        updated_by: staffId,
        customer_remarks: clampText(form.finalSummary, 255),
        override_remarks: mode === 'finish' ? 'field_finish' : mode === 'pending' ? 'field_pending' : 'field_draft',
        explanation: clampText(form.notes, 255),
        ismanual: 1
    };

    await setDocument('tbl_schedtime', logDocId, payload);
    state.modalSchedtimeId = logId;
    state.modalSchedtimeDocId = logDocId;
}

async function saveDraftUpdate() {
    const row = getCurrentRow();
    if (!row) return;
    const form = collectModalFormData();
    const payload = buildSchedulePayload(row, form, '[FIELD_DRAFT]');

    const button = document.getElementById('fieldModalSaveDraft');
    button.disabled = true;
    try {
        await patchDocument('tbl_schedule', row.id, payload);
        await upsertSchedtimeLog(row, form, 'draft');
        applyRowPatch(row.id, payload);
        renderList();
        alert('Draft update saved.');
    } catch (err) {
        console.error('Save draft failed:', err);
        alert(`Failed to save draft: ${err?.message || err}`);
    } finally {
        button.disabled = false;
    }
}

async function markPendingTask() {
    const row = getCurrentRow();
    if (!row) return;
    const form = collectModalFormData();

    if (form.notes.length < 6) {
        alert('Please add parts-needed/work notes (at least 6 characters).');
        return;
    }

    const staffId = Number(state.staffId || 0) || 0;
    const nowIso = new Date().toISOString();
    const queueDocId = `${row.id}_${Date.now()}`;

    if (!form.timeInLocal) {
        const nowLocal = toLocalInputDateTime(new Date().toISOString());
        document.getElementById('fieldTimeIn').value = nowLocal;
        form.timeInLocal = nowLocal;
        form.timeInDb = toDbDateTimeFromLocal(nowLocal);
    }

    const payload = {
        ...buildSchedulePayload(row, form, '[PENDING_PARTS]'),
        isongoing: 1,
        date_finished: ZERO_DATETIME,
        pending_parts: 1,
        pending_reason: 'parts_needed',
        pending_updated_at: nowIso,
        pending_updated_by: staffId
    };

    const button = document.getElementById('fieldModalPendingTask');
    button.disabled = true;
    try {
        await patchDocument('tbl_schedule', row.id, payload);
        await upsertSchedtimeLog(row, form, 'pending');
        await setDocument(PRODUCTION_QUEUE_COLLECTION, queueDocId, {
            schedule_id: Number(row.id || 0),
            branch_id: Number(row.branch_id || 0) || 0,
            company_id: Number(row.company_id || 0) || 0,
            machine_id: Number(form.selectedMachineId || row.serial || 0) || 0,
            purpose_id: Number(row.purpose_id || 0) || 0,
            trouble_id: Number(row.trouble_id || 0) || 0,
            requested_by: staffId,
            requested_at: nowIso,
            notes: form.notes,
            status: 'pending',
            source: 'field_app',
            parts_needed_json: jsonString(form.partsNeeded, '[]'),
            final_summary: clampText(form.finalSummary, 255),
            machine_status: clampText(form.machineStatusLabel, 120),
            present_meter: form.presentMeter ?? 0,
            previous_meter: form.previousMeter ?? 0,
            total_consumed: form.totalConsumed ?? 0
        });

        applyRowPatch(row.id, payload);
        closeModal();
        await loadMySchedule();
        alert('Marked as Pending (Parts Needed). Production queue updated.');
    } catch (err) {
        console.error('Mark pending failed:', err);
        alert(`Failed to mark pending: ${err?.message || err}`);
    } finally {
        button.disabled = false;
    }
}

async function closeTask() {
    const row = getCurrentRow();
    if (!row) return;
    const form = collectModalFormData();
    const expectedPin = String(state.modalExpectedPin || '').trim();
    const pinPattern = /^\d{4}$/;

    if (!expectedPin) {
        alert('This branch has no configured customer PIN yet. Please mark as Pending and ask office/admin to set branch PIN.');
        return;
    }
    if (!pinPattern.test(form.pin)) {
        alert('Customer PIN must be exactly 4 digits.');
        return;
    }
    if (form.pin !== expectedPin) {
        alert('Invalid customer PIN.');
        return;
    }
    if (!form.customerSigner) {
        alert('Please enter customer representative full name before finish.');
        return;
    }

    if (!form.timeInLocal) {
        const nowLocal = toLocalInputDateTime(new Date().toISOString());
        document.getElementById('fieldTimeIn').value = nowLocal;
        form.timeInLocal = nowLocal;
        form.timeInDb = toDbDateTimeFromLocal(nowLocal);
    }

    const nowLocal = toLocalInputDateTime(new Date().toISOString());
    document.getElementById('fieldTimeOut').value = nowLocal;
    form.timeOutLocal = nowLocal;
    form.timeOutDb = toDbDateTimeFromLocal(nowLocal);

    const nowIso = new Date().toISOString();
    const staffId = Number(state.staffId || 0) || 0;

    const payload = {
        ...buildSchedulePayload(row, form, '[FINISHED]'),
        date_finished: form.timeOutDb,
        closedby: staffId,
        isongoing: 0,
        pending_parts: 0,
        pending_reason: '',
        pending_updated_at: nowIso,
        pending_updated_by: staffId,
        customer_pin_verified: 1,
        customer_pin_verified_at: nowIso,
        customer_pin_verified_by: staffId
    };

    const button = document.getElementById('fieldModalCloseTask');
    button.disabled = true;
    try {
        await patchDocument('tbl_schedule', row.id, payload);
        await upsertSchedtimeLog(row, form, 'finish');
        applyRowPatch(row.id, payload);
        closeModal();
        await loadMySchedule();
        alert('Task marked as Finished.');
    } catch (err) {
        console.error('Close task failed:', err);
        alert(`Failed to close task: ${err?.message || err}`);
    } finally {
        button.disabled = false;
    }
}

async function saveSerialMapping() {
    const row = getCurrentRow();
    if (!row) return;

    const missingMode = document.getElementById('fieldSerialMissingCheck').checked;
    const serialInputValue = String(document.getElementById('fieldSerialInput').value || '').trim();
    const serialHint = document.getElementById('fieldSerialHint');
    const staffId = Number(state.staffId || 0) || 0;
    const nowIso = new Date().toISOString();

    serialHint.textContent = 'Saving...';
    try {
        if (missingMode) {
            const missingSerial = String(document.getElementById('fieldMissingSerialInput').value || '').trim().toUpperCase();
            if (missingSerial.length < 4) {
                alert('Enter missing serial number (at least 4 characters).');
                return;
            }

            const machine = getSelectedMachine();
            const correctionId = `${row.id}_${Date.now()}`;
            await setDocument(SERIAL_CORRECTION_COLLECTION, correctionId, {
                schedule_id: Number(row.id || 0),
                branch_id: Number(row.branch_id || 0) || 0,
                company_id: Number(row.company_id || 0) || 0,
                current_machine_id: Number(machine?.id || row.serial || 0) || 0,
                current_serial: String(machine?.serial || '').trim(),
                requested_serial: missingSerial,
                status: 'pending_admin_approval',
                requested_by: staffId,
                requested_at: nowIso,
                notes: clampText(document.getElementById('fieldCloseNotes').value || '', 255),
                source: 'field_app'
            });

            const patch = {
                serial_correction_pending: 1,
                serial_correction_value: missingSerial,
                serial_correction_requested_at: nowIso,
                serial_correction_requested_by: staffId,
                field_serial_missing: 1,
                field_serial_missing_value: missingSerial
            };
            await patchDocument('tbl_schedule', row.id, patch);
            applyRowPatch(row.id, patch);
            serialHint.textContent = 'Submitted for admin approval.';
            alert('Missing serial submitted for admin approval.');
            return;
        }

        const selectedMachine = resolveMachineFromSerial(serialInputValue);
        if (!selectedMachine || Number(selectedMachine.id || 0) <= 0) {
            alert('Select an official serial from database list.');
            return;
        }

        const patch = {
            serial: Number(selectedMachine.id || 0),
            serial_correction_pending: 0,
            serial_correction_value: '',
            field_serial_selected: String(selectedMachine.serial || ''),
            field_serial_selected_machine_id: Number(selectedMachine.id || 0),
            field_serial_missing: 0,
            field_serial_missing_value: '',
            field_updated_by: staffId,
            field_updated_at: nowIso
        };

        await patchDocument('tbl_schedule', row.id, patch);
        applyRowPatch(row.id, patch);
        await setModalMachineDetails(selectedMachine);

        const prev = await resolvePreviousMeter(Number(selectedMachine.id || 0), Number(row.id || 0), row.task_datetime, Number(selectedMachine.bmeter || 0));
        document.getElementById('fieldPreviousMeter').value = prev > 0 ? String(prev) : '';
        recomputeTotalConsumed();
        renderList();
        serialHint.textContent = 'Serial mapping saved.';
        alert('Serial mapping saved.');
    } catch (err) {
        console.error('Save serial mapping failed:', err);
        serialHint.textContent = `Error: ${err?.message || err}`;
        alert(`Failed to save serial mapping: ${err?.message || err}`);
    }
}

async function markTimeInNow() {
    if (state.modalReadOnly) return;
    const row = getCurrentRow();
    if (!row) return;

    const nowLocal = toLocalInputDateTime(new Date().toISOString());
    document.getElementById('fieldTimeIn').value = nowLocal;

    const form = collectModalFormData();
    const patch = {
        field_time_in: form.timeInDb,
        field_updated_at: new Date().toISOString(),
        field_updated_by: Number(state.staffId || 0) || 0
    };

    const button = document.getElementById('fieldTimeInNowBtn');
    button.disabled = true;
    try {
        await patchDocument('tbl_schedule', row.id, patch);
        await upsertSchedtimeLog(row, form, 'draft');
        applyRowPatch(row.id, patch);
        alert('Time in captured.');
    } catch (err) {
        console.error('Time in failed:', err);
        alert(`Failed to capture time in: ${err?.message || err}`);
    } finally {
        button.disabled = false;
    }
}
