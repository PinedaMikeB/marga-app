if (!MargaAuth.requireAccess('field')) {
    throw new Error('Unauthorized access to field module.');
}

const FIELD_QUERY_LIMIT = 5000;
const FIELD_CARRYOVER_DAYS = 14;
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

const caches = {
    trouble: new Map(),
    branch: new Map(),
    company: new Map(),
    area: new Map(),
    machine: new Map(),
    model: new Map(),
    brand: new Map()
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
    modalStatusKey: 'pending'
};

document.addEventListener('DOMContentLoaded', () => {
    const user = MargaAuth.getUser();
    state.staffId = Number(user?.staff_id || 0) || null;
    if (!state.staffId) {
        alert('This account has no staff_id mapped. Please update marga_users with staff_id.');
    }

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
    document.getElementById('fieldModalPendingTask').addEventListener('click', markPendingTask);
    document.getElementById('fieldModalCloseTask').addEventListener('click', closeTask);
    document.getElementById('fieldSaveSerialBtn').addEventListener('click', saveCorrectedSerial);

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
        const machineSerial = machine?.serial || '-';
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

function setModalOpen(isOpen) {
    const overlay = document.getElementById('fieldOverlay');
    const modal = document.getElementById('fieldModal');
    modal.classList.toggle('open', isOpen);
    overlay.classList.toggle('visible', isOpen);
    modal.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function closeModal() {
    setModalOpen(false);
    state.modalScheduleId = null;
    state.modalMachineId = null;
    state.modalBranchId = null;
    state.modalExpectedPin = '';
    state.modalStatusKey = 'pending';
    document.getElementById('fieldCloseNotes').value = '';
    document.getElementById('fieldClosePin').value = '';
    document.getElementById('fieldSerialInput').value = '';
    document.getElementById('fieldSerialHint').textContent = '';
    document.getElementById('fieldPinHint').textContent = 'Required to mark as Finished.';
    document.getElementById('fieldCloseNotes').disabled = false;
    document.getElementById('fieldClosePin').disabled = false;
    document.getElementById('fieldSerialInput').disabled = false;
    document.getElementById('fieldSaveSerialBtn').disabled = false;
    document.getElementById('fieldModalPendingTask').disabled = false;
    document.getElementById('fieldModalCloseTask').disabled = false;
}

async function resolveExpectedPin(branchId, row = null) {
    const schedulePin = String(row?.customer_pin || '').trim();
    if (schedulePin) return schedulePin;

    const fromBranch = caches.branch.get(String(branchId || 0));
    const inlinePin = String(fromBranch?.service_pin || '').trim();
    if (inlinePin) return inlinePin;

    if (!branchId) return '';
    const pinDoc = await fetchDoc('marga_branch_pins', branchId);
    const savedPin = String(pinDoc?.pin || '').trim();
    return savedPin;
}

async function openModal(scheduleId) {
    const row = state.rows.find((r) => Number(r.id || 0) === Number(scheduleId));
    if (!row) return;

    state.modalScheduleId = scheduleId;
    state.modalMachineId = Number(row.serial || 0) || null;
    state.modalBranchId = Number(row.branch_id || 0) || null;
    state.modalStatusKey = getStatusKey(row);

    const branch = caches.branch.get(String(row.branch_id || 0));
    const company = caches.company.get(String(row.company_id || branch?.company_id || 0));
    const trouble = caches.trouble.get(String(row.trouble_id || 0));
    const purposeLabel = PURPOSE_LABELS[row.purpose_id] || `Purpose ${row.purpose_id}`;
    const troubleLabel = trouble?.trouble || (row.trouble_id ? `Trouble ${row.trouble_id}` : 'Unspecified');

    document.getElementById('fieldModalTitle').textContent = `#${row.id} ${purposeLabel} / ${troubleLabel}`;
    document.getElementById('fieldModalSubtitle').textContent = `${company?.companyname || '-'} · ${branch?.branchname || '-'} · ${formatTaskDateTime(row.task_datetime)}`;

    const machine = caches.machine.get(String(state.modalMachineId || 0));
    document.getElementById('fieldSerialInput').value = String(machine?.serial || '');

    const pinHint = document.getElementById('fieldPinHint');
    pinHint.textContent = 'Checking customer PIN setup...';
    state.modalExpectedPin = await resolveExpectedPin(state.modalBranchId, row);
    if (state.modalExpectedPin) {
        pinHint.textContent = 'Customer PIN is configured. Enter 4-digit PIN to finish.';
    } else {
        pinHint.textContent = 'No branch PIN configured yet. Finished action is blocked. Use Pending and notify office.';
    }

    const isReadOnly = state.modalStatusKey === 'closed' || state.modalStatusKey === 'cancelled';
    document.getElementById('fieldCloseNotes').disabled = isReadOnly;
    document.getElementById('fieldClosePin').disabled = isReadOnly;
    document.getElementById('fieldSerialInput').disabled = isReadOnly;
    document.getElementById('fieldSaveSerialBtn').disabled = isReadOnly;
    document.getElementById('fieldModalPendingTask').disabled = isReadOnly;
    document.getElementById('fieldModalCloseTask').disabled = isReadOnly || !state.modalExpectedPin;

    setModalOpen(true);
}

async function markPendingTask() {
    const scheduleId = Number(state.modalScheduleId || 0);
    if (!scheduleId) return;
    const row = state.rows.find((r) => Number(r.id || 0) === scheduleId);
    if (!row) return;

    const notes = (document.getElementById('fieldCloseNotes').value || '').trim();
    if (notes.length < 6) {
        alert('Please add parts-needed notes (at least 6 characters).');
        return;
    }

    const staffId = Number(state.staffId || 0) || 0;
    const nowIso = new Date().toISOString();
    const queueDocId = `${scheduleId}_${Date.now()}`;

    const btn = document.getElementById('fieldModalPendingTask');
    btn.disabled = true;
    try {
        await patchDocument('tbl_schedule', scheduleId, {
            isongoing: 1,
            date_finished: ZERO_DATETIME,
            pending_parts: 1,
            pending_reason: 'parts_needed',
            pending_updated_at: nowIso,
            pending_updated_by: staffId,
            dev_remarks: appendDevRemarks(row.dev_remarks, '[PENDING_PARTS]', notes)
        });

        await setDocument('marga_production_queue', queueDocId, {
            schedule_id: scheduleId,
            branch_id: Number(row.branch_id || 0) || null,
            company_id: Number(row.company_id || 0) || null,
            machine_id: Number(row.serial || 0) || null,
            purpose_id: Number(row.purpose_id || 0) || null,
            trouble_id: Number(row.trouble_id || 0) || null,
            requested_by: staffId,
            requested_at: nowIso,
            notes,
            status: 'pending',
            source: 'field_app'
        });

        closeModal();
        await loadMySchedule();
        alert('Marked as Pending (Parts Needed). Production queue updated.');
    } catch (err) {
        console.error('Mark pending failed:', err);
        alert(`Failed to mark pending: ${err?.message || err}`);
    } finally {
        btn.disabled = false;
    }
}

async function closeTask() {
    const scheduleId = Number(state.modalScheduleId || 0);
    if (!scheduleId) return;
    const row = state.rows.find((r) => Number(r.id || 0) === scheduleId);
    if (!row) return;

    const notes = (document.getElementById('fieldCloseNotes').value || '').trim();
    const pin = (document.getElementById('fieldClosePin').value || '').trim();
    const expectedPin = String(state.modalExpectedPin || '').trim();
    const pinPattern = /^\d{4}$/;

    if (!expectedPin) {
        alert('This branch has no configured customer PIN yet. Please mark as Pending and ask office/admin to set branch PIN.');
        return;
    }
    if (!pinPattern.test(pin)) {
        alert('Customer PIN must be exactly 4 digits.');
        return;
    }
    if (pin !== expectedPin) {
        alert('Invalid customer PIN.');
        return;
    }

    const nowIso = new Date().toISOString();
    const now = new Date();
    const ymd = formatDateYmd(now);
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const finished = `${ymd} ${hh}:${mm}:${ss}`;

    const staffId = Number(state.staffId || 0) || 0;

    const btn = document.getElementById('fieldModalCloseTask');
    btn.disabled = true;
    try {
        await patchDocument('tbl_schedule', scheduleId, {
            date_finished: finished,
            closedby: staffId,
            isongoing: 0,
            pending_parts: 0,
            pending_reason: '',
            pending_updated_at: nowIso,
            pending_updated_by: staffId,
            customer_pin_verified: 1,
            customer_pin_verified_at: nowIso,
            customer_pin_verified_by: staffId,
            dev_remarks: appendDevRemarks(row.dev_remarks, '[FINISHED]', notes)
        });
        closeModal();
        await loadMySchedule();
        alert('Task marked as Finished.');
    } catch (err) {
        console.error('Close task failed:', err);
        alert(`Failed to close task: ${err?.message || err}`);
    } finally {
        btn.disabled = false;
    }
}

async function saveCorrectedSerial() {
    const machineId = Number(state.modalMachineId || 0);
    if (!machineId) return;

    let next = (document.getElementById('fieldSerialInput').value || '').trim();
    if (!next) {
        alert('Serial cannot be empty.');
        return;
    }
    next = next.toUpperCase();

    const hint = document.getElementById('fieldSerialHint');
    hint.textContent = 'Checking duplicate...';

    try {
        // Check duplicate by querying serial equality (single-field filter, no composite index needed).
        const structuredQuery = {
            from: [{ collectionId: 'tbl_machine' }],
            where: {
                fieldFilter: {
                    field: { fieldPath: 'serial' },
                    op: 'EQUAL',
                    value: { stringValue: next }
                }
            },
            limit: 1
        };
        const docs = await runQuery(structuredQuery);
        const found = docs.map(parseFirestoreDoc).filter(Boolean)[0] || null;
        if (found && Number(found.id || 0) !== machineId) {
            hint.textContent = `Duplicate serial found on machine #${found.id}.`;
            alert(`Duplicate serial found on machine #${found.id}.`);
            return;
        }

        await patchDocument('tbl_machine', machineId, { serial: next });
        const machine = caches.machine.get(String(machineId)) || {};
        caches.machine.set(String(machineId), { ...machine, serial: next });
        hint.textContent = 'Serial updated.';
        alert('Serial updated.');
        renderList();
    } catch (err) {
        console.error('Save serial failed:', err);
        hint.textContent = `Error: ${err?.message || err}`;
        alert(`Failed to update serial: ${err?.message || err}`);
    }
}
