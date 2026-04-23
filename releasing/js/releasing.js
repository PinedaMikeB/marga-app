if (!MargaAuth.requireAccess('releasing')) {
    throw new Error('Unauthorized access to Releasing module.');
}

const RELEASE_QUERY_LIMIT = 5000;
const RELEASE_ROWS_PER_VIEW = 600;
const RELEASE_ZERO_DATES = new Set([
    '',
    '0000-00-00',
    '0000-00-00 00:00:00',
    'undefined 00:00:00',
    'null 00:00:00',
    'invalid date'
]);

const RELEASE_PURPOSE_LABELS = {
    3: 'TONER / INK',
    4: 'CARTRIDGE'
};

const releaseState = {
    loading: false,
    rows: [],
    viewRows: [],
    createRows: [],
    selectedDetailKey: '',
    contextRowKey: '',
    detailDrafts: new Map(),
    savedFinalRefs: new Set(),
    referenceFetches: new Set(),
    raw: {
        schedules: [],
        requestItems: [],
        finalDrs: [],
        models: []
    },
    maps: {
        branches: new Map(),
        companies: new Map(),
        machines: new Map(),
        troubles: new Map()
    },
    filters: {
        search: '',
        cartridgeOnly: false,
        urgentOnly: false,
        backJobOnly: false
    },
    pendingPreview: null
};

document.addEventListener('DOMContentLoaded', () => {
    hydrateUserChrome();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    bindReleaseControls();
    loadReleasingData();
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

function bindReleaseControls() {
    document.getElementById('releaseRefreshBtn').addEventListener('click', () => loadReleasingData());
    document.getElementById('releasePrintBtn').addEventListener('click', openReleasePreview);
    document.getElementById('releaseSearchBtn').addEventListener('click', () => {
        const value = clean(document.getElementById('releaseSearchInput').value);
        maybeLoadExactReference(value);
        releaseState.filters.search = value.toLowerCase();
        renderReleaseTables();
    });
    document.getElementById('releaseSearchInput').addEventListener('input', MargaUtils.debounce((event) => {
        releaseState.filters.search = clean(event.target.value).toLowerCase();
        maybeLoadExactReference(clean(event.target.value));
        renderReleaseTables();
    }, 180));
    document.getElementById('releaseCartridgeFilter').addEventListener('change', (event) => {
        releaseState.filters.cartridgeOnly = event.target.checked;
        renderReleaseTables();
    });
    document.getElementById('releaseUrgentFilter').addEventListener('change', (event) => {
        releaseState.filters.urgentOnly = event.target.checked;
        renderReleaseTables();
    });
    document.getElementById('releaseBackJobFilter').addEventListener('change', (event) => {
        releaseState.filters.backJobOnly = event.target.checked;
        renderReleaseTables();
    });

    document.getElementById('releaseContextAddBtn').addEventListener('click', () => {
        addRowToCreate(releaseState.contextRowKey);
        hideReleaseContextMenu();
    });
    document.getElementById('releaseContextEditBtn').addEventListener('click', () => {
        const key = releaseState.contextRowKey;
        hideReleaseContextMenu();
        openReleaseDetailModal(key);
    });
    document.addEventListener('click', (event) => {
        if (!event.target.closest('#releaseContextMenu')) hideReleaseContextMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideReleaseContextMenu();
    });
    window.addEventListener('scroll', hideReleaseContextMenu, true);

    document.getElementById('releaseDetailOverlay').addEventListener('click', closeReleaseDetailModal);
    document.getElementById('releaseDetailCloseBtn').addEventListener('click', closeReleaseDetailModal);
    document.getElementById('releaseDetailCancelBtn').addEventListener('click', closeReleaseDetailModal);
    document.getElementById('releaseDetailForm').addEventListener('submit', saveReleaseDetail);

    document.getElementById('releasePreviewOverlay').addEventListener('click', closeReleasePreview);
    document.getElementById('releasePreviewCloseBtn').addEventListener('click', closeReleasePreview);
    document.getElementById('releasePreviewCancelBtn').addEventListener('click', closeReleasePreview);
    document.getElementById('releasePreviewPrintBtn').addEventListener('click', printAndSaveRelease);
}

async function loadReleasingData() {
    if (releaseState.loading) return;
    releaseState.loading = true;
    setReleaseStatus('Loading DR requests...');
    setReleaseLoadingRows();

    try {
        const [schedules, requestItems, finalDrs, branches, companies, machines, troubles, models] = await Promise.all([
            fetchLatestRows('tbl_schedule', RELEASE_QUERY_LIMIT),
            fetchLatestRows('tbl_newfordr', RELEASE_QUERY_LIMIT).catch(() => []),
            fetchLatestRows('tbl_finaldr', RELEASE_QUERY_LIMIT).catch(() => []),
            fetchOptionalCollection('tbl_branchinfo', 1200),
            fetchOptionalCollection('tbl_companylist', 1000),
            fetchOptionalCollection('tbl_machine', 1200),
            fetchOptionalCollection('tbl_trouble', 900),
            fetchOptionalCollection('tbl_model', 600)
        ]);

        releaseState.raw = { schedules, requestItems, finalDrs, models };
        releaseState.maps.branches = keyedMap(branches);
        releaseState.maps.companies = keyedMap(companies);
        releaseState.maps.machines = keyedMap(machines);
        releaseState.maps.troubles = keyedMap(troubles);
        releaseState.savedFinalRefs = new Set(
            finalDrs
                .filter((row) => Number(row.iscancelled || 0) !== 1)
                .map((row) => String(row.reference_id || '').trim())
                .filter(Boolean)
        );
        buildReleaseRows();
        populateModelDatalist();
        renderReleaseTables();

        const stamp = new Date().toLocaleString('en-PH', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        setReleaseStatus(`Refreshed ${stamp}`);
    } catch (error) {
        console.error('Releasing load failed:', error);
        setReleaseStatus('Load failed. Try Refresh.', true);
        document.getElementById('releaseSubtitle').textContent = 'Unable to load DR requests.';
    } finally {
        releaseState.loading = false;
    }
}

async function fetchOptionalCollection(collection, pageSize = 500) {
    try {
        return await MargaUtils.fetchCollection(collection, pageSize);
    } catch (error) {
        console.warn(`${collection} unavailable for Releasing.`, error);
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

async function queryEqualsLimit(collectionId, fieldPath, value, limit = 50) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId }],
                where: {
                    fieldFilter: {
                        field: { fieldPath },
                        op: 'EQUAL',
                        value: toFirestoreFieldValue(value)
                    }
                },
                limit
            }
        })
    });
    const payload = await response.json();
    if (!response.ok || payload?.error || payload?.[0]?.error) return [];
    return Array.isArray(payload)
        ? payload.map((entry) => entry.document ? MargaUtils.parseFirestoreDoc(entry.document) : null).filter(Boolean)
        : [];
}

async function fetchDoc(collection, docId) {
    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(String(docId))}?key=${FIREBASE_CONFIG.apiKey}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.error) return null;
    return MargaUtils.parseFirestoreDoc(payload);
}

function keyedMap(rows) {
    return new Map(
        (rows || [])
            .map((row) => [String(row._docId || row.id || '').trim(), row])
            .filter(([id]) => id)
    );
}

function buildReleaseRows() {
    const schedulesByRef = new Map(
        (releaseState.raw.schedules || [])
            .map((row) => [String(row.id || row._docId || '').trim(), row])
            .filter(([id]) => id)
    );
    const itemRows = [];
    const itemScheduleRefs = new Set();

    (releaseState.raw.requestItems || []).forEach((item) => {
        if (!isActiveRequestItem(item)) return;
        const ref = String(item.reference_id || '').trim();
        if (!ref) return;
        const schedule = schedulesByRef.get(ref) || null;
        if (schedule && !isDeliverySchedule(schedule)) return;
        itemScheduleRefs.add(ref);
        itemRows.push(...expandReleaseItemRows(item, schedule));
    });

    (releaseState.raw.schedules || []).forEach((schedule) => {
        const ref = String(schedule.id || schedule._docId || '').trim();
        if (!ref || itemScheduleRefs.has(ref)) return;
        if (!isDeliverySchedule(schedule)) return;
        const pendingQty = recordQuantity(schedule, ['releasing_pending_qty', 'release_pending_qty']);
        if (releaseState.savedFinalRefs.has(ref) && (pendingQty === null || pendingQty <= 0)) return;
        itemRows.push(...expandReleaseItemRows(null, schedule));
    });

    releaseState.rows = itemRows
        .filter(Boolean)
        .sort((left, right) => Number(right.refNo || 0) - Number(left.refNo || 0) || left.company.localeCompare(right.company));
}

function populateModelDatalist() {
    const datalist = document.getElementById('releaseModelList');
    if (!datalist) return;
    const labels = new Set();
    (releaseState.raw.models || []).forEach((model) => {
        const label = clean(model.modelname || model.model || model.model_name || model.description);
        if (label) labels.add(label);
    });
    releaseState.maps.machines.forEach((machine) => {
        const label = clean(machine.description);
        if (label) labels.add(label);
    });
    datalist.innerHTML = Array.from(labels)
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
        .slice(0, 2000)
        .map((label) => `<option value="${escapeAttr(label)}"></option>`)
        .join('');
}

function isActiveRequestItem(item) {
    if (!item) return false;
    if (Number(item.iscancelled || 0) === 1) return false;
    if (Number(item.releasing_finaldr_id || item.rd_id || 0) > 0) return false;
    if (requestQuantity(item) <= 0) return false;
    return !normalizeLegacyDate(item.close_date);
}

function isDeliverySchedule(schedule) {
    if (!schedule || Number(schedule.iscancel || schedule.iscancelled || 0) === 1) return false;
    if (Number(schedule.releasing_dr_done || 0) === 1) return false;
    const pendingQty = recordQuantity(schedule, ['releasing_pending_qty', 'release_pending_qty']);
    if (pendingQty !== null && pendingQty <= 0) return false;
    const purposeId = Number(schedule.purpose_id || 0);
    if (purposeId === 3 || purposeId === 4) return true;
    const text = [
        schedule.remarks,
        schedule.customer_request,
        schedule.route_remarks,
        releaseState.maps.troubles.get(String(schedule.trouble_id || ''))?.trouble
    ].join(' ').toLowerCase();
    return /toner|ink|cartridge|drum|load/.test(text);
}

function expandReleaseItemRows(item, schedule) {
    const qty = requestQuantity(item, schedule);
    return Array.from({ length: qty }, (_, index) => normalizeReleaseItem(item, schedule, index + 1, qty)).filter(Boolean);
}

function requestQuantity(item, schedule = null) {
    const direct = recordQuantity(item, ['qty', 'quantity', 'request_qty', 'release_pending_qty']);
    if (direct !== null) return direct > 0 ? Math.min(direct, 50) : 0;
    if (item) return 1;
    const pending = recordQuantity(schedule, ['releasing_pending_qty', 'release_pending_qty']);
    if (pending !== null) return pending > 0 ? Math.min(pending, 50) : 0;
    const text = clean(`${schedule?.customer_request || ''} ${schedule?.remarks || ''}`);
    const match = text.match(/(?:^|\s)(\d{1,2})\s*(?:pc|pcs|piece|pieces|black|cyan|magenta|yellow)\b/i);
    const inferred = Number(match?.[1] || 1);
    if (!Number.isFinite(inferred) || inferred <= 0) return 1;
    return Math.min(Math.trunc(inferred), 50);
}

function recordQuantity(record, fields) {
    if (!record) return null;
    for (const field of fields) {
        if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
        const value = record[field];
        if (value === null || value === undefined || value === '') continue;
        const qty = Number(value);
        if (!Number.isFinite(qty)) continue;
        return Math.trunc(qty);
    }
    return null;
}

function normalizeReleaseItem(item, schedule, unitIndex = 1, totalQty = 1) {
    const refNo = String(item?.reference_id || schedule?.id || schedule?._docId || '').trim();
    if (!refNo) return null;
    const branchId = Number(item?.client_id || schedule?.branch_id || 0) || 0;
    const branch = releaseState.maps.branches.get(String(branchId)) || null;
    const company = releaseState.maps.companies.get(String(schedule?.company_id || branch?.company_id || '')) || null;
    const machine = releaseState.maps.machines.get(String(schedule?.serial || schedule?.mach_id || '')) || null;
    const trouble = releaseState.maps.troubles.get(String(schedule?.trouble_id || '')) || null;
    const purposeId = Number(schedule?.purpose_id || 0);
    const category = inferReleaseCategory(item, schedule, trouble);
    const seed = {
        brand: clean(item?.release_brand || item?.brand || ''),
        model: clean(item?.release_model || ''),
        description: clean(item?.release_description || item?.description || ''),
        serial: clean(item?.release_serial || ''),
        notes: clean(item?.release_notes || item?.remarks || schedule?.remarks || schedule?.customer_request || '')
    };

    if (!seed.model && machine) seed.model = clean(machine.description);
    if (!seed.serial && machine && purposeId !== 3) seed.serial = clean(machine.serial);
    if (!seed.brand && seed.model) seed.brand = inferBrand(seed.model);
    if (!seed.description && purposeId === 3) seed.description = clean(schedule?.customer_request || schedule?.remarks || trouble?.trouble) || 'N/A';

    const key = rowKey(refNo, item, schedule, unitIndex);
    const draft = releaseState.detailDrafts.get(key) || {};
    const merged = { ...seed, ...draft };
    const companyLabel = buildClientName(company, branch) || clean(item?.company || schedule?.company || '') || 'Unknown Client';
    const requestDate = firstDate(schedule?.task_datetime, schedule?.original_sched, item?.tmestmp, item?.tmstmp);
    const serial = clean(merged.serial) || 'N/A';
    const notes = clean(merged.notes) || 'N/A';
    const readyForDr = realValue(serial) && realValue(notes);

    return {
        key,
        refNo,
        sourceKey: item ? `item:${item._docId || item.id}` : `schedule:${refNo}`,
        unitIndex,
        totalQty,
        company: companyLabel,
        branchId,
        category,
        brand: clean(merged.brand) || 'N/A',
        model: clean(merged.model) || 'N/A',
        description: clean(merged.description) || 'N/A',
        serial,
        notes,
        age: ageInDays(requestDate),
        isCartridge: /cartridge/i.test(category),
        isUrgent: Number(schedule?.super_urgent || 0) === 1 || /urgent|rush|asap/i.test(`${schedule?.remarks || ''} ${item?.remarks || ''}`),
        isBackJob: /back\s*job|backjob/i.test(`${schedule?.remarks || ''} ${item?.remarks || ''}`),
        detailsAdded: Boolean(draft.detailsAdded || item?.release_details_added || readyForDr),
        readyForDr,
        itemDocId: String(item?._docId || item?.id || '').trim(),
        scheduleDocId: String(schedule?._docId || schedule?.id || refNo).trim(),
        item,
        schedule,
        searchText: [
            refNo,
            unitIndex,
            totalQty,
            companyLabel,
            category,
            merged.brand,
            merged.model,
            merged.description,
            merged.serial,
            merged.notes,
            schedule?.caller,
            trouble?.trouble
        ].join(' ').toLowerCase()
    };
}

function rowKey(refNo, item, schedule, unitIndex = 1) {
    return [
        refNo,
        item?._docId || item?.id || 'schedule',
        schedule?._docId || schedule?.id || '',
        unitIndex
    ].join(':');
}

function inferReleaseCategory(item, schedule, trouble) {
    const text = [
        item?.category,
        item?.rdtype_id,
        item?.description,
        item?.remarks,
        schedule?.remarks,
        schedule?.customer_request,
        trouble?.trouble
    ].join(' ').toLowerCase();
    if (Number(schedule?.purpose_id || 0) === 4 || /cartridge/.test(text)) return 'CARTRIDGE';
    return RELEASE_PURPOSE_LABELS[Number(schedule?.purpose_id || 0)] || 'TONER / INK';
}

function renderReleaseTables() {
    const rows = releaseState.rows.filter(passesReleaseFilters).slice(0, RELEASE_ROWS_PER_VIEW);
    releaseState.viewRows = rows;
    renderQueueRows(rows);
    renderCreateRows();
    document.getElementById('releaseQueueMeta').textContent = `Total: ${rows.length}`;
    document.getElementById('releaseSubtitle').textContent = `${releaseState.rows.length} pending DR item(s), ${releaseState.createRows.length} item(s) in Create DR.`;
}

function passesReleaseFilters(row) {
    if (releaseState.filters.cartridgeOnly && !row.isCartridge) return false;
    if (releaseState.filters.urgentOnly && !row.isUrgent) return false;
    if (releaseState.filters.backJobOnly && !row.isBackJob) return false;
    if (!releaseState.filters.search) return true;
    return String(row.searchText || '').includes(releaseState.filters.search);
}

function renderQueueRows(rows) {
    const tbody = document.getElementById('releaseQueueBody');
    if (!rows.length) {
        tbody.innerHTML = '<tr class="release-empty-row"><td colspan="9">No DR items found.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map((row) => {
        const classes = [
            row.readyForDr ? 'is-ready' : '',
            row.isCartridge ? 'is-cartridge' : '',
            row.isUrgent ? 'is-urgent' : '',
            row.isBackJob ? 'is-backjob' : '',
            isCreateRow(row.key) ? 'is-selected' : ''
        ].filter(Boolean).join(' ');
        const title = row.readyForDr
            ? `Right-click to add to DR. Unit ${row.unitIndex} of ${row.totalQty}.`
            : `Double-click to add serial and notes. Unit ${row.unitIndex} of ${row.totalQty}.`;
        return `
            <tr class="${classes}" data-row-key="${escapeAttr(row.key)}" title="${escapeAttr(title)}">
                <td>${escapeHtml(row.refNo)}</td>
                <td>${escapeHtml(row.company)}</td>
                <td>${escapeHtml(row.category)}</td>
                <td>${escapeHtml(row.brand)}</td>
                <td>${escapeHtml(row.model)}</td>
                <td>${escapeHtml(row.description)}</td>
                <td>${escapeHtml(row.serial)}</td>
                <td>${escapeHtml(row.notes)}</td>
                <td>${escapeHtml(formatAge(row.age))}</td>
            </tr>
        `;
    }).join('');
    tbody.querySelectorAll('tr[data-row-key]').forEach((tr) => {
        tr.addEventListener('dblclick', () => openReleaseDetailModal(tr.dataset.rowKey));
        tr.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            openReleaseContextMenu(tr.dataset.rowKey, event.clientX, event.clientY);
        });
    });
}

function renderCreateRows() {
    const tbody = document.getElementById('releaseCreateBody');
    const copy = document.getElementById('releaseDropCopy');
    if (!releaseState.createRows.length) {
        tbody.innerHTML = '<tr class="release-empty-row"><td colspan="7">No items added to DR yet.</td></tr>';
        copy.style.display = '';
        updateCreateLabels();
        return;
    }
    copy.style.display = 'none';
    tbody.innerHTML = releaseState.createRows.map((row) => `
        <tr data-row-key="${escapeAttr(row.key)}" title="Double-click to remove from Create DR">
            <td>${escapeHtml(row.refNo)}</td>
            <td>${escapeHtml(row.company)}</td>
            <td>${escapeHtml(row.category)}</td>
            <td>${escapeHtml(row.brand)}</td>
            <td>${escapeHtml(row.model)}</td>
            <td>${escapeHtml(row.description)}</td>
            <td>${escapeHtml(row.serial)}</td>
        </tr>
    `).join('');
    tbody.querySelectorAll('tr[data-row-key]').forEach((tr) => {
        tr.addEventListener('dblclick', () => {
            releaseState.createRows = releaseState.createRows.filter((row) => row.key !== tr.dataset.rowKey);
            renderReleaseTables();
        });
    });
    updateCreateLabels();
}

function openReleaseContextMenu(key, x, y) {
    const row = findRow(key);
    if (!row) return;
    releaseState.contextRowKey = key;
    const menu = document.getElementById('releaseContextMenu');
    const addBtn = document.getElementById('releaseContextAddBtn');
    addBtn.disabled = !row.readyForDr || isCreateRow(row.key);
    menu.classList.remove('hidden');
    const menuWidth = menu.offsetWidth || 152;
    const menuHeight = menu.offsetHeight || 84;
    const left = Math.min(x, window.innerWidth - menuWidth - 8);
    const top = Math.min(y, window.innerHeight - menuHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
}

function hideReleaseContextMenu() {
    document.getElementById('releaseContextMenu')?.classList.add('hidden');
    releaseState.contextRowKey = '';
}

function updateCreateLabels() {
    const first = releaseState.createRows[0] || null;
    document.getElementById('releaseClientLabel').textContent = first ? first.company : '...';
    document.getElementById('releaseRefLabel').textContent = first ? first.refNo : '...';
}

function addRowToCreate(key) {
    const row = findRow(key);
    if (!row) return;
    if (!row.readyForDr) {
        alert('Add serial number and notes before adding this item to DR.');
        openReleaseDetailModal(key);
        return;
    }
    const first = releaseState.createRows[0] || null;
    if (first && (first.refNo !== row.refNo || first.branchId !== row.branchId)) {
        alert('Create DR can only contain one client and one reference number at a time.');
        return;
    }
    if (!releaseState.createRows.some((entry) => entry.key === row.key)) {
        releaseState.createRows.push(row);
    }
    renderReleaseTables();
}

function openReleaseDetailModal(key) {
    const row = findRow(key);
    if (!row) return;
    releaseState.selectedDetailKey = key;
    document.getElementById('releaseDetailTitle').textContent = row.isCartridge ? 'Assign Cartridge' : 'Item Details';
    document.getElementById('releaseDetailSummary').innerHTML = `
        <div>${escapeHtml(row.company)}</div>
        <span>Reference ${escapeHtml(row.refNo)} - ${escapeHtml(row.category)}${row.isCartridge ? ' - model and serial required' : ''}</span>
    `;
    document.getElementById('releaseDetailBrandInput').value = normalizeInputValue(row.brand);
    document.getElementById('releaseDetailModelInput').value = normalizeInputValue(row.model);
    document.getElementById('releaseDetailDescriptionInput').value = normalizeInputValue(row.description);
    document.getElementById('releaseDetailSerialInput').value = normalizeInputValue(row.serial);
    document.getElementById('releaseDetailNotesInput').value = normalizeInputValue(row.notes);
    setReleaseDetailOpen(true);
    setTimeout(() => document.getElementById(row.isCartridge ? 'releaseDetailModelInput' : 'releaseDetailNotesInput').focus(), 30);
}

function closeReleaseDetailModal() {
    releaseState.selectedDetailKey = '';
    setReleaseDetailOpen(false);
}

function setReleaseDetailOpen(open) {
    document.getElementById('releaseDetailOverlay').classList.toggle('visible', open);
    document.getElementById('releaseDetailModal').classList.toggle('open', open);
    document.getElementById('releaseDetailModal').setAttribute('aria-hidden', open ? 'false' : 'true');
}

function saveReleaseDetail(event) {
    event.preventDefault();
    const row = findRow(releaseState.selectedDetailKey);
    if (!row) return;
    const draft = {
        brand: clean(document.getElementById('releaseDetailBrandInput').value) || 'N/A',
        model: clean(document.getElementById('releaseDetailModelInput').value) || 'N/A',
        description: clean(document.getElementById('releaseDetailDescriptionInput').value) || 'N/A',
        serial: clean(document.getElementById('releaseDetailSerialInput').value) || 'N/A',
        notes: clean(document.getElementById('releaseDetailNotesInput').value) || 'N/A',
        detailsAdded: true
    };
    if (row.isCartridge && (!realValue(draft.model) || !realValue(draft.serial))) {
        alert('Cartridge requests require model and serial.');
        return;
    }
    if (!realValue(draft.serial) || !realValue(draft.notes)) {
        alert('Serial number and notes are required before this item can be added to DR.');
        return;
    }
    releaseState.detailDrafts.set(row.key, draft);
    Object.assign(row, draft, { detailsAdded: true, readyForDr: true });
    releaseState.createRows = releaseState.createRows.map((entry) => entry.key === row.key ? row : entry);
    closeReleaseDetailModal();
    renderReleaseTables();
}

function openReleasePreview() {
    if (!releaseState.createRows.length) {
        alert('Add at least one ready item to Create DR.');
        return;
    }
    const drNumber = clean(document.getElementById('releaseDrNumberInput').value);
    if (!drNumber) {
        alert('Enter DR No.');
        return;
    }
    const invalidCartridge = releaseState.createRows.find((row) => row.isCartridge && (!realValue(row.model) || !realValue(row.serial)));
    if (invalidCartridge) {
        alert(`Cartridge item for reference ${invalidCartridge.refNo} needs model and serial.`);
        openReleaseDetailModal(invalidCartridge.key);
        return;
    }
    const payload = buildPrintPayload();
    releaseState.pendingPreview = payload;
    document.getElementById('releasePreviewPage').innerHTML = buildDrPrintHtml(payload);
    setReleasePreviewOpen(true);
}

function closeReleasePreview() {
    releaseState.pendingPreview = null;
    setReleasePreviewOpen(false);
}

function setReleasePreviewOpen(open) {
    document.getElementById('releasePreviewOverlay').classList.toggle('visible', open);
    document.getElementById('releasePreviewModal').classList.toggle('open', open);
    document.getElementById('releasePreviewModal').setAttribute('aria-hidden', open ? 'false' : 'true');
}

function buildPrintPayload() {
    const first = releaseState.createRows[0];
    const schedule = first.schedule || {};
    const branch = releaseState.maps.branches.get(String(first.branchId || schedule.branch_id || '')) || null;
    const address = compactAddress(branch?.branch_address || [branch?.bldg, branch?.floor, branch?.street, branch?.brgy, branch?.city].filter(Boolean).join(', '));
    return {
        referenceNo: first.refNo,
        client: first.company,
        address,
        bmeter: clean(document.getElementById('releaseBeginningMeterInput').value),
        drNumber: clean(document.getElementById('releaseDrNumberInput').value),
        date: new Date().toLocaleDateString('en-PH'),
        items: releaseState.createRows.map((row) => ({ ...row, qty: 1 })),
        currentCartridges: buildCurrentCartridgeText(releaseState.createRows)
    };
}

function buildCurrentCartridgeText(rows) {
    const values = rows
        .filter((row) => row.isCartridge)
        .map((row) => realValue(row.serial) ? row.serial : row.notes)
        .filter((value) => realValue(value));
    return values.length ? values.join(', ') : 'N/A';
}

function buildDrPrintHtml(payload) {
    return `
        <div class="dr-print-doc">
            <div class="dr-print-head">
                <div>
                    <h1>${escapeHtml(payload.client)}</h1>
                    <div class="dr-print-address">${escapeHtml(payload.address || '')}</div>
                </div>
                <div class="dr-print-date">${escapeHtml(payload.date)}</div>
            </div>
            <div class="dr-print-meta">
                <div><strong>Reference No. :</strong>&nbsp;&nbsp;${escapeHtml(payload.referenceNo)}</div>
                <div><strong>B. Meter :</strong>&nbsp;&nbsp;${escapeHtml(payload.bmeter || '')}</div>
            </div>
            <table class="dr-print-table">
                <thead>
                    <tr>
                        <th>Category</th>
                        <th>Brand</th>
                        <th>Model</th>
                        <th>Description</th>
                        <th>Serial</th>
                        <th class="qty-cell">Qty</th>
                    </tr>
                </thead>
                <tbody>
                    ${payload.items.map((item) => `
                        <tr>
                            <td>${escapeHtml(item.category)}</td>
                            <td>${escapeHtml(item.brand)}</td>
                            <td>${escapeHtml(item.model)}</td>
                            <td>${escapeHtml(item.description)}</td>
                            <td>${escapeHtml(item.serial)}</td>
                            <td class="qty-cell">${escapeHtml(item.qty)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="dr-print-current">Current cartridges : &nbsp; ${escapeHtml(payload.currentCartridges)}</div>
            <div class="dr-print-signatures">
                <div>Released by :</div>
                <div>Deliver by :</div>
            </div>
        </div>
    `;
}

async function printAndSaveRelease() {
    const payload = releaseState.pendingPreview || buildPrintPayload();
    const button = document.getElementById('releasePreviewPrintBtn');
    button.disabled = true;
    try {
        await saveReleaseDr(payload);
        printHtmlDocument(buildPrintDocument(payload), `marga_dr_${payload.drNumber || payload.referenceNo}`);
        closeReleasePreview();
        releaseState.createRows = [];
        document.getElementById('releaseBeginningMeterInput').value = '';
        document.getElementById('releaseDrNumberInput').value = '';
        await loadReleasingData();
        MargaUtils.showToast(`DR ${payload.drNumber} saved.`, 'success');
    } catch (error) {
        console.error('Print and save DR failed:', error);
        alert(`Failed to save DR: ${error.message || error}`);
    } finally {
        button.disabled = false;
    }
}

async function saveReleaseDr(payload) {
    const finalId = await allocateNextId('tbl_finaldr');
    const now = new Date().toISOString();
    const first = releaseState.createRows[0];
    const finalDoc = {
        id: finalId,
        reference_id: Number(payload.referenceNo) || payload.referenceNo,
        original_reference_id: 0,
        client_id: Number(first.branchId || 0) || 0,
        dr_number: Number(payload.drNumber) || payload.drNumber,
        bmeter: Number(payload.bmeter) || 0,
        tech_id: Number(first.schedule?.tech_id || 0) || 0,
        transfer_to: 0,
        cartridge_return_status: 0,
        received_by: '',
        prepared_by: currentUserLabel(),
        date_received: 'undefined 00:00:00',
        remarks: payload.items.map((item) => item.notes).filter((note) => realValue(note)).join('; '),
        iscancelled: 0,
        tmstmp: now,
        releasing_created_at: now,
        releasing_created_by: currentUserLabel()
    };

    await setDocument('tbl_finaldr', String(finalId), finalDoc, {
        label: `Save DR ${payload.drNumber}`,
        dedupeKey: `releasing-finaldr:${payload.referenceNo}:${payload.drNumber}`
    });

    let nextItemId = await allocateNextId('tbl_newfordr');
    const grouped = groupCreateRowsBySource();
    for (const group of grouped) {
        if (!group.itemDocId) {
            const firstRow = group.rows[0];
            const sourceQty = requestQuantity(null, firstRow.schedule);
            const remainingQty = Math.max(0, sourceQty - group.rows.length);
            if (group.scheduleDocId && sourceQty > 0) {
                await patchDocument('tbl_schedule', group.scheduleDocId, {
                    releasing_pending_qty: remainingQty,
                    releasing_dr_done: remainingQty === 0 ? 1 : 0,
                    releasing_split_at: now,
                    releasing_split_by: currentUserLabel()
                }, {
                    label: `Update schedule DR qty ${firstRow.refNo}`,
                    dedupeKey: `releasing-schedule-split:${group.scheduleDocId}:${payload.drNumber}:${group.rows.length}`
                });
            }
            for (const row of group.rows) {
                nextItemId = await createReleasedItemRow(row, finalId, payload, now, nextItemId);
            }
            continue;
        }

        const sourceQty = requestQuantity(group.rows[0].item, group.rows[0].schedule);
        const selectedQty = group.rows.length;
        if (sourceQty > selectedQty) {
            await patchDocument('tbl_newfordr', group.itemDocId, {
                qty: sourceQty - selectedQty,
                release_pending_qty: sourceQty - selectedQty,
                releasing_split_at: now,
                releasing_split_by: currentUserLabel()
            }, {
                label: `Split DR item ${group.rows[0].refNo}`,
                dedupeKey: `releasing-item-split:${group.itemDocId}:${payload.drNumber}:${selectedQty}`
            });
            for (const row of group.rows) {
                nextItemId = await createReleasedItemRow(row, finalId, payload, now, nextItemId);
            }
            continue;
        }

        const [firstRow, ...extraRows] = group.rows;
        await patchDocument('tbl_newfordr', group.itemDocId, buildReleasedItemFields(firstRow, finalId, payload, now), {
            label: `Update DR item ${firstRow.refNo}`,
            dedupeKey: `releasing-item-update:${group.itemDocId}:${payload.drNumber}`
        });
        for (const row of extraRows) {
            nextItemId = await createReleasedItemRow(row, finalId, payload, now, nextItemId);
        }
    }
}

function groupCreateRowsBySource() {
    const groups = new Map();
    releaseState.createRows.forEach((row) => {
        const key = row.itemDocId ? `item:${row.itemDocId}` : (row.sourceKey || row.key);
        if (!groups.has(key)) {
            groups.set(key, {
                itemDocId: row.itemDocId,
                scheduleDocId: row.itemDocId ? '' : row.scheduleDocId,
                rows: []
            });
        }
        groups.get(key).rows.push(row);
    });
    return Array.from(groups.values());
}

function buildReleasedItemFields(row, finalId, payload, now) {
    return {
        reference_id: Number(row.refNo) || row.refNo,
        original_reference_id: 0,
        client_id: Number(row.branchId || 0) || 0,
        rd_id: finalId,
        source_id: 2,
        status_id: 2,
        rdtype_id: row.isCartridge ? 4 : 5,
        qty: 1,
        supplier_id: 0,
        supplierX: 0,
        iscancelled: 0,
        close_date: '0000-00-00 00:00:00',
        description: realValue(row.description) ? row.description : row.model,
        remarks: row.notes,
        release_brand: row.brand,
        release_model: row.model,
        release_description: row.description,
        release_serial: row.serial,
        release_notes: row.notes,
        release_details_added: 1,
        releasing_source_item_id: row.itemDocId || '',
        releasing_source_schedule_id: row.scheduleDocId || '',
        releasing_source_unit_index: Number(row.unitIndex || 1),
        releasing_source_qty: Number(row.totalQty || 1),
        releasing_finaldr_id: finalId,
        releasing_dr_number: payload.drNumber,
        releasing_updated_at: now,
        releasing_updated_by: currentUserLabel()
    };
}

async function createReleasedItemRow(row, finalId, payload, now, nextItemId) {
    const id = nextItemId;
    await setDocument('tbl_newfordr', String(id), { id, ...buildReleasedItemFields(row, finalId, payload, now), tmestmp: now }, {
        label: `Create DR item ${row.refNo}`,
        dedupeKey: `releasing-item-create:${row.refNo}:${row.key}:${payload.drNumber}`
    });
    return nextItemId + 1;
}

async function allocateNextId(collection) {
    const latest = await fetchLatestRows(collection, 1);
    const next = Number(latest[0]?.id || latest[0]?._docId || 0) + 1;
    if (!Number.isFinite(next) || next <= 0) throw new Error(`Unable to allocate ${collection} id.`);
    return next;
}

function printHtmlDocument(html, windowName) {
    const printWindow = window.open('', windowName, 'width=1000,height=760');
    if (!printWindow) {
        alert('Please allow pop-ups to print the DR.');
        return;
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    const triggerPrint = () => {
        try {
            printWindow.print();
        } catch (error) {
            console.warn('Print failed:', error);
        }
    };
    printWindow.addEventListener('load', triggerPrint, { once: true });
    window.setTimeout(triggerPrint, 500);
}

function buildPrintDocument(payload) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>DR ${escapeHtml(payload.drNumber || payload.referenceNo)}</title>
            <style>
                body { margin: 0; background: #fff; font-family: Arial, sans-serif; color: #111; }
                .print-wrap { padding: 18mm 17mm; }
                .dr-print-doc { font-size: 13px; }
                .dr-print-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12mm; margin-bottom: 16mm; }
                .dr-print-head h1 { margin: 0 0 5mm; font-size: 17px; font-weight: 800; }
                .dr-print-address { font-size: 13px; font-weight: 700; }
                .dr-print-date { font-weight: 800; }
                .dr-print-meta { display: grid; gap: 7mm; margin-bottom: 7mm; }
                .dr-print-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; }
                .dr-print-table th, .dr-print-table td { padding: 1.5mm 2mm; text-align: left; vertical-align: top; }
                .dr-print-table th { font-size: 11px; font-weight: 800; }
                .qty-cell { width: 14mm; text-align: center; }
                .dr-print-current { margin: 9mm 0 23mm; font-weight: 800; }
                .dr-print-signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 45mm; margin-top: 20mm; text-align: center; }
                @page { size: letter portrait; margin: 8mm; }
            </style>
        </head>
        <body><div class="print-wrap">${buildDrPrintHtml(payload)}</div></body>
        </html>
    `;
}

async function maybeLoadExactReference(value) {
    const ref = clean(value);
    if (!/^\d{3,}$/.test(ref) || releaseState.referenceFetches.has(ref)) return;
    releaseState.referenceFetches.add(ref);
    try {
        const [schedule, requestItems, finalDrs] = await Promise.all([
            fetchDoc('tbl_schedule', ref),
            queryEqualsLimit('tbl_newfordr', 'reference_id', Number(ref), 50),
            queryEqualsLimit('tbl_finaldr', 'reference_id', Number(ref), 20)
        ]);
        if (schedule && !releaseState.raw.schedules.some((row) => String(row.id || row._docId) === ref)) {
            releaseState.raw.schedules.push(schedule);
        }
        requestItems.forEach((item) => {
            if (!releaseState.raw.requestItems.some((row) => String(row._docId || row.id) === String(item._docId || item.id))) {
                releaseState.raw.requestItems.push(item);
            }
        });
        finalDrs.forEach((item) => {
            if (!releaseState.raw.finalDrs.some((row) => String(row._docId || row.id) === String(item._docId || item.id))) {
                releaseState.raw.finalDrs.push(item);
                if (Number(item.iscancelled || 0) !== 1) releaseState.savedFinalRefs.add(String(item.reference_id || '').trim());
            }
        });
        buildReleaseRows();
        renderReleaseTables();
    } catch (error) {
        console.warn(`Reference ${ref} lookup failed.`, error);
    }
}

function setReleaseLoadingRows() {
    document.getElementById('releaseQueueBody').innerHTML = '<tr class="release-empty-row"><td colspan="9">Loading...</td></tr>';
    document.getElementById('releaseCreateBody').innerHTML = '<tr class="release-empty-row"><td colspan="7">No items added to DR yet.</td></tr>';
}

function setReleaseStatus(message, isError = false) {
    const pill = document.getElementById('releaseStatusPill');
    pill.textContent = message;
    pill.classList.toggle('is-error', isError);
}

function findRow(key) {
    return releaseState.rows.find((row) => row.key === key) || releaseState.createRows.find((row) => row.key === key) || null;
}

function isCreateRow(key) {
    return releaseState.createRows.some((row) => row.key === key);
}

function currentUserLabel() {
    const user = MargaAuth.getUser();
    return clean(user?.email || user?.username || user?.name || 'releasing');
}

function buildClientName(company, branch) {
    const companyName = clean(company?.companyname || company?.business_style || company?.name);
    const branchName = clean(branch?.branchname || branch?.branch || branch?.departmentname);
    if (!companyName) return branchName;
    if (!branchName || branchName.toLowerCase() === 'main') return companyName;
    const companyKey = normalizeLoose(companyName);
    const branchKey = normalizeLoose(branchName);
    if (branchKey.includes(companyKey)) return branchName;
    return `${companyName} - ${branchName}`;
}

function compactAddress(value) {
    return clean(value).replace(/\s*,\s*/g, ', ');
}

function firstDate(...values) {
    return values.find((value) => normalizeLegacyDate(value)) || '';
}

function normalizeLegacyDate(value) {
    const text = clean(value).replace('T', ' ');
    if (!text) return '';
    if (RELEASE_ZERO_DATES.has(text.toLowerCase())) return '';
    return text;
}

function ageInDays(value) {
    const text = normalizeLegacyDate(value);
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

function inferBrand(value) {
    const text = String(value || '').toUpperCase();
    if (/\bBROTHER\b|\bMFC\b|\bDCP\b|\bHL[-\s]?\d/.test(text)) return 'Brother';
    if (/\bEPSON\b|\bL[-\s]?\d{3,4}\b/.test(text)) return 'Epson';
    if (/\bHP\b|\bLASERJET\b/.test(text)) return 'HP';
    if (/\bTOSHIBA\b|\bES[-\s]?\d/.test(text)) return 'Toshiba';
    if (/\bOCE\b|\bFX[-\s]?\d/.test(text)) return 'OCE';
    if (/\bLENOVO\b/.test(text)) return 'Lenovo';
    return '';
}

function normalizeInputValue(value) {
    const text = clean(value);
    return realValue(text) ? text : '';
}

function realValue(value) {
    const text = clean(value);
    return Boolean(text && !['N/A', 'NA', '-', '0'].includes(text.toUpperCase()));
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
