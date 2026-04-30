if (!MargaAuth.requireAccess('releasing')) {
    throw new Error('Unauthorized access to Releasing module.');
}

const RELEASE_QUERY_LIMIT = 20000;
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
const RELEASE_EXPORT_COLUMNS = [
    ['refNo', 'REF NO.'],
    ['company', 'COMPANY'],
    ['category', 'CATEGORY'],
    ['brand', 'BRAND'],
    ['model', 'MODEL'],
    ['description', 'DESCRIPTION'],
    ['serial', 'SERIAL'],
    ['notes', 'NOTES'],
    ['age', 'AGE']
];

const DR_PREVIEW_MM_PX = 2.45;
const DR_PRINT_SECTION_LAYOUT = {
    company: { label: 'Section 1', subtitle: 'Company name and address', xMm: 18, yMm: 22 },
    details: { label: 'Section 2', subtitle: 'Reference, B meter, items, current cartridges', xMm: 18, yMm: 55 },
    releasedBy: { label: 'Section 3', subtitle: 'Released by', xMm: 56, yMm: 198 },
    deliveryBy: { label: 'Section 4', subtitle: 'Deliver by', xMm: 134, yMm: 198 },
    date: { label: 'Section 5', subtitle: 'Date', xMm: 168, yMm: 22 }
};

const DR_PRINT_CALIBRATION = {
    paperWidthCm: 21.59,
    paperHeightCm: 27.94,
    scale: 1,
    offsetXmm: 0,
    offsetYmm: 0,
    sections: {
        company: { xMm: 0, yMm: 0, fontScale: 1 },
        details: { xMm: 0, yMm: 0, fontScale: 1 },
        releasedBy: { xMm: 0, yMm: 0, fontScale: 1 },
        deliveryBy: { xMm: 0, yMm: 0, fontScale: 1 },
        date: { xMm: 0, yMm: 0, fontScale: 1 }
    }
};

const DR_PRINT_CALIBRATION_STORAGE_KEY = 'marga_dr_print_calibration_v1';
const DR_PRINT_TEMPLATE_LIBRARY_STORAGE_KEY = 'marga_dr_print_templates_v1';
const DR_PRINT_ACTIVE_TEMPLATE_STORAGE_KEY = 'marga_dr_print_active_template_v1';
const DR_PRINT_TEMPLATE_FIRESTORE_COLLECTION = 'tbl_app_settings';
const DR_PRINT_TEMPLATE_FIRESTORE_DOC_ID = 'releasing_dr_print_templates_v1';
const DR_PRINT_TEMPLATE_SETTING_KEY = 'releasing_dr_print_templates';
let currentDrPrintCalibration = loadDrPrintCalibration();
let currentDrPrintTemplates = {};
let currentDrPrintTemplateName = 'Default';
let drPrintTemplatesFirebasePromise = null;
let drPrintTemplatesLoadedFromFirebase = false;
initializeDrPrintTemplateState();

const releaseState = {
    loading: false,
    rows: [],
    viewRows: [],
    createRows: [],
    selectedDetailKey: '',
    contextRowKey: '',
    createContextRowKey: '',
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
    pendingPreview: null,
    pendingPulloutPayload: null,
    lastPrintedPulloutSignature: '',
    lastSavedDrSignature: ''
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
    document.getElementById('releasePulloutPrintBtn').addEventListener('click', openPulloutForm);
    document.getElementById('releaseClearCreateBtn').addEventListener('click', clearCreateDrSection);
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
    document.getElementById('releaseCopyVisibleBtn').addEventListener('click', () => copyReleaseRows({ visibleOnly: true }));
    document.getElementById('releaseCopyAllBtn').addEventListener('click', () => copyReleaseRows({ visibleOnly: false }));
    document.getElementById('releaseDownloadCsvBtn').addEventListener('click', downloadReleaseCsv);
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
    document.getElementById('releaseCreateContextReturnBtn').addEventListener('click', () => {
        sendCreateRowBack(releaseState.createContextRowKey);
        hideReleaseCreateContextMenu();
    });
    document.addEventListener('click', (event) => {
        if (!event.target.closest('#releaseContextMenu, #releaseCreateContextMenu')) {
            hideReleaseContextMenu();
            hideReleaseCreateContextMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideReleaseContextMenu();
            hideReleaseCreateContextMenu();
        }
    });
    window.addEventListener('scroll', () => {
        hideReleaseContextMenu();
        hideReleaseCreateContextMenu();
    }, true);

    document.getElementById('releaseDetailOverlay').addEventListener('click', closeReleaseDetailModal);
    document.getElementById('releaseDetailCloseBtn').addEventListener('click', closeReleaseDetailModal);
    document.getElementById('releaseDetailCancelBtn').addEventListener('click', closeReleaseDetailModal);
    document.getElementById('releaseDetailSaveAddBtn').addEventListener('click', () => saveReleaseDetail(null, { addToCreate: true }));
    document.getElementById('releaseDetailForm').addEventListener('submit', saveReleaseDetail);

    document.getElementById('releasePreviewOverlay').addEventListener('click', closeReleasePreview);
    document.getElementById('releasePreviewCloseBtn').addEventListener('click', closeReleasePreview);
    document.getElementById('releasePreviewCancelBtn').addEventListener('click', closeReleasePreview);
    document.getElementById('releasePreviewPrintBtn').addEventListener('click', printAndSaveRelease);
    document.getElementById('releasePreviewModal').addEventListener('input', handleDrPrintControlInput);
    document.getElementById('releasePreviewModal').addEventListener('change', handleDrPrintControlInput);
    document.getElementById('releasePreviewModal').addEventListener('click', handleDrPrintToolClick);

    document.getElementById('releasePulloutOverlay').addEventListener('click', closePulloutForm);
    document.getElementById('releasePulloutCloseBtn').addEventListener('click', closePulloutForm);
    document.getElementById('releasePulloutCancelBtn').addEventListener('click', closePulloutForm);
    document.getElementById('releasePulloutForm').addEventListener('submit', printAndSavePulloutForm);
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
        if (!hasStructuredRequestItem(item) && !isLegacyDeliverySchedule(schedule)) return;
        itemScheduleRefs.add(ref);
        itemRows.push(...expandReleaseItemRows(item, schedule));
    });

    (releaseState.raw.schedules || []).forEach((schedule) => {
        const ref = String(schedule.id || schedule._docId || '').trim();
        if (!ref || itemScheduleRefs.has(ref)) return;
        if (!hasExplicitReleaseRequest(schedule) && !isLegacyDeliverySchedule(schedule)) return;
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

function hasExplicitReleaseRequest(schedule) {
    const category = normalizeReleaseCategoryLabel(schedule?.release_request_category || schedule?.release_category);
    const itemRstd = clean(schedule?.release_request_item_rstd || schedule?.item_rstd || '');
    const qty = recordQuantity(schedule, ['release_request_qty', 'releasing_pending_qty', 'release_pending_qty']);
    return Boolean(category && itemRstd && qty !== null && qty > 0);
}

function hasStructuredRequestItem(item) {
    if (!item) return false;
    const category = normalizeReleaseCategoryLabel(item?.category || item?.release_category);
    const itemRstd = clean(item?.description || item?.release_description || item?.remarks || item?.release_notes || '');
    const qty = requestQuantity(item);
    return Boolean(category && itemRstd && qty > 0);
}

function normalizeReleaseCategoryLabel(value) {
    const text = clean(value);
    if (!text) return '';
    const lowered = text.toLowerCase();
    if (lowered.includes('toner') || lowered.includes('ink')) return 'TONER / INK';
    if (lowered.includes('cartridge')) return 'CARTRIDGE';
    if (lowered.includes('machine') || lowered.includes('printer') || lowered.includes('unit')) return 'MACHINE';
    if (lowered.includes('part')) return 'PARTS';
    if (lowered.includes('other')) return 'OTHERS';
    return text.toUpperCase();
}

function isLegacyDeliverySchedule(schedule) {
    if (!schedule) return false;
    if (Number(schedule.iscancel || schedule.iscancelled || 0) === 1) return false;
    if (Number(schedule.releasing_dr_done || 0) === 1) return false;
    const purposeId = Number(schedule.purpose_id || 0);
    return purposeId === 3 || purposeId === 4;
}

function isDeliverySchedule(schedule) {
    if (!schedule || Number(schedule.iscancel || schedule.iscancelled || 0) === 1) return false;
    if (Number(schedule.releasing_dr_done || 0) === 1) return false;
    return hasExplicitReleaseRequest(schedule) || isLegacyDeliverySchedule(schedule);
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
    const explicit = recordQuantity(schedule, ['release_request_qty']);
    if (explicit !== null) return explicit > 0 ? Math.min(explicit, 50) : 0;
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
    const branchId = Number(schedule?.branch_id || item?.client_id || 0) || 0;
    const branch = releaseState.maps.branches.get(String(branchId)) || null;
    const company = releaseState.maps.companies.get(String(schedule?.company_id || branch?.company_id || '')) || null;
    const machine = releaseState.maps.machines.get(String(schedule?.serial || schedule?.mach_id || '')) || null;
    const trouble = releaseState.maps.troubles.get(String(schedule?.trouble_id || '')) || null;
    const purposeId = Number(schedule?.purpose_id || 0);
    const category = inferReleaseCategory(item, schedule, trouble);
    const releaseItemRstd = clean(schedule?.release_request_item_rstd || schedule?.item_rstd || '');
    const releaseSummary = clean(schedule?.release_request_summary || schedule?.customer_request || '');
    const seed = {
        brand: clean(item?.release_brand || item?.brand || ''),
        model: clean(item?.release_model || ''),
        description: clean(item?.release_description || item?.description || releaseItemRstd),
        serial: clean(item?.release_serial || ''),
        notes: clean(item?.release_notes || item?.remarks || releaseSummary || schedule?.remarks || '')
    };

    if (!seed.model && machine) seed.model = clean(machine.description);
    if (!seed.serial && machine && (purposeId !== 3 || hasExplicitReleaseRequest(schedule))) {
        seed.serial = clean(machine.serial);
    }
    if (!seed.brand && seed.model) seed.brand = inferBrand(seed.model);
    if (!seed.description && purposeId === 3) seed.description = clean(schedule?.customer_request || schedule?.remarks || trouble?.trouble) || 'N/A';
    if (!seed.description && realValue(category)) seed.description = category;
    if (!seed.notes && releaseSummary) seed.notes = releaseSummary;

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
        allocatedMachineId: clean(item?.production_allocated_machine_id || item?.allocated_machine_id || ''),
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
    const explicitCategory = normalizeReleaseCategoryLabel(schedule?.release_request_category || schedule?.release_category);
    if (explicitCategory) return explicitCategory;
    const itemCategory = normalizeReleaseCategoryLabel(item?.category || item?.release_category);
    if (itemCategory) return itemCategory;
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
    const availableRows = releaseState.rows.filter((row) => !isCreateRow(row.key));
    const rows = availableRows.filter(passesReleaseFilters).slice(0, RELEASE_ROWS_PER_VIEW);
    releaseState.viewRows = rows;
    renderQueueRows(rows);
    renderCreateRows();
    document.getElementById('releaseQueueMeta').textContent = `Total: ${rows.length}`;
    document.getElementById('releaseSubtitle').textContent = `${availableRows.length} pending DR item(s), ${releaseState.createRows.length} item(s) in Create DR.`;
}

function getReleaseExportRows({ visibleOnly = false } = {}) {
    const availableRows = releaseState.rows.filter((row) => !isCreateRow(row.key));
    if (visibleOnly) return releaseState.viewRows || [];
    return availableRows.filter(passesReleaseFilters);
}

function releaseExportCell(row, key) {
    if (key === 'age') return formatAge(row.age);
    return String(row?.[key] ?? '').trim();
}

function buildReleaseTsv(rows) {
    const header = RELEASE_EXPORT_COLUMNS.map(([, label]) => label).join('\t');
    const body = rows.map((row) => RELEASE_EXPORT_COLUMNS
        .map(([key]) => releaseExportCell(row, key).replace(/\t/g, ' ').replace(/\r?\n/g, ' '))
        .join('\t'));
    return [header, ...body].join('\n');
}

function csvCell(value) {
    const text = String(value ?? '');
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

function buildReleaseCsv(rows) {
    const header = RELEASE_EXPORT_COLUMNS.map(([, label]) => csvCell(label)).join(',');
    const body = rows.map((row) => RELEASE_EXPORT_COLUMNS
        .map(([key]) => csvCell(releaseExportCell(row, key)))
        .join(','));
    return [header, ...body].join('\n');
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

async function copyReleaseRows({ visibleOnly = false } = {}) {
    const rows = getReleaseExportRows({ visibleOnly });
    if (!rows.length) {
        setReleaseStatus('No DR rows to copy.', true);
        return;
    }
    try {
        await copyTextToClipboard(buildReleaseTsv(rows));
        setReleaseStatus(`${visibleOnly ? 'Visible' : 'All pending'} DR rows copied for Google Sheets.`);
    } catch (error) {
        console.error('Copy release rows failed:', error);
        setReleaseStatus('Copy failed. Try Download CSV.', true);
    }
}

function downloadReleaseCsv() {
    const rows = getReleaseExportRows({ visibleOnly: false });
    if (!rows.length) {
        setReleaseStatus('No DR rows to export.', true);
        return;
    }
    const csv = buildReleaseCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `releasing-pending-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setReleaseStatus(`CSV downloaded with ${rows.length} pending DR row(s).`);
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
        tbody.innerHTML = '<tr class="release-empty-row"><td colspan="10">No DR items found.</td></tr>';
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
                <td class="release-action-cell">
                    <button type="button" class="release-row-action release-row-delete" data-delete-row-key="${escapeAttr(row.key)}" title="Delete this pending DR item">Delete</button>
                </td>
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
    tbody.querySelectorAll('[data-delete-row-key]').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            deleteReleaseQueueRow(button.dataset.deleteRowKey);
        });
    });
    tbody.querySelectorAll('tr[data-row-key]').forEach((tr) => {
        tr.addEventListener('dblclick', () => openReleaseDetailModal(tr.dataset.rowKey));
        tr.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            openReleaseContextMenu(tr.dataset.rowKey, event.clientX, event.clientY);
        });
    });
}

async function deleteReleaseQueueRow(key) {
    const row = findRow(key);
    if (!row) return;
    if (isCreateRow(row.key)) {
        alert('Send this item back from Create DR before deleting it.');
        return;
    }
    if (!window.confirm(`Delete pending DR item ${row.refNo} - ${row.description}?`)) return;
    try {
        await softDeleteReleaseRow(row);
        releaseState.detailDrafts.delete(row.key);
        releaseState.rows = releaseState.rows.filter((entry) => entry.key !== row.key);
        releaseState.viewRows = releaseState.viewRows.filter((entry) => entry.key !== row.key);
        renderReleaseTables();
        setReleaseStatus(`Deleted pending DR item ${row.refNo}.`);
    } catch (error) {
        console.error('Delete pending DR item failed:', error);
        alert(`Failed to delete pending DR item: ${error.message || error}`);
    }
}

async function softDeleteReleaseRow(row) {
    const now = new Date().toISOString();
    if (row.itemDocId) {
        const sourceQty = requestQuantity(row.item, row.schedule);
        if (sourceQty > 1) {
            await patchDocument('tbl_newfordr', row.itemDocId, {
                qty: sourceQty - 1,
                release_pending_qty: sourceQty - 1,
                release_deleted_unit_count: Number(row.item?.release_deleted_unit_count || 0) + 1,
                release_deleted_at: now,
                release_deleted_by: currentUserLabel()
            }, {
                label: `Delete DR unit ${row.refNo}`,
                dedupeKey: `releasing-delete-unit:${row.itemDocId}:${row.key}`
            });
            row.item.qty = sourceQty - 1;
            row.item.release_pending_qty = sourceQty - 1;
            return;
        }
        await patchDocument('tbl_newfordr', row.itemDocId, {
            iscancelled: 1,
            release_deleted_at: now,
            release_deleted_by: currentUserLabel(),
            release_deleted_reason: 'Deleted from Releasing DR Item List'
        }, {
            label: `Delete DR item ${row.refNo}`,
            dedupeKey: `releasing-delete-item:${row.itemDocId}:${row.key}`
        });
        return;
    }

    if (!row.scheduleDocId) return;
    const sourceQty = requestQuantity(null, row.schedule);
    const remainingQty = Math.max(0, sourceQty - 1);
    const fields = {
        releasing_pending_qty: remainingQty,
        releasing_deleted_unit_count: Number(row.schedule?.releasing_deleted_unit_count || 0) + 1,
        releasing_deleted_at: now,
        releasing_deleted_by: currentUserLabel()
    };
    if (remainingQty <= 0) {
        fields.releasing_dr_done = 1;
        fields.release_request_deleted = 1;
        fields.release_request_deleted_reason = 'Deleted from Releasing DR Item List';
    }
    await patchDocument('tbl_schedule', row.scheduleDocId, fields, {
        label: `Delete schedule DR unit ${row.refNo}`,
        dedupeKey: `releasing-delete-schedule:${row.scheduleDocId}:${row.key}`
    });
    Object.assign(row.schedule, fields);
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
        <tr data-row-key="${escapeAttr(row.key)}" title="Right-click to send back to DR Item List">
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
        tr.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            openReleaseCreateContextMenu(tr.dataset.rowKey, event.clientX, event.clientY);
        });
    });
    updateCreateLabels();
}

function openReleaseContextMenu(key, x, y) {
    const row = findRow(key);
    if (!row) return;
    hideReleaseCreateContextMenu();
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

function openReleaseCreateContextMenu(key, x, y) {
    const row = releaseState.createRows.find((entry) => entry.key === key);
    if (!row) return;
    hideReleaseContextMenu();
    releaseState.createContextRowKey = key;
    const menu = document.getElementById('releaseCreateContextMenu');
    menu.classList.remove('hidden');
    const menuWidth = menu.offsetWidth || 208;
    const menuHeight = menu.offsetHeight || 44;
    const left = Math.min(x, window.innerWidth - menuWidth - 8);
    const top = Math.min(y, window.innerHeight - menuHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
}

function hideReleaseCreateContextMenu() {
    document.getElementById('releaseCreateContextMenu')?.classList.add('hidden');
    releaseState.createContextRowKey = '';
}

function sendCreateRowBack(key) {
    if (!key) return;
    releaseState.createRows = releaseState.createRows.filter((row) => row.key !== key);
    releaseState.lastSavedDrSignature = '';
    releaseState.lastPrintedPulloutSignature = '';
    renderReleaseTables();
}

async function clearCreateDrSection() {
    if (!releaseState.createRows.length) {
        document.getElementById('releaseBeginningMeterInput').value = '';
        document.getElementById('releaseDrNumberInput').value = '';
        releaseState.pendingPreview = null;
        releaseState.lastSavedDrSignature = '';
        releaseState.pendingPulloutPayload = null;
        releaseState.lastPrintedPulloutSignature = '';
        return;
    }
    if (!window.confirm('Clear all items from Create DR?')) return;
    const shouldRefreshFromFirebase = Boolean(releaseState.lastSavedDrSignature);
    releaseState.createRows = [];
    releaseState.pendingPreview = null;
    releaseState.pendingPulloutPayload = null;
    releaseState.lastSavedDrSignature = '';
    releaseState.lastPrintedPulloutSignature = '';
    document.getElementById('releaseBeginningMeterInput').value = '';
    document.getElementById('releaseDrNumberInput').value = '';
    closeReleasePreview();
    if (shouldRefreshFromFirebase) {
        await loadReleasingData();
    } else {
        renderReleaseTables();
    }
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
        releaseState.lastSavedDrSignature = '';
        releaseState.lastPrintedPulloutSignature = '';
    }
    renderReleaseTables();
}

function openReleaseDetailModal(key) {
    const row = findRow(key);
    if (!row) return;
    releaseState.selectedDetailKey = key;
    document.getElementById('releaseDetailTitle').textContent = row.isCartridge ? 'Assign Cartridge' : (row.category === 'MACHINE' ? 'Allocated Machine' : 'Item Details');
    document.getElementById('releaseDetailSummary').innerHTML = `
        <div>${escapeHtml(row.company)}</div>
        <span>Reference ${escapeHtml(row.refNo)} - ${escapeHtml(row.category)}${row.isCartridge || row.category === 'MACHINE' ? ' - model and serial required' : ''}</span>
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

function saveReleaseDetail(event, options = {}) {
    event?.preventDefault();
    const row = findRow(releaseState.selectedDetailKey);
    if (!row) return;
    const { addToCreate = false } = options;
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
    releaseState.lastSavedDrSignature = '';
    releaseState.lastPrintedPulloutSignature = '';
    closeReleaseDetailModal();
    if (addToCreate) {
        addRowToCreate(row.key);
        return;
    }
    renderReleaseTables();
}

function requiresChangeUnitPullout() {
    return releaseState.createRows.some(isChangeUnitMachineRow);
}

function isChangeUnitMachineRow(row) {
    if (!row || row.category !== 'MACHINE') return false;
    const text = [
        row.notes,
        row.description,
        row.schedule?.remarks,
        row.schedule?.customer_request,
        row.schedule?.release_request_summary,
        row.schedule?.release_request_type,
        row.item?.remarks,
        row.item?.release_notes
    ].join(' ').toLowerCase();
    return /change\s*unit|changeunit|replacement|replace/.test(text);
}

function buildCurrentPulloutSignature() {
    return releaseState.createRows
        .filter(isChangeUnitMachineRow)
        .map((row) => [
            row.refNo,
            row.key,
            row.branchId,
            row.serial,
            row.allocatedMachineId,
            machineDocId(getPulledOutMachine(row))
        ].join(':'))
        .join('|');
}

async function openPulloutForm() {
    if (!releaseState.createRows.length) {
        alert('Add at least one item to Create DR before printing a Pull Out Form.');
        return;
    }
    await ensurePulloutMachinesLoaded();
    const payload = buildPulloutPayload();
    if (!payload.items.length) {
        alert('No pull-out item is available in Create DR.');
        return;
    }
    if (payload.requiresReturnSave && payload.items.some((item) => !item.pulledMachine)) {
        alert('Change Unit pull-out needs the old customer machine serial from the schedule before printing.');
        return;
    }
    releaseState.pendingPulloutPayload = payload;
    document.getElementById('releasePulloutSummary').innerHTML = `
        <div>${escapeHtml(payload.client)}</div>
        <span>Reference ${escapeHtml(payload.referenceNo)} - ${escapeHtml(payload.items.length)} pull-out item(s)</span>
    `;
    document.getElementById('releasePulloutByInput').value = currentUserLabel();
    document.getElementById('releasePulloutRepInput').value = '';
    document.getElementById('releasePulloutReceiptInput').value = payload.defaultReceipt;
    document.getElementById('releasePulloutRemarksInput').value = payload.defaultRemarks;
    const now = new Date();
    document.getElementById('releasePulloutDateInput').value = localDateInputValue(now);
    document.getElementById('releasePulloutTimeInput').value = now.toTimeString().slice(0, 5);
    setPulloutFormOpen(true);
    setTimeout(() => document.getElementById('releasePulloutRepInput').focus(), 30);
}

function closePulloutForm() {
    setPulloutFormOpen(false);
}

function setPulloutFormOpen(open) {
    document.getElementById('releasePulloutOverlay').classList.toggle('visible', open);
    document.getElementById('releasePulloutModal').classList.toggle('open', open);
    document.getElementById('releasePulloutModal').setAttribute('aria-hidden', open ? 'false' : 'true');
}

function buildPulloutPayload() {
    const first = releaseState.createRows[0];
    const schedule = first.schedule || {};
    const branch = releaseState.maps.branches.get(String(first.branchId || schedule.branch_id || '')) || null;
    const address = compactAddress(branch?.branch_address || [branch?.bldg, branch?.floor, branch?.street, branch?.brgy, branch?.city].filter(Boolean).join(', '));
    const requiredRows = releaseState.createRows.filter(isChangeUnitMachineRow);
    const rows = requiredRows.length ? requiredRows : releaseState.createRows;
    return {
        referenceNo: first.refNo,
        client: first.company,
        address,
        date: new Date().toLocaleDateString('en-PH'),
        defaultReceipt: `PO-${first.refNo}`,
        defaultRemarks: requiredRows.length ? 'Change unit pull-out before DR release.' : 'Pull-out form.',
        requiresReturnSave: requiredRows.length > 0,
        signature: buildCurrentPulloutSignature(),
        items: rows.map((row) => {
            const pulledMachine = getPulledOutMachine(row);
            return {
                category: row.category,
                brand: row.brand,
                model: clean(pulledMachine?.description) || row.model,
                serial: clean(pulledMachine?.serial) || row.serial,
                replacementSerial: row.category === 'MACHINE' ? row.serial : '',
                description: row.description,
                notes: row.notes,
                row,
                pulledMachine
            };
        })
    };
}

async function ensurePulloutMachinesLoaded() {
    const ids = new Set();
    releaseState.createRows.forEach((row) => {
        getPulledOutMachineIds(row).forEach((id) => {
            if (id && !releaseState.maps.machines.has(id)) ids.add(id);
        });
    });
    if (!ids.size) return;
    const machines = await Promise.all(Array.from(ids).map((id) => fetchDoc('tbl_machine', id).catch(() => null)));
    machines.filter(Boolean).forEach((machine) => {
        const id = String(machine._docId || machine.id || '').trim();
        if (id) releaseState.maps.machines.set(id, machine);
    });
}

function getPulledOutMachineIds(row) {
    const schedule = row?.schedule || {};
    return [
        schedule.mach_id,
        schedule.serial,
        schedule.machine_id,
        row?.item?.old_machine_id,
        row?.item?.pullout_machine_id
    ].map((value) => String(value || '').trim()).filter(Boolean);
}

function getPulledOutMachine(row) {
    const ids = getPulledOutMachineIds(row);
    for (const id of ids) {
        const machine = releaseState.maps.machines.get(id);
        if (machine) return machine;
    }
    const rowSerial = normalizeSerial(row?.schedule?.serial_no || row?.schedule?.xserial || row?.schedule?.serial || '');
    if (rowSerial) {
        for (const machine of releaseState.maps.machines.values()) {
            if (normalizeSerial(machine.serial) === rowSerial) return machine;
        }
    }
    return null;
}

async function printAndSavePulloutForm(event) {
    event.preventDefault();
    const payload = releaseState.pendingPulloutPayload || buildPulloutPayload();
    const pulledBy = clean(document.getElementById('releasePulloutByInput').value);
    const rep = clean(document.getElementById('releasePulloutRepInput').value);
    const date = clean(document.getElementById('releasePulloutDateInput').value);
    const time = clean(document.getElementById('releasePulloutTimeInput').value);
    const receipt = clean(document.getElementById('releasePulloutReceiptInput').value);
    const remarks = clean(document.getElementById('releasePulloutRemarksInput').value);
    if (!pulledBy || !rep || !date || !time || !receipt) {
        alert('Pulled out by, customer representative, date/time, and pickup receipt are required.');
        return;
    }
    const printWindow = openPrintWindow(`marga_pullout_${receipt || payload.referenceNo}`);
    if (!printWindow) return;
    const button = event.submitter;
    if (button) button.disabled = true;
    try {
        const completed = { ...payload, pulledBy, customerRep: rep, eventDate: date, eventTime: time, pickupReceipt: receipt, remarks };
        if (payload.requiresReturnSave) await savePulloutPendingReturns(completed);
        releaseState.lastPrintedPulloutSignature = payload.signature;
        writePrintHtmlDocument(printWindow, buildPulloutPrintDocument(completed));
        closePulloutForm();
        MargaUtils.showToast('Pull Out Form printed. DR print is now available for this Change Unit.', 'success');
    } catch (error) {
        printWindow.close();
        console.error('Pull Out Form failed:', error);
        alert(`Failed to print Pull Out Form: ${error.message || error}`);
    } finally {
        if (button) button.disabled = false;
    }
}

async function savePulloutPendingReturns(payload) {
    const now = new Date().toISOString();
    for (const item of payload.items.filter((entry) => isChangeUnitMachineRow(entry.row))) {
        const machine = item.pulledMachine;
        if (!machine) continue;
        const docId = machineDocId(machine);
        const previousCustomer = resolveMachineCustomer(machine, item.row);
        const previousClientId = Number(machine.client_id || machine.branch_id || item.row.branchId || 0) || 0;
        const previousCompanyId = Number(machine.company_id || item.row.schedule?.company_id || 0) || 0;
        const fields = {
            client_id: 0,
            branch_id: 0,
            company_id: 0,
            isclient: 0,
            return_status: 'pending_return',
            return_pullout_at: `${payload.eventDate} ${payload.eventTime}:00`,
            return_pullout_date: payload.eventDate,
            return_pullout_time: payload.eventTime,
            return_pulled_out_by: payload.pulledBy,
            return_customer_representative: payload.customerRep,
            return_pickup_receipt: payload.pickupReceipt,
            return_remarks: payload.remarks,
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
            dedupeKey: `releasing-pullout-pending-return:${docId}:${payload.pickupReceipt}`
        });
        await createReceivingRecordFromRelease({
            record_type: 'customer_machine_pullout',
            source_module: 'releasing',
            source_reference_no: payload.referenceNo,
            machine_id: Number(machine.id || machine._docId || 0) || machine.id || machine._docId || '',
            serial: clean(machine.serial),
            model: clean(machine.description),
            previous_customer: previousCustomer,
            pulled_out_by: payload.pulledBy,
            customer_representative: payload.customerRep,
            pickup_receipt: payload.pickupReceipt,
            event_at: `${payload.eventDate} ${payload.eventTime}:00`,
            remarks: payload.remarks
        });
        Object.assign(machine, fields);
    }
}

async function createReceivingRecordFromRelease(fields) {
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
        dedupeKey: `releasing-receiving-record:${fields.record_type}:${fields.serial || fields.reference_no || id}:${fields.event_at || now}`
    });
}

function resolveMachineCustomer(machine, row) {
    const branch = releaseState.maps.branches.get(String(machine?.branch_id || machine?.client_id || row?.branchId || '')) || null;
    const company = releaseState.maps.companies.get(String(machine?.company_id || branch?.company_id || row?.schedule?.company_id || '')) || null;
    return buildClientName(company, branch) || row?.company || '';
}

function machineDocId(machine) {
    return String(machine?._docId || machine?.id || '').trim();
}

function normalizeSerial(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function localDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function openReleasePreview() {
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
    if (requiresChangeUnitPullout() && releaseState.lastPrintedPulloutSignature !== buildCurrentPulloutSignature()) {
        alert('Print the Pull Out Form first before printing the DR for this Change Unit machine.');
        openPulloutForm();
        return;
    }
    const payload = buildPrintPayload();
    releaseState.pendingPreview = payload;
    await ensureDrPrintTemplatesReady();
    renderDrPrintAdjustmentControls();
    renderActiveDrPreview();
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

function buildDrSaveSignature(payload) {
    return JSON.stringify({
        referenceNo: payload.referenceNo,
        drNumber: payload.drNumber,
        bmeter: payload.bmeter,
        items: payload.items.map((item) => ({
            key: item.key,
            refNo: item.refNo,
            serial: item.serial,
            notes: item.notes,
            model: item.model
        }))
    });
}

function buildCurrentCartridgeText(rows) {
    const values = rows
        .filter((row) => row.isCartridge)
        .map((row) => realValue(row.serial) ? row.serial : row.notes)
        .filter((value) => realValue(value));
    return values.length ? values.join(', ') : 'N/A';
}

function normalizeDrPrintCalibration(value = {}) {
    const paperWidthCm = Number(value?.paperWidthCm ?? DR_PRINT_CALIBRATION.paperWidthCm);
    const paperHeightCm = Number(value?.paperHeightCm ?? DR_PRINT_CALIBRATION.paperHeightCm);
    const scale = Number(value?.scale ?? DR_PRINT_CALIBRATION.scale);
    const offsetXmm = Number(value?.offsetXmm ?? DR_PRINT_CALIBRATION.offsetXmm);
    const offsetYmm = Number(value?.offsetYmm ?? DR_PRINT_CALIBRATION.offsetYmm);
    const rawSections = value?.sections || {};
    return {
        paperWidthCm: Number.isFinite(paperWidthCm) ? Math.max(10, Math.min(40, paperWidthCm)) : DR_PRINT_CALIBRATION.paperWidthCm,
        paperHeightCm: Number.isFinite(paperHeightCm) ? Math.max(10, Math.min(40, paperHeightCm)) : DR_PRINT_CALIBRATION.paperHeightCm,
        scale: Number.isFinite(scale) ? Math.max(0.7, Math.min(1.35, scale)) : DR_PRINT_CALIBRATION.scale,
        offsetXmm: Number.isFinite(offsetXmm) ? Math.max(-80, Math.min(80, offsetXmm)) : DR_PRINT_CALIBRATION.offsetXmm,
        offsetYmm: Number.isFinite(offsetYmm) ? Math.max(-80, Math.min(120, offsetYmm)) : DR_PRINT_CALIBRATION.offsetYmm,
        sections: Object.fromEntries(Object.keys(DR_PRINT_SECTION_LAYOUT).map((sectionKey) => {
            const defaults = DR_PRINT_CALIBRATION.sections[sectionKey];
            const current = rawSections?.[sectionKey] || {};
            const xMm = Number(current?.xMm ?? defaults.xMm);
            const yMm = Number(current?.yMm ?? defaults.yMm);
            const fontScale = Number(current?.fontScale ?? defaults.fontScale);
            return [sectionKey, {
                xMm: Number.isFinite(xMm) ? Math.max(-80, Math.min(80, xMm)) : defaults.xMm,
                yMm: Number.isFinite(yMm) ? Math.max(-100, Math.min(140, yMm)) : defaults.yMm,
                fontScale: Number.isFinite(fontScale) ? Math.max(0.65, Math.min(1.8, fontScale)) : defaults.fontScale
            }];
        }))
    };
}

function loadDrPrintCalibration() {
    try {
        const raw = localStorage.getItem(DR_PRINT_CALIBRATION_STORAGE_KEY);
        if (!raw) return normalizeDrPrintCalibration(DR_PRINT_CALIBRATION);
        return normalizeDrPrintCalibration(JSON.parse(raw));
    } catch (error) {
        return normalizeDrPrintCalibration(DR_PRINT_CALIBRATION);
    }
}

function normalizeDrPrintTemplateName(value = '') {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ');
    return normalized.slice(0, 48) || 'Default';
}

function drPrintCalibrationsEqual(left, right) {
    return JSON.stringify(normalizeDrPrintCalibration(left)) === JSON.stringify(normalizeDrPrintCalibration(right));
}

function loadDrPrintTemplates() {
    const templates = { Default: normalizeDrPrintCalibration(DR_PRINT_CALIBRATION) };
    try {
        const parsed = JSON.parse(localStorage.getItem(DR_PRINT_TEMPLATE_LIBRARY_STORAGE_KEY) || '{}');
        Object.entries(parsed || {}).forEach(([templateName, calibration]) => {
            templates[normalizeDrPrintTemplateName(templateName)] = normalizeDrPrintCalibration(calibration);
        });
    } catch (error) {
        console.warn('Unable to load DR print templates.', error);
    }
    return templates;
}

function saveDrPrintTemplates(nextTemplates = currentDrPrintTemplates) {
    currentDrPrintTemplates = Object.fromEntries(Object.entries(nextTemplates || {}).map(([templateName, calibration]) => [
        normalizeDrPrintTemplateName(templateName),
        normalizeDrPrintCalibration(calibration)
    ]));
    if (!Object.keys(currentDrPrintTemplates).length) {
        currentDrPrintTemplates.Default = normalizeDrPrintCalibration(DR_PRINT_CALIBRATION);
    }
    try {
        localStorage.setItem(DR_PRINT_TEMPLATE_LIBRARY_STORAGE_KEY, JSON.stringify(currentDrPrintTemplates));
    } catch (error) {
        console.warn('Unable to save DR print template library.', error);
    }
    return currentDrPrintTemplates;
}

function loadDrPrintActiveTemplateName() {
    try {
        return normalizeDrPrintTemplateName(localStorage.getItem(DR_PRINT_ACTIVE_TEMPLATE_STORAGE_KEY) || 'Default');
    } catch (error) {
        return 'Default';
    }
}

function saveDrPrintActiveTemplateName(templateName) {
    currentDrPrintTemplateName = normalizeDrPrintTemplateName(templateName);
    try {
        localStorage.setItem(DR_PRINT_ACTIVE_TEMPLATE_STORAGE_KEY, currentDrPrintTemplateName);
    } catch (error) {
        console.warn('Unable to save active DR print template.', error);
    }
    return currentDrPrintTemplateName;
}

function parseDrPrintTemplateJson(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        return Object.fromEntries(Object.entries(parsed || {}).map(([templateName, calibration]) => [
            normalizeDrPrintTemplateName(templateName),
            normalizeDrPrintCalibration(calibration)
        ]));
    } catch (error) {
        return {};
    }
}

function initializeDrPrintTemplateState() {
    currentDrPrintTemplates = loadDrPrintTemplates();
    const storedCalibration = loadDrPrintCalibration();
    const storedActive = loadDrPrintActiveTemplateName();
    let hasStoredActive = false;
    try {
        hasStoredActive = Boolean(localStorage.getItem(DR_PRINT_ACTIVE_TEMPLATE_STORAGE_KEY));
    } catch (error) {
        hasStoredActive = false;
    }
    if (hasStoredActive && currentDrPrintTemplates[storedActive]) {
        currentDrPrintTemplateName = storedActive;
        currentDrPrintCalibration = normalizeDrPrintCalibration(currentDrPrintTemplates[storedActive]);
        return;
    }
    if (!drPrintCalibrationsEqual(storedCalibration, DR_PRINT_CALIBRATION)) {
        currentDrPrintTemplateName = 'Saved DR Layout';
        currentDrPrintTemplates[currentDrPrintTemplateName] = storedCalibration;
        currentDrPrintCalibration = storedCalibration;
    } else {
        currentDrPrintTemplateName = 'Default';
        currentDrPrintCalibration = normalizeDrPrintCalibration(DR_PRINT_CALIBRATION);
    }
    saveDrPrintTemplates(currentDrPrintTemplates);
    saveDrPrintActiveTemplateName(currentDrPrintTemplateName);
}

async function loadDrPrintTemplatesFromFirestore() {
    const doc = await fetchDoc(DR_PRINT_TEMPLATE_FIRESTORE_COLLECTION, DR_PRINT_TEMPLATE_FIRESTORE_DOC_ID);
    if (!doc) return null;
    return {
        templates: {
            Default: normalizeDrPrintCalibration(DR_PRINT_CALIBRATION),
            ...parseDrPrintTemplateJson(doc.templates_json)
        },
        activeTemplateName: normalizeDrPrintTemplateName(doc.active_template_name || 'Default')
    };
}

async function saveDrPrintTemplatesToFirestore() {
    return setDocument(DR_PRINT_TEMPLATE_FIRESTORE_COLLECTION, DR_PRINT_TEMPLATE_FIRESTORE_DOC_ID, {
        setting_key: DR_PRINT_TEMPLATE_SETTING_KEY,
        active_template_name: currentDrPrintTemplateName,
        templates_json: JSON.stringify(currentDrPrintTemplates),
        updated_at: new Date().toISOString(),
        source_module: 'releasing'
    }, {
        label: 'DR print templates',
        dedupeKey: `${DR_PRINT_TEMPLATE_FIRESTORE_COLLECTION}:${DR_PRINT_TEMPLATE_FIRESTORE_DOC_ID}`
    });
}

async function ensureDrPrintTemplatesReady(options = {}) {
    if (drPrintTemplatesLoadedFromFirebase && !options.force) return currentDrPrintTemplates;
    if (drPrintTemplatesFirebasePromise && !options.force) return drPrintTemplatesFirebasePromise;
    drPrintTemplatesFirebasePromise = (async () => {
        try {
            const firebaseState = await loadDrPrintTemplatesFromFirestore();
            if (firebaseState?.templates) {
                currentDrPrintTemplates = saveDrPrintTemplates({
                    ...currentDrPrintTemplates,
                    ...firebaseState.templates
                });
                const nextActive = currentDrPrintTemplates[firebaseState.activeTemplateName]
                    ? firebaseState.activeTemplateName
                    : currentDrPrintTemplateName;
                applyDrPrintTemplate(nextActive);
            }
            drPrintTemplatesLoadedFromFirebase = true;
        } catch (error) {
            console.warn('Unable to sync DR print templates from Firebase.', error);
        } finally {
            drPrintTemplatesFirebasePromise = null;
        }
        return currentDrPrintTemplates;
    })();
    return drPrintTemplatesFirebasePromise;
}

function saveDrPrintCalibration(nextValue, options = {}) {
    const shouldPersistTemplate = options.persistTemplate !== false;
    currentDrPrintCalibration = normalizeDrPrintCalibration(nextValue);
    try {
        localStorage.setItem(DR_PRINT_CALIBRATION_STORAGE_KEY, JSON.stringify(currentDrPrintCalibration));
    } catch (error) {
        console.warn('Unable to save DR print adjustment locally.', error);
    }
    if (shouldPersistTemplate) {
        currentDrPrintTemplates[currentDrPrintTemplateName] = currentDrPrintCalibration;
        saveDrPrintTemplates(currentDrPrintTemplates);
    }
    return currentDrPrintCalibration;
}

function resetDrPrintCalibration() {
    saveDrPrintActiveTemplateName('Default');
    return saveDrPrintCalibration(DR_PRINT_CALIBRATION);
}

function applyDrPrintTemplate(templateName) {
    const normalizedName = normalizeDrPrintTemplateName(templateName);
    const nextCalibration = currentDrPrintTemplates[normalizedName];
    if (!nextCalibration) return currentDrPrintCalibration;
    saveDrPrintActiveTemplateName(normalizedName);
    return saveDrPrintCalibration(nextCalibration, { persistTemplate: false });
}

function saveCurrentDrPrintTemplate(templateName) {
    const normalizedName = normalizeDrPrintTemplateName(templateName || currentDrPrintTemplateName);
    saveDrPrintActiveTemplateName(normalizedName);
    currentDrPrintTemplates[normalizedName] = normalizeDrPrintCalibration(currentDrPrintCalibration);
    saveDrPrintTemplates(currentDrPrintTemplates);
    return currentDrPrintTemplates[normalizedName];
}

function deleteDrPrintTemplate(templateName) {
    const normalizedName = normalizeDrPrintTemplateName(templateName);
    if (normalizedName === 'Default') return currentDrPrintCalibration;
    const nextTemplates = { ...currentDrPrintTemplates };
    delete nextTemplates[normalizedName];
    saveDrPrintTemplates(nextTemplates);
    const nextActive = currentDrPrintTemplates[currentDrPrintTemplateName] ? currentDrPrintTemplateName : 'Default';
    return applyDrPrintTemplate(nextActive);
}

function getDrPrintPaperDimensions(calibration = currentDrPrintCalibration) {
    return {
        widthCm: calibration.paperWidthCm,
        heightCm: calibration.paperHeightCm,
        widthMm: calibration.paperWidthCm * 10,
        heightMm: calibration.paperHeightCm * 10
    };
}

function getDrPrintSectionCalibration(sectionKey) {
    return currentDrPrintCalibration.sections?.[sectionKey] || DR_PRINT_CALIBRATION.sections[sectionKey];
}

function drSizeUnit(valueMm, mode = 'print') {
    return mode === 'screen'
        ? `${Number(valueMm || 0) * DR_PREVIEW_MM_PX}px`
        : `${valueMm}mm`;
}

function buildDrPositionStyle(config = {}, mode = 'print') {
    const parts = ['position:absolute'];
    if (config.xMm !== undefined) parts.push(`left:${drSizeUnit(config.xMm, mode)}`);
    if (config.yMm !== undefined) parts.push(`top:${drSizeUnit(config.yMm, mode)}`);
    if (config.widthMm !== undefined) parts.push(`width:${drSizeUnit(config.widthMm, mode)}`);
    if (config.textAlign) parts.push(`text-align:${config.textAlign}`);
    return parts.join(';');
}

function buildDrSectionStyle(sectionKey, mode = 'print') {
    const layout = DR_PRINT_SECTION_LAYOUT[sectionKey];
    const calibration = getDrPrintSectionCalibration(sectionKey);
    return [
        'position:absolute',
        `left:${drSizeUnit((layout?.xMm || 0) + (calibration?.xMm || 0), mode)}`,
        `top:${drSizeUnit((layout?.yMm || 0) + (calibration?.yMm || 0), mode)}`,
        'transform-origin:top left',
        `transform:scale(${calibration?.fontScale || 1})`
    ].join(';');
}

function renderDrPrintAdjustmentControls() {
    const panel = document.getElementById('releasePrintAdjustPanel');
    if (!panel) return;
    const templateOptions = Object.keys(currentDrPrintTemplates)
        .sort((left, right) => left.localeCompare(right))
        .map((templateName) => `<option value="${escapeAttr(templateName)}"${templateName === currentDrPrintTemplateName ? ' selected' : ''}>${escapeHtml(templateName)}</option>`)
        .join('');
    panel.innerHTML = `
        <div class="release-template-grid">
            <label class="release-print-field">
                <span>Template</span>
                <select id="releasePrintTemplateSelect">${templateOptions}</select>
            </label>
            <label class="release-print-field">
                <span>Template Name</span>
                <input type="text" id="releasePrintTemplateNameInput" value="${escapeAttr(currentDrPrintTemplateName)}" placeholder="DR preprint layout">
            </label>
            <div class="release-template-actions">
                <button type="button" class="btn btn-secondary btn-sm" id="releasePrintSaveTemplateBtn">Save Template</button>
                <button type="button" class="btn btn-secondary btn-sm" id="releasePrintDeleteTemplateBtn"${currentDrPrintTemplateName === 'Default' ? ' disabled' : ''}>Delete</button>
            </div>
        </div>
        <div class="release-print-grid">
            <label class="release-print-field">
                <span>Paper W (cm)</span>
                <input type="number" data-dr-print-control="paperWidthCm" step="0.1" min="10" max="40" value="${escapeAttr(String(currentDrPrintCalibration.paperWidthCm))}">
            </label>
            <label class="release-print-field">
                <span>Paper H (cm)</span>
                <input type="number" data-dr-print-control="paperHeightCm" step="0.1" min="10" max="40" value="${escapeAttr(String(currentDrPrintCalibration.paperHeightCm))}">
            </label>
            <label class="release-print-field">
                <span>Left (mm)</span>
                <input type="number" data-dr-print-control="offsetXmm" step="0.5" value="${escapeAttr(String(currentDrPrintCalibration.offsetXmm))}">
            </label>
            <label class="release-print-field">
                <span>Top (mm)</span>
                <input type="number" data-dr-print-control="offsetYmm" step="0.5" value="${escapeAttr(String(currentDrPrintCalibration.offsetYmm))}">
            </label>
            <label class="release-print-field">
                <span>Scale</span>
                <input type="number" data-dr-print-control="scale" step="0.01" min="0.7" max="1.35" value="${escapeAttr(String(currentDrPrintCalibration.scale))}">
            </label>
        </div>
        <div class="release-print-section-title">Section Adjustments</div>
        <div class="release-section-grid">
            ${Object.entries(DR_PRINT_SECTION_LAYOUT).map(([sectionKey, layout]) => {
                const calibration = getDrPrintSectionCalibration(sectionKey);
                return `
                    <div class="release-section-card">
                        <h4>${escapeHtml(layout.label)}</h4>
                        <p>${escapeHtml(layout.subtitle)}</p>
                        <div class="release-print-grid">
                            <label class="release-print-field">
                                <span>X (mm)</span>
                                <input type="number" data-dr-section-key="${escapeAttr(sectionKey)}" data-dr-section-field="xMm" step="0.5" value="${escapeAttr(String(calibration.xMm))}">
                            </label>
                            <label class="release-print-field">
                                <span>Y (mm)</span>
                                <input type="number" data-dr-section-key="${escapeAttr(sectionKey)}" data-dr-section-field="yMm" step="0.5" value="${escapeAttr(String(calibration.yMm))}">
                            </label>
                            <label class="release-print-field">
                                <span>Font</span>
                                <input type="number" data-dr-section-key="${escapeAttr(sectionKey)}" data-dr-section-field="fontScale" step="0.05" min="0.65" max="1.8" value="${escapeAttr(String(calibration.fontScale))}">
                            </label>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function handleDrPrintControlInput(event) {
    const target = event.target;
    if (target?.id === 'releasePrintTemplateSelect') {
        applyDrPrintTemplate(target.value);
        renderDrPrintAdjustmentControls();
        renderActiveDrPreview();
        return;
    }
    if (!target?.matches?.('[data-dr-print-control], [data-dr-section-key][data-dr-section-field]')) return;
    updateDrPrintCalibrationFromControls();
}

async function handleDrPrintToolClick(event) {
    if (event.target?.id === 'releasePrintResetBtn') {
        resetDrPrintCalibration();
        renderDrPrintAdjustmentControls();
        renderActiveDrPreview();
        return;
    }
    if (event.target?.id === 'releasePrintSaveTemplateBtn') {
        const nameInput = document.getElementById('releasePrintTemplateNameInput');
        saveCurrentDrPrintTemplate(nameInput?.value || currentDrPrintTemplateName);
        renderDrPrintAdjustmentControls();
        renderActiveDrPreview();
        await saveDrPrintTemplatesToFirestore().catch((error) => console.warn('Unable to sync DR print template save.', error));
        MargaUtils.showToast(`DR print template "${currentDrPrintTemplateName}" saved.`, 'success');
        return;
    }
    if (event.target?.id === 'releasePrintDeleteTemplateBtn') {
        const deletedTemplate = currentDrPrintTemplateName;
        deleteDrPrintTemplate(currentDrPrintTemplateName);
        renderDrPrintAdjustmentControls();
        renderActiveDrPreview();
        await saveDrPrintTemplatesToFirestore().catch((error) => console.warn('Unable to sync DR print template delete.', error));
        MargaUtils.showToast(`DR print template "${deletedTemplate}" deleted.`, 'success');
    }
}

function updateDrPrintCalibrationFromControls() {
    const modal = document.getElementById('releasePreviewModal');
    const nextSections = Object.fromEntries(Object.keys(DR_PRINT_SECTION_LAYOUT).map((sectionKey) => {
        const defaults = currentDrPrintCalibration.sections?.[sectionKey] || DR_PRINT_CALIBRATION.sections[sectionKey];
        const sectionValues = { ...defaults };
        modal.querySelectorAll('[data-dr-section-key][data-dr-section-field]').forEach((input) => {
            if (input.dataset.drSectionKey !== sectionKey) return;
            const field = input.dataset.drSectionField;
            if (!field) return;
            sectionValues[field] = Number(input.value || 0);
        });
        return [sectionKey, sectionValues];
    }));
    const controlValue = (key, fallback) => {
        const input = modal.querySelector(`[data-dr-print-control="${key}"]`);
        return input ? Number(input.value || 0) : fallback;
    };
    saveDrPrintCalibration({
        paperWidthCm: controlValue('paperWidthCm', currentDrPrintCalibration.paperWidthCm),
        paperHeightCm: controlValue('paperHeightCm', currentDrPrintCalibration.paperHeightCm),
        offsetXmm: controlValue('offsetXmm', currentDrPrintCalibration.offsetXmm),
        offsetYmm: controlValue('offsetYmm', currentDrPrintCalibration.offsetYmm),
        scale: controlValue('scale', currentDrPrintCalibration.scale),
        sections: nextSections
    });
    renderActiveDrPreview();
}

function renderActiveDrPreview() {
    if (!releaseState.pendingPreview) return;
    document.getElementById('releasePreviewPage').innerHTML = buildDrPrintHtml(releaseState.pendingPreview, 'screen');
}

function buildDrSectionedLayoutHtml(payload, mode = 'print') {
    return `
        <div class="dr-section-block" style="${buildDrSectionStyle('company', mode)}">
            <div class="dr-company-name" style="${buildDrPositionStyle({ xMm: 0, yMm: 0, widthMm: 150 }, mode)}">${escapeHtml(payload.client)}</div>
            <div class="dr-company-address" style="${buildDrPositionStyle({ xMm: 0, yMm: 10, widthMm: 150 }, mode)}">${escapeHtml(payload.address || '')}</div>
        </div>
        <div class="dr-section-block" style="${buildDrSectionStyle('date', mode)}">
            <div class="dr-print-date-text" style="${buildDrPositionStyle({ xMm: 0, yMm: 0, widthMm: 34 }, mode)}">${escapeHtml(payload.date)}</div>
        </div>
        <div class="dr-section-block" style="${buildDrSectionStyle('details', mode)}">
            <div class="dr-print-meta">
                <div><strong>Reference No. :</strong>&nbsp;&nbsp;${escapeHtml(payload.referenceNo)}</div>
                <div><strong>B. Meter :</strong>&nbsp;&nbsp;${escapeHtml(payload.bmeter || '')}</div>
            </div>
            <table class="dr-print-table" style="${mode === 'screen' ? `width:${drSizeUnit(172, mode)}` : 'width:172mm'}">
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
        </div>
        <div class="dr-section-block" style="${buildDrSectionStyle('releasedBy', mode)}">
            <div style="${buildDrPositionStyle({ xMm: 0, yMm: 0, widthMm: 42, textAlign: 'center' }, mode)}">Released by :</div>
        </div>
        <div class="dr-section-block" style="${buildDrSectionStyle('deliveryBy', mode)}">
            <div style="${buildDrPositionStyle({ xMm: 0, yMm: 0, widthMm: 42, textAlign: 'center' }, mode)}">Deliver by :</div>
        </div>
    `;
}

function buildDrPrintHtml(payload, mode = 'screen') {
    const paper = getDrPrintPaperDimensions(currentDrPrintCalibration);
    return `
        <section class="dr-calibration-shell" aria-label="DR print preview">
            <div
                class="dr-calibration-paper"
                style="--paper-width-mm:${paper.widthMm}; --paper-height-mm:${paper.heightMm};"
            >
                <div
                    class="dr-calibration-sheet"
                    style="transform: translate(${drSizeUnit(currentDrPrintCalibration.offsetXmm, mode)}, ${drSizeUnit(currentDrPrintCalibration.offsetYmm, mode)}) scale(${currentDrPrintCalibration.scale});"
                >
                    ${buildDrSectionedLayoutHtml(payload, mode)}
                </div>
            </div>
        </section>
    `;
}

async function printAndSaveRelease() {
    const payload = releaseState.pendingPreview || buildPrintPayload();
    const button = document.getElementById('releasePreviewPrintBtn');
    const printWindow = openPrintWindow(`marga_dr_${payload.drNumber || payload.referenceNo}`);
    if (!printWindow) return;
    const saveSignature = buildDrSaveSignature(payload);
    button.disabled = true;
    try {
        if (releaseState.lastSavedDrSignature !== saveSignature) {
            await saveReleaseDr(payload);
            releaseState.lastSavedDrSignature = saveSignature;
            MargaUtils.showToast(`DR ${payload.drNumber} saved.`, 'success');
        } else {
            MargaUtils.showToast(`DR ${payload.drNumber} already saved. Reopening print.`, 'success');
        }
        writePrintHtmlDocument(printWindow, buildPrintDocument(payload));
    } catch (error) {
        printWindow.close();
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
    await markReleasedMachinesPendingDelivery(payload, now);
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
        production_allocated_machine_id: row.allocatedMachineId || '',
        customer_link_status: row.category === 'MACHINE' ? 'pending_delivery' : '',
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

async function markReleasedMachinesPendingDelivery(payload, now) {
    const machineRows = releaseState.createRows.filter((row) => row.category === 'MACHINE' && row.allocatedMachineId);
    for (const row of machineRows) {
        await patchDocument('tbl_machine', row.allocatedMachineId, {
            status_id: 2,
            customer_link_status: 'pending_delivery',
            pending_client_id: Number(row.branchId || 0) || 0,
            pending_customer_name: row.company,
            pending_dr_number: payload.drNumber,
            pending_finaldr_reference: payload.referenceNo,
            pending_delivery_saved_at: now,
            pending_delivery_saved_by: currentUserLabel(),
            tmestamp: now
        }, {
            label: `Pending delivery machine ${row.serial}`,
            dedupeKey: `releasing-machine-pending:${row.allocatedMachineId}:${payload.drNumber}`
        });
    }
}

async function allocateNextId(collection) {
    const latest = await fetchLatestRows(collection, 1);
    const next = Number(latest[0]?.id || latest[0]?._docId || 0) + 1;
    if (!Number.isFinite(next) || next <= 0) throw new Error(`Unable to allocate ${collection} id.`);
    return next;
}

function openPrintWindow(windowName) {
    const printWindow = window.open('', windowName, 'width=1000,height=760');
    if (!printWindow) {
        alert('Please allow pop-ups to print the DR.');
        return null;
    }
    printWindow.document.write('<!DOCTYPE html><html><head><title>Preparing DR</title></head><body style="font-family:Arial,sans-serif;padding:24px;">Preparing DR print...</body></html>');
    printWindow.document.close();
    return printWindow;
}

function writePrintHtmlDocument(printWindow, html) {
    if (!printWindow) return;
    printWindow.document.open();
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

function printHtmlDocument(html, windowName) {
    const printWindow = openPrintWindow(windowName);
    if (!printWindow) return;
    writePrintHtmlDocument(printWindow, html);
}

function buildPulloutPrintDocument(payload) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Pull Out ${escapeHtml(payload.pickupReceipt || payload.referenceNo)}</title>
            <style>
                @page { size: letter; margin: 12mm; }
                * { box-sizing: border-box; }
                body {
                    margin: 0;
                    color: #111;
                    font-family: Arial, sans-serif;
                    font-size: 12px;
                    line-height: 1.35;
                }
                .form-head {
                    display: flex;
                    justify-content: space-between;
                    gap: 16px;
                    border-bottom: 2px solid #111;
                    padding-bottom: 10px;
                    margin-bottom: 14px;
                }
                h1 {
                    margin: 0;
                    font-size: 20px;
                    letter-spacing: 0;
                    text-transform: uppercase;
                }
                .meta {
                    display: grid;
                    gap: 4px;
                    min-width: 210px;
                    text-align: right;
                    font-weight: 700;
                }
                .section {
                    margin-top: 12px;
                    border: 1px solid #111;
                }
                .section-title {
                    border-bottom: 1px solid #111;
                    padding: 5px 7px;
                    font-weight: 800;
                    text-transform: uppercase;
                    background: #f2f2f2;
                }
                .grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 0;
                }
                .field {
                    min-height: 34px;
                    border-right: 1px solid #111;
                    border-bottom: 1px solid #111;
                    padding: 5px 7px;
                }
                .field:nth-child(2n) { border-right: 0; }
                .label {
                    display: block;
                    margin-bottom: 2px;
                    font-size: 9px;
                    font-weight: 800;
                    text-transform: uppercase;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                }
                th,
                td {
                    border: 1px solid #111;
                    padding: 6px;
                    text-align: left;
                    vertical-align: top;
                }
                th {
                    background: #f2f2f2;
                    font-size: 10px;
                    text-transform: uppercase;
                }
                .signatures {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 18px;
                    margin-top: 34px;
                }
                .sig-line {
                    border-top: 1px solid #111;
                    padding-top: 5px;
                    text-align: center;
                    font-weight: 700;
                }
            </style>
        </head>
        <body>
            <div class="form-head">
                <div>
                    <h1>Machine / Item Pull Out Form</h1>
                    <div>MARGA Enterprises</div>
                </div>
                <div class="meta">
                    <div>Receipt: ${escapeHtml(payload.pickupReceipt)}</div>
                    <div>Reference: ${escapeHtml(payload.referenceNo)}</div>
                    <div>Date: ${escapeHtml(payload.eventDate)} ${escapeHtml(payload.eventTime)}</div>
                </div>
            </div>
            <div class="section">
                <div class="section-title">Customer</div>
                <div class="grid">
                    <div class="field"><span class="label">Client</span>${escapeHtml(payload.client)}</div>
                    <div class="field"><span class="label">Address</span>${escapeHtml(payload.address || '')}</div>
                    <div class="field"><span class="label">Pulled Out By</span>${escapeHtml(payload.pulledBy)}</div>
                    <div class="field"><span class="label">Released By / Customer Rep</span>${escapeHtml(payload.customerRep)}</div>
                </div>
            </div>
            <div class="section">
                <div class="section-title">Items Pulled Out</div>
                <table>
                    <thead>
                        <tr>
                            <th style="width:18%">Category</th>
                            <th style="width:20%">Model</th>
                            <th style="width:18%">Serial</th>
                            <th style="width:18%">Replacement Serial</th>
                            <th>Remarks</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${payload.items.map((item) => `
                            <tr>
                                <td>${escapeHtml(item.category)}</td>
                                <td>${escapeHtml(item.model)}</td>
                                <td>${escapeHtml(item.serial)}</td>
                                <td>${escapeHtml(item.replacementSerial)}</td>
                                <td>${escapeHtml(item.notes || payload.remarks || '')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="section">
                <div class="section-title">Pull Out Remarks</div>
                <div style="min-height:42px;padding:7px;">${escapeHtml(payload.remarks || '')}</div>
            </div>
            <div class="signatures">
                <div class="sig-line">Pulled Out By</div>
                <div class="sig-line">Customer Representative</div>
                <div class="sig-line">Office Receiving</div>
            </div>
        </body>
        </html>
    `;
}

function buildPrintDocument(payload) {
    const paper = getDrPrintPaperDimensions(currentDrPrintCalibration);
    const paperWidth = `${paper.widthCm}cm`;
    const paperHeight = `${paper.heightCm}cm`;
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>DR ${escapeHtml(payload.drNumber || payload.referenceNo)}</title>
            <style>
                @page { size: ${paperWidth} ${paperHeight}; margin: 0; }
                * { box-sizing: border-box; }
                html,
                body {
                    margin: 0;
                    padding: 0;
                    width: ${paperWidth};
                    height: ${paperHeight};
                    background: #fff;
                    overflow: hidden;
                }
                body { font-family: Arial, sans-serif; color: #111; }
                .print-wrap {
                    position: relative;
                    width: ${paperWidth};
                    height: ${paperHeight};
                    overflow: hidden;
                    page-break-after: avoid;
                }
                .dr-calibration-shell,
                .dr-calibration-paper {
                    position: relative;
                    width: ${paperWidth};
                    height: ${paperHeight};
                    overflow: hidden;
                    background: transparent;
                }
                .dr-calibration-sheet {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 210mm;
                    height: 270mm;
                    color: #111;
                    font-size: 3.6mm;
                    font-weight: 700;
                    line-height: 1.24;
                    transform-origin: top left;
                }
                .dr-section-block,
                .dr-block-field { position: absolute; }
                .dr-company-name { font-size: 1.25em; font-weight: 900; line-height: 1.15; }
                .dr-company-address { margin-top: 0.45em; font-weight: 800; }
                .dr-print-date-text { font-weight: 900; }
                .dr-print-meta { display: grid; gap: 7mm; margin: 0 0 7mm; }
                .dr-print-table { border-collapse: collapse; table-layout: fixed; font-size: 3.2mm; }
                .dr-print-table th,
                .dr-print-table td { padding: 1.4mm 1.8mm; text-align: left; vertical-align: top; }
                .dr-print-table th { font-size: 2.9mm; font-weight: 900; }
                .dr-print-table .qty-cell,
                .qty-cell { width: 14mm; text-align: center; }
                .dr-print-current { margin: 8mm 0 0; font-weight: 900; }
            </style>
        </head>
        <body><div class="print-wrap">${buildDrPrintHtml(payload, 'print')}</div></body>
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
