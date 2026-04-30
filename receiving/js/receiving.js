if (!MargaAuth.requireAccess('receiving')) {
    throw new Error('Unauthorized access to Receiving module.');
}

const RECEIVING_QUERY_LIMIT = 5000;
const RECEIVING_ZERO_DATES = new Set(['', '0000-00-00', '0000-00-00 00:00:00', 'null', 'undefined']);

const receivingState = {
    loading: false,
    raw: {
        machines: [],
        branches: [],
        companies: [],
        statuses: [],
        records: []
    },
    maps: {
        machines: new Map(),
        branches: new Map(),
        companies: new Map()
    },
    machineOptions: [],
    pendingOptions: [],
    selectedPulloutMachine: null,
    selectedReceiveMachine: null,
    activePulloutIndex: -1,
    activeReceiveIndex: -1
};

document.addEventListener('DOMContentLoaded', () => {
    hydrateUserChrome();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    bindReceivingControls();
    setDefaultDates();
    loadReceivingData();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;

function hydrateUserChrome() {
    const user = MargaAuth.getUser();
    if (!user) return;
    document.getElementById('userName').textContent = user.name || 'User';
    document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
    document.getElementById('userAvatar').textContent = String(user.name || 'M').charAt(0).toUpperCase();
}

function bindReceivingControls() {
    document.getElementById('receivingRefreshBtn').addEventListener('click', loadReceivingData);
    bindMachineSearch('pulloutSerialInput', 'pulloutMachineResults', 'pullout');
    bindMachineSearch('receiveSerialInput', 'receiveMachineResults', 'receive');
    document.getElementById('pulloutForm').addEventListener('submit', savePendingReturn);
    document.getElementById('officeReceiveForm').addEventListener('submit', saveOfficeReceive);
    document.getElementById('otherReceiveForm').addEventListener('submit', saveOtherReceiving);
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.receiving-machine-field')) hideMachineResults();
    });
}

function bindMachineSearch(inputId, resultId, mode) {
    const input = document.getElementById(inputId);
    input.addEventListener('input', (event) => renderMachineResults(mode, event.target.value));
    input.addEventListener('focus', (event) => renderMachineResults(mode, event.target.value));
    input.addEventListener('keydown', (event) => handleMachineSearchKeydown(event, mode, resultId));
}

function setDefaultDates() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);
    ['pulloutDateInput', 'receivedDateInput'].forEach((id) => {
        const input = document.getElementById(id);
        if (input && !input.value) input.value = date;
    });
    ['pulloutTimeInput', 'receivedTimeInput'].forEach((id) => {
        const input = document.getElementById(id);
        if (input && !input.value) input.value = time;
    });
}

async function loadReceivingData() {
    if (receivingState.loading) return;
    receivingState.loading = true;
    setReceivingStatus('Loading receiving data...');
    try {
        const [machines, branches, companies, statuses, records] = await Promise.all([
            fetchOptionalCollection('tbl_machine', RECEIVING_QUERY_LIMIT),
            fetchOptionalCollection('tbl_branchinfo', 3000),
            fetchOptionalCollection('tbl_companylist', 2000),
            fetchOptionalCollection('tbl_newmachinestatus', 200),
            fetchLatestRows('marga_receiving_records', 500).catch(() => [])
        ]);
        receivingState.raw = { machines, branches, companies, statuses, records };
        receivingState.maps.machines = keyedMap(machines);
        receivingState.maps.branches = keyedMap(branches);
        receivingState.maps.companies = keyedMap(companies);
        rebuildOptions();
        renderPendingReturns();
        const stamp = new Date().toLocaleString('en-PH', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        setReceivingStatus(`Refreshed ${stamp}`);
    } catch (error) {
        console.error('Receiving load failed:', error);
        setReceivingStatus('Load failed. Try Refresh.', true);
    } finally {
        receivingState.loading = false;
    }
}

async function fetchOptionalCollection(collection, pageSize = 500) {
    try {
        return await MargaUtils.fetchCollection(collection, pageSize);
    } catch (error) {
        console.warn(`${collection} unavailable for Receiving.`, error);
        return [];
    }
}

async function fetchLatestRows(collectionId, limit = 500, orderField = 'id') {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId }],
                orderBy: [{ field: { fieldPath: orderField }, direction: 'DESCENDING' }],
                limit
            }
        })
    });
    const payload = await response.json();
    if (!response.ok || payload?.error || payload?.[0]?.error) {
        throw new Error(payload?.error?.message || payload?.[0]?.error?.message || `Failed to query ${collectionId}`);
    }
    return Array.isArray(payload)
        ? payload.map((entry) => entry.document ? MargaUtils.parseFirestoreDoc(entry.document) : null).filter(Boolean)
        : [];
}

function keyedMap(rows) {
    return new Map((rows || []).map((row) => [String(row._docId || row.id || '').trim(), row]).filter(([id]) => id));
}

function rebuildOptions() {
    receivingState.machineOptions = (receivingState.raw.machines || [])
        .map((machine) => makeMachineOption(machine))
        .filter((option) => option.serial)
        .sort((left, right) => left.serial.localeCompare(right.serial, undefined, { numeric: true }));
    receivingState.pendingOptions = receivingState.machineOptions.filter((option) => option.machine.return_status === 'pending_return');
}

function makeMachineOption(machine) {
    const serial = clean(machine.serial);
    const model = clean(machine.description);
    const customer = resolveMachineCustomer(machine);
    const status = statusLabel(machine.status_id);
    return {
        id: String(machine._docId || machine.id || '').trim(),
        serial,
        model,
        customer,
        status,
        machine,
        searchText: [serial, model, customer, status, machine.id, machine.return_pickup_receipt].join(' ').toLowerCase()
    };
}

function renderPendingReturns() {
    const rows = receivingState.pendingOptions;
    document.getElementById('pendingReturnCount').textContent = rows.length;
    document.getElementById('receivingSubtitle').textContent = `${rows.length} pending machine return(s), ${receivingState.raw.records.length} recent receiving record(s).`;
    const tbody = document.getElementById('pendingReturnBody');
    if (!rows.length) {
        tbody.innerHTML = '<tr class="receiving-empty"><td colspan="6">No pending machine returns.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map((option) => {
        const machine = option.machine;
        return `
            <tr>
                <td>${escapeHtml(option.serial)}</td>
                <td>${escapeHtml(option.model || '-')}</td>
                <td>${escapeHtml(machine.return_previous_customer || option.customer || '-')}</td>
                <td>${escapeHtml(machine.return_pulled_out_by || '-')}</td>
                <td>${escapeHtml(machine.return_pickup_receipt || '-')}</td>
                <td>${escapeHtml(formatAge(ageInDays(machine.return_pullout_at || machine.return_pullout_date)))}</td>
            </tr>
        `;
    }).join('');
}

function renderMachineResults(mode, value) {
    const isReceive = mode === 'receive';
    const results = document.getElementById(isReceive ? 'receiveMachineResults' : 'pulloutMachineResults');
    const options = getMachineMatches(value, isReceive ? receivingState.pendingOptions : receivingState.machineOptions);
    receivingState[isReceive ? 'activeReceiveIndex' : 'activePulloutIndex'] = options.length ? 0 : -1;
    if (!options.length) {
        results.innerHTML = '<div class="receiving-option"><span>No matching machine found.</span></div>';
        results.classList.remove('hidden');
        return;
    }
    results.innerHTML = options.map((option, index) => `
        <button type="button" class="receiving-option ${index === 0 ? 'is-active' : ''}" data-machine-id="${escapeAttr(option.id)}">
            <strong>${escapeHtml(option.serial)} - ${escapeHtml(option.model || 'No model')}</strong>
            <span>${escapeHtml(option.customer || option.status || 'No customer link')}</span>
        </button>
    `).join('');
    results.classList.remove('hidden');
    results.querySelectorAll('.receiving-option').forEach((button) => {
        button.addEventListener('click', () => selectMachine(mode, button.dataset.machineId));
    });
}

function getMachineMatches(value, options) {
    const query = clean(value).toLowerCase();
    const looseQuery = normalizeLoose(value);
    if (!query && !looseQuery) return options.slice(0, 80);
    return options
        .filter((option) => option.searchText.includes(query) || normalizeLoose(option.searchText).includes(looseQuery))
        .slice(0, 80);
}

function handleMachineSearchKeydown(event, mode, resultId) {
    const results = document.getElementById(resultId);
    if (!results || results.classList.contains('hidden')) return;
    const options = [...results.querySelectorAll('.receiving-option[data-machine-id]')];
    if (!options.length) return;
    const key = mode === 'receive' ? 'activeReceiveIndex' : 'activePulloutIndex';
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        receivingState[key] = (receivingState[key] + direction + options.length) % options.length;
        options.forEach((option, index) => option.classList.toggle('is-active', index === receivingState[key]));
        options[receivingState[key]]?.scrollIntoView({ block: 'nearest' });
    }
    if (event.key === 'Enter') {
        event.preventDefault();
        const active = options[receivingState[key]] || options[0];
        selectMachine(mode, active.dataset.machineId);
    }
    if (event.key === 'Escape') hideMachineResults();
}

function selectMachine(mode, machineId) {
    const option = (mode === 'receive' ? receivingState.pendingOptions : receivingState.machineOptions)
        .find((entry) => entry.id === String(machineId));
    if (!option) return;
    if (mode === 'receive') {
        receivingState.selectedReceiveMachine = option.machine;
        document.getElementById('receiveSerialInput').value = option.serial;
        document.getElementById('receiveMachineContext').textContent = `${option.serial} - ${option.model || '-'} - ${option.machine.return_previous_customer || option.customer || 'Pending return'}`;
    } else {
        receivingState.selectedPulloutMachine = option.machine;
        document.getElementById('pulloutSerialInput').value = option.serial;
        document.getElementById('pulloutMachineContext').textContent = `${option.serial} - ${option.model || '-'} - ${option.customer || 'No active customer link found'}`;
    }
    hideMachineResults();
}

function hideMachineResults() {
    document.getElementById('pulloutMachineResults')?.classList.add('hidden');
    document.getElementById('receiveMachineResults')?.classList.add('hidden');
}

async function savePendingReturn(event) {
    event.preventDefault();
    const machine = receivingState.selectedPulloutMachine || findMachineBySerial(document.getElementById('pulloutSerialInput').value);
    if (!machine) {
        alert('Select the pulled-out machine serial first.');
        return;
    }
    const now = new Date().toISOString();
    const date = clean(document.getElementById('pulloutDateInput').value);
    const time = clean(document.getElementById('pulloutTimeInput').value);
    const pulledBy = clean(document.getElementById('pulloutByInput').value);
    const rep = clean(document.getElementById('pulloutRepInput').value);
    const receipt = clean(document.getElementById('pulloutReceiptInput').value);
    const remarks = clean(document.getElementById('pulloutRemarksInput').value);
    if (!date || !time || !pulledBy || !rep || !receipt) {
        alert('Pulled out by, customer representative, date/time, and pickup receipt are required.');
        return;
    }
    const docId = machineDocId(machine);
    const previousCustomer = resolveMachineCustomer(machine);
    const previousClientId = Number(machine.client_id || machine.branch_id || 0) || 0;
    const previousCompanyId = Number(machine.company_id || 0) || 0;
    const fields = {
        client_id: 0,
        branch_id: 0,
        company_id: 0,
        isclient: 0,
        return_status: 'pending_return',
        return_pullout_at: `${date} ${time}:00`,
        return_pullout_date: date,
        return_pullout_time: time,
        return_pulled_out_by: pulledBy,
        return_customer_representative: rep,
        return_pickup_receipt: receipt,
        return_remarks: remarks,
        return_previous_customer: previousCustomer,
        return_previous_client_id: previousClientId,
        return_previous_company_id: previousCompanyId,
        return_logged_at: now,
        return_logged_by: currentUserLabel(),
        production_customer_unlinked_at: now,
        production_customer_unlinked_by: currentUserLabel(),
        tmestamp: now
    };
    await patchDocument('tbl_machine', docId, fields, {
        label: `Pending return ${clean(machine.serial)}`,
        dedupeKey: `receiving-pending-return:${docId}:${receipt}`
    });
    await createReceivingRecord({
        record_type: 'customer_machine_pullout',
        machine_id: Number(machine.id || machine._docId || 0) || machine.id || machine._docId || '',
        serial: clean(machine.serial),
        model: clean(machine.description),
        previous_customer: previousCustomer,
        pulled_out_by: pulledBy,
        customer_representative: rep,
        pickup_receipt: receipt,
        event_at: `${date} ${time}:00`,
        remarks
    });
    Object.assign(machine, fields);
    rebuildOptions();
    renderPendingReturns();
    event.target.reset();
    setDefaultDates();
    receivingState.selectedPulloutMachine = null;
    document.getElementById('pulloutMachineContext').textContent = 'Select the old customer machine being pulled out.';
    MargaUtils.showToast('Machine marked pending return.', 'success');
}

async function saveOfficeReceive(event) {
    event.preventDefault();
    const machine = receivingState.selectedReceiveMachine || findMachineBySerial(document.getElementById('receiveSerialInput').value);
    if (!machine || machine.return_status !== 'pending_return') {
        alert('Select a machine from Pending Return first.');
        return;
    }
    const now = new Date().toISOString();
    const date = clean(document.getElementById('receivedDateInput').value);
    const time = clean(document.getElementById('receivedTimeInput').value);
    const receivedBy = clean(document.getElementById('receivedByInput').value);
    const condition = clean(document.getElementById('receivedConditionInput').value);
    const remarks = clean(document.getElementById('receivedRemarksInput').value);
    if (!date || !time || !receivedBy) {
        alert('Received by and received date/time are required.');
        return;
    }
    const docId = machineDocId(machine);
    const fields = {
        status_id: 7,
        return_status: 'received_by_office',
        receiving_status: 'for_overhauling',
        receiving_condition: condition,
        receiving_received_by: receivedBy,
        receiving_received_at: `${date} ${time}:00`,
        receiving_remarks: remarks,
        production_received_at: now,
        production_received_by: currentUserLabel(),
        tmestamp: now
    };
    await patchDocument('tbl_machine', docId, fields, {
        label: `Receive returned machine ${clean(machine.serial)}`,
        dedupeKey: `receiving-office-receive:${docId}:${date}:${time}`
    });
    await createMachineHistoryStatusRow(machine, { date, time, receivedBy, condition, remarks, now });
    await createReceivingRecord({
        record_type: 'machine_received_by_office',
        machine_id: Number(machine.id || machine._docId || 0) || machine.id || machine._docId || '',
        serial: clean(machine.serial),
        model: clean(machine.description),
        previous_customer: clean(machine.return_previous_customer),
        pickup_receipt: clean(machine.return_pickup_receipt),
        received_by: receivedBy,
        condition,
        event_at: `${date} ${time}:00`,
        remarks
    });
    Object.assign(machine, fields);
    rebuildOptions();
    renderPendingReturns();
    event.target.reset();
    setDefaultDates();
    receivingState.selectedReceiveMachine = null;
    document.getElementById('receiveMachineContext').textContent = 'Select a pending return machine received by the office.';
    MargaUtils.showToast('Machine received to For Overhauling.', 'success');
}

async function saveOtherReceiving(event) {
    event.preventDefault();
    const payload = {
        record_type: clean(document.getElementById('otherTypeInput').value),
        reference_no: clean(document.getElementById('otherReferenceInput').value),
        received_from: clean(document.getElementById('otherSourceInput').value),
        qty: Number(document.getElementById('otherQtyInput').value || 1) || 1,
        description: clean(document.getElementById('otherDescriptionInput').value),
        remarks: clean(document.getElementById('otherNotesInput').value),
        event_at: new Date().toISOString()
    };
    if (!payload.received_from || !payload.description) {
        alert('Received From and Description are required.');
        return;
    }
    await createReceivingRecord(payload);
    event.target.reset();
    document.getElementById('otherQtyInput').value = '1';
    MargaUtils.showToast('Receiving log saved.', 'success');
}

async function createMachineHistoryStatusRow(machine, receive) {
    const historyId = await allocateNextId('tbl_newmachinehistory');
    const machineId = Number(machine.id || machine._docId || 0) || machine.id || machine._docId || '';
    await setDocument('tbl_newmachinehistory', String(historyId), {
        id: historyId,
        mach_id: machineId,
        machinerepair_id: 0,
        dr_number: 0,
        status_id: 7,
        tech_id: 0,
        datex: `${receive.date} 00:00:00`,
        branch_id: Number(machine.return_previous_client_id || 0) || 0,
        tmstmp: `${receive.date} ${receive.time}:00`,
        fromx: 0,
        remarks: ['RECEIVED BY OFFICE', receive.receivedBy, machine.return_pickup_receipt, receive.remarks].filter(Boolean).join(' - '),
        condition_id: receive.condition === 'brand_new_waste_tank' ? 1 : 0,
        receiving_condition: receive.condition,
        receiving_created_at: receive.now,
        receiving_created_by: currentUserLabel()
    }, {
        label: `History receive ${clean(machine.serial)}`,
        dedupeKey: `receiving-history:${machineId}:${receive.date}:${receive.time}`
    });
}

async function createReceivingRecord(fields) {
    const id = await allocateNextId('marga_receiving_records');
    const now = new Date().toISOString();
    await setDocument('marga_receiving_records', String(id), {
        id,
        status: 'active',
        created_at: now,
        created_by: currentUserLabel(),
        ...fields
    }, {
        label: `Receiving ${fields.record_type || id}`,
        dedupeKey: `receiving-record:${fields.record_type}:${fields.serial || fields.reference_no || id}:${fields.event_at || now}`
    });
}

function findMachineBySerial(value) {
    const serial = normalizeSerial(value);
    if (!serial) return null;
    return (receivingState.raw.machines || []).find((machine) => normalizeSerial(machine.serial) === serial) || null;
}

function machineDocId(machine) {
    const docId = String(machine?._docId || machine?.id || '').trim();
    if (!docId) throw new Error('Machine document id is missing.');
    return docId;
}

function resolveMachineCustomer(machine) {
    if (!machine) return '';
    const branch = receivingState.maps.branches.get(String(machine.branch_id || machine.client_id || '')) || null;
    const company = receivingState.maps.companies.get(String(machine.company_id || branch?.company_id || '')) || null;
    return buildClientName(company, branch);
}

function buildClientName(company, branch) {
    const companyName = clean(company?.companyname || company?.business_style || company?.name);
    const branchName = clean(branch?.branchname || branch?.branch || branch?.departmentname);
    if (!companyName) return branchName;
    if (!branchName || branchName.toLowerCase() === 'main') return companyName;
    if (normalizeLoose(branchName).includes(normalizeLoose(companyName))) return branchName;
    return `${companyName} - ${branchName}`;
}

function statusLabel(statusId) {
    const status = (receivingState.raw.statuses || []).find((row) => Number(row.id || 0) === Number(statusId || 0));
    return clean(status?.status) || `Status ${statusId || 0}`;
}

function firstDateValue(...values) {
    return values.find((value) => {
        const text = clean(value);
        return text && !RECEIVING_ZERO_DATES.has(text.toLowerCase());
    }) || '';
}

function ageInDays(value) {
    const text = firstDateValue(value);
    if (!text) return '';
    const parsed = new Date(text.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return '';
    const diff = Date.now() - parsed.getTime();
    if (diff < 0) return 0;
    return Math.floor(diff / 86400000);
}

function formatAge(age) {
    if (age === '' || age === null || age === undefined) return '-';
    return String(age);
}

function currentUserLabel() {
    const user = MargaAuth.getUser();
    return clean(user?.email || user?.username || user?.name || 'receiving');
}

function normalizeSerial(value) {
    return clean(value).replace(/\s+/g, '').toUpperCase();
}

function normalizeLoose(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
    return MargaUtils.escapeHtml(String(value ?? ''));
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
}

function setReceivingStatus(message, isError = false) {
    const pill = document.getElementById('receivingStatusPill');
    pill.textContent = message;
    pill.classList.toggle('is-error', isError);
}

function toFirestoreFieldValue(value) {
    if (value === null) return { nullValue: null };
    if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => toFirestoreFieldValue(entry)) } };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number' && Number.isFinite(value)) {
        if (Number.isInteger(value)) return { integerValue: String(value) };
        return { doubleValue: value };
    }
    return { stringValue: String(value ?? '') };
}

async function patchDocument(collection, docId, fields, options = {}) {
    if (window.MargaOfflineSync?.writeFirestoreDoc) {
        return window.MargaOfflineSync.writeFirestoreDoc({
            mode: 'patch',
            collection,
            docId,
            fields,
            label: options.label,
            dedupeKey: options.dedupeKey
        });
    }
    const updateKeys = Object.keys(fields);
    const params = updateKeys.map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
    const body = { fields: {} };
    updateKeys.forEach((key) => {
        body.fields[key] = toFirestoreFieldValue(fields[key]);
    });
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(String(docId))}?key=${FIREBASE_CONFIG.apiKey}&${params}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to update ${collection}/${docId}`);
    return payload;
}

async function setDocument(collection, docId, fields, options = {}) {
    if (window.MargaOfflineSync?.writeFirestoreDoc) {
        return window.MargaOfflineSync.writeFirestoreDoc({
            mode: 'set',
            collection,
            docId,
            fields,
            label: options.label,
            dedupeKey: options.dedupeKey
        });
    }
    const body = { fields: {} };
    Object.entries(fields).forEach(([key, value]) => {
        body.fields[key] = toFirestoreFieldValue(value);
    });
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(String(docId))}?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `Failed to set ${collection}/${docId}`);
    return payload;
}

async function allocateNextId(collection) {
    try {
        const latest = await fetchLatestRows(collection, 1);
        const next = Number(latest[0]?.id || latest[0]?._docId || 0) + 1;
        if (Number.isFinite(next) && next > 0) return next;
    } catch (error) {
        console.warn(`Latest id lookup failed for ${collection}.`, error);
    }
    return Date.now();
}
