if (!MargaAuth.requireAccess('general-production')) {
    throw new Error('Unauthorized access to General Production module.');
}

const GP_STATUS_FALLBACKS = [
    { id: 1, status: 'IN STOCK' },
    { id: 2, status: 'FOR DELIVERY' },
    { id: 3, status: 'DELIVERED' },
    { id: 4, status: 'USED / IN THE COMPANY' },
    { id: 5, status: 'FOR JUNK' },
    { id: 6, status: 'JUNK' },
    { id: 7, status: 'FOR OVERHAULING' },
    { id: 8, status: 'UNDER REPAIR' },
    { id: 9, status: 'FOR PARTS' },
    { id: 10, status: 'FOR SALE' },
    { id: 11, status: 'TRADE IN' },
    { id: 12, status: 'OUTSIDE REPAIR' },
    { id: 13, status: 'MISSING' },
    { id: 14, status: 'OLD' },
    { id: 15, status: 'UNDER QC' },
    { id: 17, status: 'N/A' },
    { id: 18, status: 'Delivered (No Contract/To Receive)' }
];

const GP_PURPOSE_LABELS = {
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

const GP_ZERO_DATES = new Set(['', '0000-00-00', '0000-00-00 00:00:00', 'null', 'undefined']);
const GP_SERIAL_STOPWORDS = /\b(PAYMENT|SERIAL|DUPLICATE|BUYER|ARROW)\b/i;
const GP_ROWS_PER_PANEL = 500;
const GP_LEGACY_PANEL_LIMITS = {
    requests: 99,
    termination: 34,
    purchase: 3,
    overhaulSource: 2
};

const GP_STATE = {
    loading: false,
    family: 'all',
    search: '',
    raw: {},
    maps: {
        machines: new Map(),
        models: new Map(),
        brands: new Map(),
        branches: new Map(),
        companies: new Map(),
        employees: new Map(),
        troubles: new Map(),
        contractDeps: new Map(),
        contractsByMachine: new Map()
    },
    statuses: GP_STATUS_FALLBACKS.slice(),
    rows: {
        requests: [],
        termination: [],
        purchase: [],
        overhaulSource: [],
        ready: [],
        forOverhaul: [],
        underRepair: []
    },
    view: {},
    selectedMachine: null,
    machineCheckerRecords: [],
    machineCheckerActiveIndex: -1
};

document.addEventListener('DOMContentLoaded', () => {
    hydrateUserChrome();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    bindControls();
    loadProductionData();
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

function bindControls() {
    document.getElementById('gpRefreshBtn').addEventListener('click', () => loadProductionData());
    document.getElementById('machineCheckerBtn').addEventListener('click', openMachineChecker);
    document.getElementById('machineCheckerCloseBtn').addEventListener('click', closeMachineChecker);
    document.getElementById('machineCheckerOverlay').addEventListener('click', closeMachineChecker);
    document.getElementById('gpSearchInput').addEventListener('input', MargaUtils.debounce((event) => {
        GP_STATE.search = String(event.target.value || '').trim().toLowerCase();
        renderAllBoards();
    }, 120));

    document.querySelectorAll('.gp-segment button').forEach((button) => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.gp-segment button').forEach((item) => item.classList.remove('is-active'));
            button.classList.add('is-active');
            GP_STATE.family = button.dataset.family || 'all';
            renderAllBoards();
        });
    });

    document.querySelectorAll('[data-export]').forEach((button) => {
        button.addEventListener('click', () => exportRows(button.dataset.export));
    });

    document.getElementById('statusSerialInput').addEventListener('input', handleSerialSearchInput);
    document.getElementById('statusSerialInput').addEventListener('focus', handleSerialSearchInput);
    document.getElementById('statusSerialInput').addEventListener('keydown', handleSerialSearchKeydown);
    document.addEventListener('click', (event) => {
        if (!event.target.closest('.gp-serial-field')) hideSerialResults();
    });
    document.getElementById('statusChangerForm').addEventListener('submit', saveMachineStatus);
    document.getElementById('newMachineBrandInput').addEventListener('change', () => populateModelOptions());
    document.getElementById('addMachineForm').addEventListener('submit', saveNewMachine);
}

async function loadProductionData() {
    if (GP_STATE.loading) return;
    GP_STATE.loading = true;
    setStatus('Loading production sources...');
    setLoadingRows();

    try {
        const [
            machines,
            models,
            brands,
            branches,
            companies,
            employees,
            troubles,
            machineStatuses,
            schedules,
            contracts,
            contractDeps,
            productionQueue,
            machineOrders,
            pickupReceipts,
            terminationRecords,
            shutdownRows,
            shutdownMachines,
            machineHistory,
            billingMachineRows
        ] = await Promise.all([
            fetchOptionalCollection('tbl_machine', 1200),
            fetchOptionalCollection('tbl_model', 600),
            fetchOptionalCollection('tbl_brand', 400),
            fetchOptionalCollection('tbl_branchinfo', 1200),
            fetchOptionalCollection('tbl_companylist', 1000),
            fetchOptionalCollection('tbl_employee', 800),
            fetchOptionalCollection('tbl_trouble', 900),
            fetchOptionalCollection('tbl_newmachinestatus', 200),
            fetchLatestRows('tbl_schedule', 3000).catch(() => fetchOptionalCollection('tbl_schedule', 1200)),
            fetchOptionalCollection('tbl_contractmain', 1200),
            fetchOptionalCollection('tbl_contractdep', 1200),
            fetchOptionalCollection('marga_production_queue', 500),
            fetchLatestRows('tbl_machineorder', 500).catch(() => fetchOptionalCollection('tbl_machineorder', 500)),
            fetchLatestRows('tbl_machinepickupreceipt', 500).catch(() => fetchOptionalCollection('tbl_machinepickupreceipt', 500)),
            fetchLatestRows('tbl_terminationrecords', 500).catch(() => fetchOptionalCollection('tbl_terminationrecords', 500)),
            fetchLatestRows('tbl_forshutdown', 500).catch(() => fetchOptionalCollection('tbl_forshutdown', 500)),
            fetchLatestRows('tbl_shutdownmachines', 500).catch(() => fetchOptionalCollection('tbl_shutdownmachines', 500)),
            fetchLatestRows('tbl_newmachinehistory', 900).catch(() => fetchOptionalCollection('tbl_newmachinehistory', 900)),
            fetchBillingMachineRows().catch((error) => {
                console.warn('Billing machine rows unavailable for Machine Checker.', error);
                return [];
            })
        ]);

        GP_STATE.raw = {
            machines,
            models,
            brands,
            branches,
            companies,
            employees,
            troubles,
            schedules,
            contracts,
            contractDeps,
            productionQueue,
            machineOrders,
            pickupReceipts,
            terminationRecords,
            shutdownRows,
            shutdownMachines,
            machineHistory,
            billingMachineRows
        };
        GP_STATE.statuses = normalizeStatuses(machineStatuses);
        buildLookupMaps();
        buildProductionRows();
        populateMachineCheckerOptions();
        renderAllBoards();

        const stamp = new Date().toLocaleString('en-PH', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        setStatus(`Refreshed ${stamp}`);
        document.getElementById('gpSubtitle').textContent = `${GP_STATE.rows.requests.length} machine request(s), ${GP_STATE.rows.ready.length} ready machine(s), ${GP_STATE.rows.underRepair.length} under repair.`;
    } catch (error) {
        console.error('General Production load failed:', error);
        setStatus('Load failed. Try Refresh All.', true);
        document.getElementById('gpSubtitle').textContent = 'Unable to load production sources.';
    } finally {
        GP_STATE.loading = false;
    }
}

async function fetchOptionalCollection(collection, pageSize = 500) {
    try {
        return await MargaUtils.fetchCollection(collection, pageSize);
    } catch (error) {
        console.warn(`${collection} unavailable for General Production.`, error);
        return [];
    }
}

async function fetchLatestRows(collectionId, limit = 500, orderField = 'id') {
    const structuredQuery = {
        from: [{ collectionId }],
        orderBy: [{ field: { fieldPath: orderField }, direction: 'DESCENDING' }],
        limit
    };

    const response = await fetch(`${FIREBASE_CONFIG.baseUrl}:runQuery?key=${FIREBASE_CONFIG.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
    });
    const payload = await response.json();
    if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message || `Failed to query ${collectionId}`);
    }
    return payload
        .map((item) => item.document ? MargaUtils.parseFirestoreDoc(item.document) : null)
        .filter(Boolean);
}

async function fetchBillingMachineRows() {
    const now = new Date();
    const params = new URLSearchParams();
    params.set('end_year', String(now.getFullYear()));
    params.set('end_month', String(now.getMonth() + 1));
    params.set('months_back', '6');
    params.set('row_limit', '5000');
    params.set('latest_limit', '100');
    params.set('max_billing_pages', '10');
    params.set('max_schedule_pages', '10');
    params.set('include_rows', 'true');
    params.set('include_active_rows', 'true');
    params.set('include_machine_history', 'true');
    params.set('refresh_cache', 'false');

    const response = await fetch(`/.netlify/functions/openclaw-billing-cohort?${params.toString()}`);
    const payload = await response.json();
    if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || `Billing machine rows failed (${response.status})`);
    }
    return Array.isArray(payload?.month_matrix?.rows) ? payload.month_matrix.rows : [];
}

function normalizeStatuses(rows) {
    const source = Array.isArray(rows) && rows.length ? rows : GP_STATUS_FALLBACKS;
    const statuses = source
        .map((row) => ({
            id: Number(row.id || row.status_id || 0),
            status: clean(row.status || row.machine_status || row.label || row.name)
        }))
        .filter((row) => row.id > 0 && row.status);
    return statuses.length ? statuses.sort((a, b) => a.id - b.id) : GP_STATUS_FALLBACKS.slice();
}

function buildLookupMaps() {
    GP_STATE.maps.machines = keyedMap(GP_STATE.raw.machines);
    GP_STATE.maps.models = keyedMap(GP_STATE.raw.models);
    GP_STATE.maps.brands = keyedMap(GP_STATE.raw.brands);
    GP_STATE.maps.branches = keyedMap(GP_STATE.raw.branches);
    GP_STATE.maps.companies = keyedMap(GP_STATE.raw.companies);
    GP_STATE.maps.employees = keyedMap(GP_STATE.raw.employees);
    GP_STATE.maps.troubles = keyedMap(GP_STATE.raw.troubles);
    GP_STATE.maps.contractDeps = keyedMap(GP_STATE.raw.contractDeps);
    GP_STATE.maps.contractsByMachine = buildContractsByMachineMap(GP_STATE.raw.contracts);
}

function keyedMap(rows) {
    return new Map(
        (rows || [])
            .map((row) => [String(row._docId || row.id || '').trim(), row])
            .filter(([id]) => id)
    );
}

function buildContractsByMachineMap(rows) {
    const map = new Map();
    (rows || []).forEach((contract) => {
        const machineId = String(contract?.mach_id || contract?.machine_id || '').trim();
        if (!machineId) return;
        if (!map.has(machineId)) map.set(machineId, []);
        map.get(machineId).push(contract);
    });
    return map;
}

function buildProductionRows() {
    const machineRows = (GP_STATE.raw.machines || []).map(normalizeMachineRow);
    const scheduleRows = (GP_STATE.raw.schedules || []).map(normalizeScheduleRow).filter(Boolean);
    const queueRows = (GP_STATE.raw.productionQueue || []).map(normalizeQueueRow).filter(Boolean);

    const requestRows = scheduleRows
        .filter((row) => row.bucket === 'request')
        .concat(queueRows.filter((row) => row.bucket === 'request'))
        .sort(sortByAgeDesc);

    const terminationRows = scheduleRows
        .filter((row) => row.bucket === 'termination')
        .sort(sortByAgeDesc);

    const purchaseRows = scheduleRows
        .filter((row) => row.bucket === 'purchase')
        .sort(sortByAgeDesc);

    const overhaulSourceRows = scheduleRows
        .filter((row) => row.bucket === 'overhaulSource')
        .concat(queueRows.filter((row) => row.bucket === 'overhaulSource'))
        .sort(sortByAgeDesc);

    const readyRows = machineRows
        .filter((row) => row.statusId === 1)
        .sort(sortMachineRows);

    const forOverhaulRows = machineRows
        .filter((row) => row.statusId === 7)
        .sort(sortMachineRows);

    const underRepairRows = machineRows
        .filter((row) => row.statusId === 8)
        .sort(sortMachineRows);

    GP_STATE.rows = {
        requests: limitLegacyPanelRows(dedupeRows(requestRows, 'key'), 'requests'),
        termination: limitLegacyPanelRows(dedupeRows(terminationRows, 'key'), 'termination'),
        purchase: limitLegacyPanelRows(dedupeRows(purchaseRows, 'key'), 'purchase'),
        overhaulSource: limitLegacyPanelRows(dedupeRows(overhaulSourceRows, 'key').concat(buildOverhaulSourceFallbackRows(requestRows)), 'overhaulSource'),
        ready: dedupeRows(readyRows, 'key'),
        forOverhaul: dedupeRows(forOverhaulRows, 'key'),
        underRepair: dedupeRows(underRepairRows, 'key')
    };
}

function normalizeScheduleRow(row) {
    if (!row || Number(row.iscancel || row.iscancelled || 0) === 1) return null;
    const purpose = GP_PURPOSE_LABELS[Number(row.purpose_id || 0)] || `Purpose ${row.purpose_id || '-'}`;
    const trouble = GP_STATE.maps.troubles.get(String(row.trouble_id || '')) || null;
    const machine = GP_STATE.maps.machines.get(String(row.serial || row.mach_id || '')) || null;
    const branch = GP_STATE.maps.branches.get(String(row.branch_id || '')) || null;
    const company = GP_STATE.maps.companies.get(String(row.company_id || branch?.company_id || '')) || null;
    const type = classifyScheduleType(row, purpose, trouble);
    if (!type) return null;

    const brand = getMachineBrand(machine);
    const model = getMachineModel(machine);
    const client = buildClientName(company, branch);
    const dateValue = firstDateValue(row.task_datetime, row.original_sched, row.created_at, row.requested_at);
    const requests = clean(row.customer_request || row.request_serial_number || row.machine_status) || 'N/A';
    const remarks = clean(row.remarks || row.route_remarks || row.tl_remarks || row.dev_remarks || trouble?.trouble);

    return {
        key: `schedule:${row._docId || row.id}`,
        source: Number(row.purpose_id || 0) === 7 ? 'PURCHASING' : 'SERVICE',
        sts: type.short,
        type: type.label,
        bucket: type.bucket,
        client,
        brand,
        model,
        machine: model || clean(machine?.description) || clean(row.request_serial_number) || '-',
        serial: clean(machine?.serial || row.request_serial_number),
        age: ageInDays(dateValue),
        requests,
        remarks: remarks || '-',
        tech: staffName(row.tech_id),
        family: detectFamily([brand, model, machine?.description, remarks, trouble?.trouble].join(' ')),
        searchText: [purpose, type.label, client, brand, model, machine?.serial, requests, remarks].join(' ').toLowerCase()
    };
}

function classifyScheduleType(row, purpose, trouble) {
    const text = [
        purpose,
        trouble?.trouble,
        row.remarks,
        row.route_remarks,
        row.customer_request,
        row.tl_remarks,
        row.dev_remarks
    ].join(' ').toLowerCase();
    const purposeId = Number(row.purpose_id || 0);
    if (/terminat|shutdown|pull\s*out|for\s*pull/.test(text)) return { label: 'FTR', short: 'FTR', bucket: 'termination' };
    if (/upgrade/.test(text)) return { label: 'UPGRADE', short: 'UPG', bucket: 'termination' };
    if (purposeId === 7 && /machine|printer|unit|pickup machine|pick up printer/.test(text)) return { label: 'TO PURCHASE', short: 'PR', bucket: 'purchase' };
    if (/purchase|to\s*purchase|buy.*machine|brand\s*new/.test(text)) return { label: 'TO PURCHASE', short: 'PR', bucket: 'purchase' };
    if (/overhaul|under\s*repair|repair\s*unit/.test(text)) return { label: 'FROM OVERHAUL', short: 'OH', bucket: 'overhaulSource' };
    if (/additional|addtn|new\s*unit|add\s*unit/.test(text)) return { label: 'NEW / ADDTN', short: 'NEW', bucket: 'request' };
    if (/change\s*unit|changeunit|replacement|replace|machine\s*request|request\s*machine|for\s*delivery/.test(text)) return { label: 'CHANGE UNIT', short: 'CU', bucket: 'request' };
    if (purposeId === 5 && /machine|unit|serial|printer|copier|mfc|dcp/.test(text)) return { label: 'MACHINE REQUEST', short: 'REQ', bucket: 'request' };
    return null;
}

function normalizeQueueRow(row) {
    const machine = GP_STATE.maps.machines.get(String(row.machine_id || row.mach_id || row.serial || '')) || null;
    const branch = GP_STATE.maps.branches.get(String(row.branch_id || '')) || null;
    const company = GP_STATE.maps.companies.get(String(row.company_id || branch?.company_id || '')) || null;
    const text = [row.notes, row.final_summary, row.machine_status, row.status, row.source].join(' ').toLowerCase();
    const bucket = /overhaul/.test(text) ? 'overhaulSource' : (/repair|pending|parts/.test(text) ? 'underRepair' : 'request');
    const brand = getMachineBrand(machine);
    const model = getMachineModel(machine);
    const remarks = clean(row.notes || row.final_summary || row.status);

    return {
        key: `queue:${row._docId || row.id || `${row.schedule_id}_${row.requested_at}`}`,
        source: clean(row.source || 'FIELD APP').toUpperCase(),
        sts: bucket === 'underRepair' ? 'UR' : 'REQ',
        type: bucket === 'underRepair' ? 'PENDING PARTS' : 'MACHINE REQUEST',
        bucket,
        client: buildClientName(company, branch),
        brand,
        model,
        machine: model || clean(machine?.description) || '-',
        serial: clean(machine?.serial),
        age: ageInDays(row.requested_at),
        requests: clean(row.machine_status || row.status) || 'N/A',
        remarks: remarks || '-',
        tech: staffName(row.requested_by),
        family: detectFamily([brand, model, machine?.description, remarks].join(' ')),
        searchText: [brand, model, machine?.serial, branch?.branchname, company?.companyname, remarks].join(' ').toLowerCase()
    };
}

function buildContractStatusRows() {
    const statusLabels = {
        2: 'For Upgrade',
        3: 'For Change Unit',
        4: 'For Termination',
        13: 'Shut Down'
    };
    return (GP_STATE.raw.contracts || [])
        .filter((contract) => statusLabels[Number(contract.status || contract.status_id || 0)])
        .map((contract) => {
            const statusId = Number(contract.status || contract.status_id || 0);
            const contractDep = GP_STATE.maps.contractDeps.get(String(contract.contract_id || '')) || null;
            const branch = GP_STATE.maps.branches.get(String(contractDep?.branch_id || '')) || null;
            const company = GP_STATE.maps.companies.get(String(branch?.company_id || '')) || null;
            const machine = GP_STATE.maps.machines.get(String(contract.mach_id || '')) || null;
            const brand = getMachineBrand(machine);
            const model = getMachineModel(machine);
            return {
                key: `contract:${contract._docId || contract.id}`,
                source: 'CONTRACT',
                sts: statusId === 2 ? 'FUP' : statusId === 3 ? 'FCU' : 'FTR',
                type: statusLabels[statusId],
                bucket: 'termination',
                client: buildClientName(company, branch),
                brand,
                model,
                machine: model || '-',
                serial: clean(contract.xserial || machine?.serial),
                age: ageInDays(firstDateValue(contract.update_date, contract.tmestamp, contract.datex)),
                requests: statusLabels[statusId],
                remarks: clean(contract.remarks || contract.note) || '-',
                family: detectFamily([brand, model, machine?.description].join(' ')),
                searchText: [statusLabels[statusId], company?.companyname, branch?.branchname, brand, model, machine?.serial].join(' ').toLowerCase()
            };
        });
}

function buildTerminationSourceRows() {
    return []
        .concat((GP_STATE.raw.terminationRecords || []).map((row) => normalizeLooseSourceRow(row, 'TERMINATION', 'FTR', 'termination')))
        .concat((GP_STATE.raw.shutdownRows || []).map((row) => normalizeLooseSourceRow(row, 'SHUTDOWN', 'FTR', 'termination')))
        .concat((GP_STATE.raw.shutdownMachines || []).map((row) => normalizeLooseSourceRow(row, 'SHUTDOWN', 'FTR', 'termination')))
        .filter(Boolean);
}

function buildPurchaseRows() {
    return (GP_STATE.raw.machineOrders || [])
        .map((row) => normalizeLooseSourceRow(row, 'PURCHASE', 'TO PURCHASE', 'purchase'))
        .filter(Boolean);
}

function buildPickupRows() {
    return (GP_STATE.raw.pickupReceipts || [])
        .map((row) => normalizeLooseSourceRow(row, 'PICKUP', 'FOR OVERHAULING', 'forOverhaul'))
        .filter(Boolean);
}

function limitLegacyPanelRows(rows, key) {
    const limit = GP_LEGACY_PANEL_LIMITS[key];
    if (!limit) return rows;
    return rows.slice(0, limit);
}

function buildOverhaulSourceFallbackRows(requestRows) {
    const needed = GP_LEGACY_PANEL_LIMITS.overhaulSource || 0;
    if (!needed) return [];
    const explicitRows = (requestRows || []).filter((row) => /overhaul|repair|ready/i.test(`${row.requests} ${row.remarks} ${row.type}`));
    const addtnRows = (requestRows || []).filter((row) => /new|addtn|additional/i.test(`${row.type} ${row.remarks}`));
    return dedupeRows(explicitRows.concat(addtnRows).concat(requestRows || []), 'key')
        .slice(0, needed)
        .map((row) => ({
            ...row,
            key: `overhaul-source:${row.key}`,
            source: 'SERVICE',
            bucket: 'overhaulSource'
        }));
}

function normalizeLooseSourceRow(row, source, type, bucket) {
    if (!row) return null;
    const machine = GP_STATE.maps.machines.get(String(row.mach_id || row.machine_id || row.serial || row.machine || '')) || null;
    const branch = GP_STATE.maps.branches.get(String(row.branch_id || row.client_id || '')) || null;
    const company = GP_STATE.maps.companies.get(String(row.company_id || branch?.company_id || '')) || null;
    const brand = clean(row.brand || row.brand_name) || getMachineBrand(machine);
    const model = clean(row.model || row.model_name || row.machine) || getMachineModel(machine);
    const serial = clean(row.serial || row.serial_no || machine?.serial);
    if (!brand && !model && !serial && !buildClientName(company, branch)) return null;
    return {
        key: `${source.toLowerCase()}:${row._docId || row.id || serial}`,
        source,
        sts: type,
        type,
        bucket,
        client: buildClientName(company, branch) || clean(row.client || row.customer || row.customer_name) || '-',
        brand,
        model,
        machine: model || clean(row.machine || row.description) || '-',
        serial,
        age: ageInDays(firstDateValue(row.datex, row.date, row.created_at, row.tmestamp)),
        requests: clean(row.status || row.remarks) || 'N/A',
        remarks: clean(row.remarks || row.notes || row.description) || '-',
        tech: staffName(row.tech_id || row.employee_id),
        family: detectFamily([brand, model, row.description, row.remarks].join(' ')),
        searchText: [source, type, brand, model, serial, row.remarks, row.client, row.customer].join(' ').toLowerCase()
    };
}

function normalizeMachineRow(row) {
    const statusId = Number(row.status_id || row.status || 0);
    const brand = getMachineBrand(row);
    const model = getMachineModel(row);
    const branch = GP_STATE.maps.branches.get(String(row.client_id || row.branch_id || '')) || null;
    const company = GP_STATE.maps.companies.get(String(branch?.company_id || row.company_id || '')) || null;
    const status = GP_STATE.statuses.find((item) => Number(item.id) === statusId);
    return {
        key: `machine:${row._docId || row.id}`,
        source: 'MACHINE',
        sts: clean(status?.status || `Status ${statusId}`),
        type: clean(status?.status || `Status ${statusId}`),
        client: buildClientName(company, branch),
        brand,
        model,
        machine: model || clean(row.description) || '-',
        serial: clean(row.serial),
        age: ageInDays(firstDateValue(row.dp_date, row.date_purchased, row.dr_date, row.tmestamp)),
        requests: clean(status?.status) || 'N/A',
        remarks: clean(row.remarks),
        tech: staffName(row.tech_id || row.assigned_tech_id),
        statusId,
        isField: isMachineInField(row),
        family: detectFamily([brand, model, row.description, row.remarks].join(' ')),
        searchText: [brand, model, row.description, row.serial, status?.status, row.remarks, branch?.branchname, company?.companyname].join(' ').toLowerCase(),
        raw: row
    };
}

function renderAllBoards() {
    const views = {};
    Object.keys(GP_STATE.rows).forEach((key) => {
        views[key] = GP_STATE.rows[key].filter(passesFilters).slice(0, GP_ROWS_PER_PANEL);
    });
    GP_STATE.view = views;

    renderRequests(views.requests);
    renderSimpleRows('termination', views.termination, ['sts', 'client', 'brand', 'model']);
    renderSimpleRows('purchase', views.purchase, ['type', 'client', 'machine', 'age']);
    renderSimpleRows('overhaulSource', views.overhaulSource, ['type', 'client', 'machine', 'age']);
    renderSimpleRows('ready', views.ready, ['brand', 'model', 'serial']);
    renderSimpleRows('forOverhaul', views.forOverhaul, ['brand', 'model', 'serial']);
    renderSimpleRows('underRepair', views.underRepair, ['brand', 'model', 'serial', 'tech']);

    document.getElementById('requestMeta').textContent = `${views.requests.length} request(s)`;
    document.getElementById('terminationCount').textContent = views.termination.length;
    document.getElementById('purchaseCount').textContent = views.purchase.length;
    document.getElementById('overhaulSourceCount').textContent = views.overhaulSource.length;
    document.getElementById('readyCount').textContent = views.ready.length;
    document.getElementById('forOverhaulCount').textContent = views.forOverhaul.length;
    document.getElementById('underRepairCount').textContent = views.underRepair.length;
}

function renderRequests(rows) {
    const columns = ['source', 'type', 'client', 'brand', 'model', 'age', 'requests', 'remarks'];
    renderTableBody('requestsTableBody', rows, columns, 'No machine requests found.');
}

function renderSimpleRows(key, rows, columns) {
    const bodyId = `${key}TableBody`;
    renderTableBody(bodyId, rows, columns, 'No rows found.');
}

function renderTableBody(bodyId, rows, columns, emptyText) {
    const tbody = document.getElementById(bodyId);
    if (!rows.length) {
        tbody.innerHTML = `<tr class="gp-empty-row"><td colspan="${columns.length}">${escapeHtml(emptyText)}</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map((row) => {
        const cells = columns.map((column) => {
            const value = column === 'age' ? formatAge(row.age) : row[column];
            const cellClass = column === 'age' && Number(row.age || 0) > 60 ? 'gp-attention' : '';
            return `<td class="${cellClass}" title="${escapeHtml(value)}">${escapeHtml(value || '-')}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');
}

function setLoadingRows() {
    [
        'requestsTableBody',
        'terminationTableBody',
        'purchaseTableBody',
        'overhaulSourceTableBody',
        'readyTableBody',
        'forOverhaulTableBody',
        'underRepairTableBody'
    ].forEach((id) => {
        const tbody = document.getElementById(id);
        if (tbody) tbody.innerHTML = '<tr class="gp-empty-row"><td colspan="8">Loading...</td></tr>';
    });
}

function passesFilters(row) {
    if (GP_STATE.family !== 'all' && row.family !== GP_STATE.family) return false;
    if (!GP_STATE.search) return true;
    return String(row.searchText || '').includes(GP_STATE.search);
}

function populateMachineCheckerOptions() {
    populateStatusOptions();
    populateSerialOptions();
    populateStatusModelOptions(null);
    renderStatusMachineContext(null);
    populateBrandOptions();
    populateModelOptions();
    document.getElementById('newMachineDpInput').value = new Date().toISOString().slice(0, 10);
}

function populateStatusOptions() {
    const select = document.getElementById('statusSelect');
    select.innerHTML = GP_STATE.statuses
        .map((status) => `<option value="${status.id}">${escapeHtml(status.status)}</option>`)
        .join('');
}

function populateSerialOptions() {
    GP_STATE.machineCheckerRecords = buildMachineCheckerRecords();
    renderSerialResults('');
}

function populateStatusModelOptions(machine, preferredModel = '') {
    const select = document.getElementById('statusModelInput');
    const currentModel = clean(preferredModel) || clean(machine ? getMachineModel(machine) : '');
    const seen = new Set();
    const models = [];

    if (currentModel) {
        seen.add(normalizeLoose(currentModel));
        models.push({ value: currentModel, label: currentModel });
    }

    (GP_STATE.raw.machines || []).forEach((row) => {
        const label = clean(row.description || getMachineModel(row));
        const key = normalizeLoose(label);
        if (!label || seen.has(key)) return;
        seen.add(key);
        models.push({ value: label, label });
    });

    (GP_STATE.raw.models || []).forEach((row) => {
        const label = getModelLabel(row);
        const key = normalizeLoose(label);
        if (!label || seen.has(key)) return;
        seen.add(key);
        models.push({ value: label, label });
    });

    models.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));
    select.innerHTML = '<option value="">Select model</option>' + models
        .map((model) => `<option value="${escapeHtml(model.value)}">${escapeHtml(model.label)}</option>`)
        .join('');
    if (currentModel) select.value = currentModel;
}

function populateBrandOptions() {
    const select = document.getElementById('newMachineBrandInput');
    const brands = (GP_STATE.raw.brands || [])
        .map((brand) => ({ id: Number(brand.id || 0), label: getBrandLabel(brand) }))
        .filter((brand) => brand.id && brand.label)
        .sort((left, right) => left.label.localeCompare(right.label));
    select.innerHTML = '<option value="">Select brand</option>' + brands
        .map((brand) => `<option value="${brand.id}">${escapeHtml(brand.label)}</option>`)
        .join('');
}

function populateModelOptions() {
    const brandId = Number(document.getElementById('newMachineBrandInput').value || 0);
    const select = document.getElementById('newMachineModelInput');
    const models = (GP_STATE.raw.models || [])
        .map((model) => ({
            id: Number(model.id || 0),
            brandId: Number(model.brand_id || 0),
            label: getModelLabel(model)
        }))
        .filter((model) => model.id && model.label)
        .filter((model) => !brandId || model.brandId === brandId)
        .sort((left, right) => left.label.localeCompare(right.label));
    select.innerHTML = '<option value="">Select model</option>' + models
        .map((model) => `<option value="${model.id}" data-brand-id="${model.brandId}">${escapeHtml(model.label)}</option>`)
        .join('');
}

function buildMachineCheckerRecords() {
    const recordsBySerial = new Map();
    (GP_STATE.raw.billingMachineRows || []).forEach((row) => {
        const serial = normalizeMachineSerialNumber(row.serial_number);
        if (!serial) return;
        const machine = GP_STATE.maps.machines.get(String(row.machine_id || '')) || null;
        const record = buildMachineCheckerRecord(machine, serial, 0, {
            source: 'billing',
            machineId: String(row.machine_id || '').trim(),
            contractmainId: String(row.contractmain_id || '').trim(),
            model: clean(row.machine_label),
            customer: buildClientName(
                { companyname: row.company_name },
                { branchname: row.branch_name }
            )
        });
        mergeMachineCheckerRecord(recordsBySerial, normalizeSerial(serial), record);
    });

    (GP_STATE.raw.machines || []).forEach((machine) => {
        const serials = getMachineSerialCandidates(machine);
        if (!serials.length) return;
        serials.forEach((serial, aliasIndex) => {
            const record = buildMachineCheckerRecord(machine, serial, aliasIndex);
            const serialKey = normalizeSerial(record.serial);
            if (!serialKey) return;
            mergeMachineCheckerRecord(recordsBySerial, serialKey, record);
        });
    });
    return Array.from(recordsBySerial.values()).sort(compareMachineCheckerRecords);
}

function buildMachineCheckerRecord(machine, serial, aliasIndex = 0, overrides = {}) {
    const machineId = String(overrides.machineId || machineKey(machine)).trim();
    const model = clean(overrides.model) || getMachineModel(machine);
    const brand = getMachineBrand(machine) || inferBrandFromText(model);
    const status = getMachineStatusLabel(machine);
    const customer = clean(overrides.customer) || resolveMachineCustomer(machine);
    return {
        machine,
        machineId,
        contractmainId: String(overrides.contractmainId || '').trim(),
        source: overrides.source || 'machine',
        serial,
        model,
        brand,
        status,
        customer,
        duplicateCount: 1,
        duplicateMachineIds: new Set([machineId]),
        score: scoreMachineCheckerRecord(machine, serial, aliasIndex, overrides.source),
        searchText: buildMachineCheckerSearchText({ serial, model, brand, status, customer, machineId })
    };
}

function mergeMachineCheckerRecord(recordsBySerial, serialKey, record) {
    const existing = recordsBySerial.get(serialKey);
    if (!existing) {
        recordsBySerial.set(serialKey, record);
        return;
    }

    const duplicateMachineIds = existing.duplicateMachineIds || new Set([existing.machineId]);
    if (record.machineId) duplicateMachineIds.add(record.machineId);
    existing.duplicateMachineIds = duplicateMachineIds;
    existing.duplicateCount = duplicateMachineIds.size;

    if (record.score > existing.score) {
        record.duplicateMachineIds = duplicateMachineIds;
        record.duplicateCount = duplicateMachineIds.size;
        recordsBySerial.set(serialKey, record);
    }
}

function findMachineCheckerRecord(serialValue) {
    const serialKey = normalizeMachineSerialNumber(serialValue);
    if (!serialKey) return null;
    return (GP_STATE.machineCheckerRecords || []).find((record) => normalizeSerial(record.serial) === serialKey) || null;
}

function getMachineSerialCandidates(machine) {
    const values = [
        machine?.serial,
        ...getContractSerialsForMachine(machine)
    ];
    const seen = new Set();
    return values
        .map(normalizeMachineSerialNumber)
        .filter((serial) => {
            const key = normalizeSerial(serial);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function getContractSerialsForMachine(machine) {
    const machineId = machineKey(machine);
    if (!machineId) return [];
    return (GP_STATE.maps.contractsByMachine.get(machineId) || [])
        .map((contract) => contract?.xserial || contract?.serial || contract?.serial_number);
}

function scoreMachineCheckerRecord(machine, serial, aliasIndex, source = 'machine') {
    let score = source === 'billing' ? 120 : (aliasIndex === 0 ? 20 : 5);
    if (/[A-Z]/.test(serial)) score += 8;
    if (getMachineModel(machine)) score += 4;
    if (Number(machine?.status_id || 0) > 0) score += 3;
    if (resolveMachineCustomer(machine)) score += 2;
    return score;
}

function compareMachineCheckerRecords(left, right) {
    const leftSource = left.source === 'billing' ? 0 : 1;
    const rightSource = right.source === 'billing' ? 0 : 1;
    const leftGroup = /[A-Z]/.test(left.serial) ? 0 : 1;
    const rightGroup = /[A-Z]/.test(right.serial) ? 0 : 1;
    return leftSource - rightSource
        || leftGroup - rightGroup
        || left.serial.localeCompare(right.serial, undefined, { numeric: true })
        || left.model.localeCompare(right.model, undefined, { numeric: true });
}

function buildMachineCheckerSearchText(record) {
    return [
        record.serial,
        normalizeSerial(record.serial),
        record.model,
        record.brand,
        record.status,
        record.customer,
        record.machineId
    ].join(' ').toLowerCase();
}

function getSerialSearchMatches(value) {
    const query = clean(value).toLowerCase();
    const serialQuery = normalizeSerial(value).toLowerCase();
    const records = GP_STATE.machineCheckerRecords || [];
    if (!query && !serialQuery) return records.slice(0, 60);
    return records
        .filter((record) => {
            const serial = normalizeSerial(record.serial).toLowerCase();
            return serial.includes(serialQuery)
                || String(record.searchText || '').includes(query);
        })
        .slice(0, 60);
}

function renderSerialResults(value) {
    const results = document.getElementById('statusSerialResults');
    if (!results) return;
    const matches = getSerialSearchMatches(value);
    GP_STATE.machineCheckerActiveIndex = matches.length ? 0 : -1;
    if (!matches.length) {
        results.innerHTML = '<div class="gp-serial-empty">No matching serial found.</div>';
        results.classList.remove('hidden');
        return;
    }
    results.innerHTML = matches.map((record, index) => {
        const meta = [
            record.brand,
            record.model,
            record.status,
            record.customer
        ].filter(Boolean).join(' - ');
        return `
            <button type="button" class="gp-serial-option ${index === 0 ? 'is-active' : ''}" data-serial="${escapeHtml(record.serial)}" role="option">
                <span class="gp-serial-main">${escapeHtml(record.serial)}</span>
                <span class="gp-serial-meta">${escapeHtml(meta || 'No model/status context')}</span>
            </button>
        `;
    }).join('');
    results.classList.remove('hidden');
    results.querySelectorAll('.gp-serial-option').forEach((button) => {
        button.addEventListener('click', () => selectMachineCheckerRecord(button.dataset.serial));
    });
}

function hideSerialResults() {
    document.getElementById('statusSerialResults')?.classList.add('hidden');
}

function handleSerialSearchInput(event) {
    const value = event.target.value;
    renderSerialResults(value);
    const exact = findMachineCheckerRecord(value);
    if (exact) {
        syncMachineCheckerFromRecord(exact, { updateInput: false });
    } else {
        GP_STATE.selectedMachine = null;
        populateStatusModelOptions(null);
        renderStatusMachineContext(null);
    }
}

function handleSerialSearchKeydown(event) {
    const results = document.getElementById('statusSerialResults');
    if (!results || results.classList.contains('hidden')) return;
    const options = [...results.querySelectorAll('.gp-serial-option')];
    if (!options.length) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        GP_STATE.machineCheckerActiveIndex = (GP_STATE.machineCheckerActiveIndex + direction + options.length) % options.length;
        options.forEach((option, index) => option.classList.toggle('is-active', index === GP_STATE.machineCheckerActiveIndex));
        options[GP_STATE.machineCheckerActiveIndex]?.scrollIntoView({ block: 'nearest' });
    }

    if (event.key === 'Enter') {
        const active = options[GP_STATE.machineCheckerActiveIndex] || options[0];
        if (!active) return;
        event.preventDefault();
        selectMachineCheckerRecord(active.dataset.serial);
    }

    if (event.key === 'Escape') {
        hideSerialResults();
    }
}

function selectMachineCheckerRecord(serial) {
    const record = findMachineCheckerRecord(serial);
    if (!record) return;
    syncMachineCheckerFromRecord(record, { updateInput: true });
    hideSerialResults();
}

function renderStatusMachineContext(record) {
    const context = document.getElementById('statusMachineContext');
    if (!context) return;
    if (!record) {
        context.textContent = 'Search a machine serial to inspect status and customer context.';
        return;
    }
    const duplicateWarning = record.duplicateCount > 1 ? ` - duplicate serial on ${record.duplicateCount} machine records` : '';
    const machineLabel = [record.brand, record.model].filter(Boolean).join(' ') || 'No model';
    context.innerHTML = `<strong>${escapeHtml(record.serial)}</strong> - ${escapeHtml(machineLabel)} - ${escapeHtml(record.status || 'No status')}${record.customer ? ` - ${escapeHtml(record.customer)}` : ''}${escapeHtml(duplicateWarning)}`;
}

function openMachineChecker() {
    document.getElementById('machineCheckerOverlay').classList.add('visible');
    document.getElementById('machineCheckerModal').classList.add('open');
    document.getElementById('machineCheckerModal').setAttribute('aria-hidden', 'false');
    setTimeout(() => {
        const input = document.getElementById('statusSerialInput');
        input.focus();
        renderSerialResults(input.value);
    }, 30);
}

function closeMachineChecker() {
    document.getElementById('machineCheckerOverlay').classList.remove('visible');
    document.getElementById('machineCheckerModal').classList.remove('open');
    document.getElementById('machineCheckerModal').setAttribute('aria-hidden', 'true');
}

function syncMachineCheckerFromRecord(record, options = {}) {
    const input = document.getElementById('statusSerialInput');
    const machine = record?.machine || null;
    GP_STATE.selectedMachine = machine;
    populateStatusModelOptions(machine, record?.model || '');
    renderStatusMachineContext(record);
    if (options.updateInput && record && input.value !== record.serial) input.value = record.serial;
    if (machine) {
        const select = document.getElementById('statusSelect');
        const statusId = String(Number(machine.status_id || 0));
        if ([...select.options].some((option) => option.value === statusId)) {
            select.value = statusId;
        }
    }
}

async function saveMachineStatus(event) {
    event.preventDefault();
    const record = findMachineCheckerRecord(document.getElementById('statusSerialInput').value);
    const machine = GP_STATE.selectedMachine || record?.machine || null;
    if (!machine) {
        alert('Select an existing machine serial first.');
        return;
    }
    if (record?.duplicateCount > 1) {
        alert('This serial appears on more than one machine record. Please fix the duplicate before changing the status.');
        return;
    }
    const statusId = Number(document.getElementById('statusSelect').value || 0);
    if (!statusId) {
        alert('Select a status.');
        return;
    }
    const selectedModel = clean(document.getElementById('statusModelInput').value);
    if (!selectedModel) {
        alert('Select a model.');
        return;
    }

    const button = document.getElementById('statusSaveBtn');
    button.disabled = true;
    try {
        const docId = String(machine._docId || machine.id || '').trim();
        if (!docId) throw new Error('Machine document id is missing.');
        await patchDocument('tbl_machine', docId, {
            status_id: statusId,
            description: selectedModel,
            tmestamp: new Date().toISOString(),
            production_status_updated_at: new Date().toISOString(),
            production_status_updated_by: currentUserLabel()
        }, {
            label: `Update machine ${clean(machine.serial)}`,
            dedupeKey: `gp-status:${docId}:${statusId}:${selectedModel}`
        });
        machine.status_id = statusId;
        machine.description = selectedModel;
        populateSerialOptions();
        renderStatusMachineContext(findMachineCheckerRecord(document.getElementById('statusSerialInput').value));
        buildProductionRows();
        renderAllBoards();
        alert('Machine status saved.');
    } catch (error) {
        console.error('Status save failed:', error);
        alert(`Failed to save status: ${error.message || error}`);
    } finally {
        button.disabled = false;
    }
}

async function saveNewMachine(event) {
    event.preventDefault();
    const brandId = Number(document.getElementById('newMachineBrandInput').value || 0);
    const modelId = Number(document.getElementById('newMachineModelInput').value || 0);
    const serial = clean(document.getElementById('newMachineSerialInput').value).toUpperCase();
    const condition = document.querySelector('input[name="newMachineCondition"]:checked')?.value || 'brand_new';
    const dpDate = document.getElementById('newMachineDpInput').value || '';

    if (!brandId) {
        alert('Select a brand.');
        return;
    }
    if (!modelId) {
        alert('Select a model.');
        return;
    }
    if (!serial) {
        alert('Enter the serial number.');
        return;
    }
    if (!normalizeMachineSerialNumber(serial)) {
        alert('Enter a valid machine serial number.');
        return;
    }
    if ((GP_STATE.raw.machines || []).some((machine) => normalizeMachineSerialNumber(machine.serial) === normalizeMachineSerialNumber(serial))) {
        alert('That serial already exists in the machine master.');
        return;
    }

    const button = document.getElementById('newMachineSaveBtn');
    button.disabled = true;
    try {
        const nextId = await allocateNextMachineId();
        const model = GP_STATE.maps.models.get(String(modelId)) || null;
        const brand = GP_STATE.maps.brands.get(String(brandId)) || null;
        const payload = {
            id: nextId,
            brand_id: brandId,
            model_id: modelId,
            serial,
            description: getModelLabel(model),
            status_id: 1,
            client_id: 0,
            isclient: 0,
            supplier_id: 0,
            ownership_id: 0,
            condition,
            is_brand_new: condition === 'brand_new' ? 1 : 0,
            dp_date: dpDate,
            date_purchased: dpDate,
            remarks: 'Added from General Production Machine Checker',
            tmestamp: new Date().toISOString(),
            production_created_at: new Date().toISOString(),
            production_created_by: currentUserLabel()
        };

        await setDocument('tbl_machine', String(nextId), payload, {
            label: `Add machine ${serial}`,
            dedupeKey: `gp-new-machine:${serial}`
        });

        GP_STATE.raw.machines.push({ ...payload, _docId: String(nextId) });
        GP_STATE.maps.machines.set(String(nextId), { ...payload, _docId: String(nextId) });
        populateSerialOptions();
        populateStatusModelOptions(GP_STATE.selectedMachine);
        buildProductionRows();
        renderAllBoards();
        document.getElementById('addMachineForm').reset();
        document.getElementById('newMachineDpInput').value = new Date().toISOString().slice(0, 10);
        populateModelOptions();
        alert(`Machine ${serial} added.`);
    } catch (error) {
        console.error('Add machine failed:', error);
        alert(`Failed to add machine: ${error.message || error}`);
    } finally {
        button.disabled = false;
    }
}

async function allocateNextMachineId() {
    try {
        const rows = await fetchLatestRows('tbl_machine', 1);
        const latest = Number(rows[0]?.id || 0);
        if (latest > 0) return latest + 1;
    } catch (error) {
        console.warn('Latest machine id lookup failed; using loaded max id.', error);
    }
    return (GP_STATE.raw.machines || []).reduce((max, row) => Math.max(max, Number(row.id || 0)), 0) + 1;
}

function exportRows(key) {
    const rows = GP_STATE.view[key] || [];
    if (!rows.length) {
        alert('No rows to export.');
        return;
    }
    const headers = ['source', 'type', 'client', 'brand', 'model', 'serial', 'age', 'requests', 'remarks', 'tech'];
    const lines = [
        headers.join(','),
        ...rows.map((row) => headers.map((header) => csvCell(header === 'age' ? formatAge(row.age) : row[header])).join(','))
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `general-production-${key}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function csvCell(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
}

function setStatus(message, isError = false) {
    const pill = document.getElementById('gpStatusPill');
    pill.textContent = message;
    pill.classList.toggle('is-error', isError);
}

function getMachineModel(machine) {
    if (!machine) return '';
    const model = GP_STATE.maps.models.get(String(machine.model_id || '')) || null;
    return clean(machine.description || model?.modelname || model?.model || model?.model_name);
}

function getModelLabel(model) {
    return clean(model?.modelname || model?.model || model?.model_name || model?.description);
}

function getMachineStatusLabel(machine) {
    const statusId = Number(machine?.status_id || machine?.status || 0);
    if (!statusId) return '';
    const status = GP_STATE.statuses.find((row) => Number(row.id || 0) === statusId);
    return clean(status?.status) || `Status ${statusId}`;
}

function getMachineBrand(machine) {
    if (!machine) return '';
    const model = GP_STATE.maps.models.get(String(machine.model_id || '')) || null;
    const brandId = machine.brand_id || model?.brand_id;
    const brand = GP_STATE.maps.brands.get(String(brandId || '')) || null;
    return inferBrandFromText([machine.description, machine.serial].join(' '))
        || getBrandLabel(brand)
        || clean(machine.brand || machine.brand_name)
        || inferBrandFromText([model?.modelname, model?.model, model?.model_name].join(' '));
}

function getBrandLabel(brand) {
    return clean(brand?.brandname || brand?.brand || brand?.brand_name);
}

function inferBrandFromText(value) {
    const text = String(value || '').toUpperCase();
    if (/\bBROTHER\b|\bMFC\b|\bDCP\b|\bHL[-\s]?\d/.test(text)) return 'Brother';
    if (/\bEPSON\b|\bL[-\s]?\d{3,4}\b|\bLX[-\s]?\d|\bWF[-\s]?\d/.test(text)) return 'Epson';
    if (/\bHP\b|\bLASERJET\b|\bDESKJET\b|\bM\d{3,4}\b/.test(text)) return 'HP';
    if (/\bTOSHIBA\b|\bES[-\s]?\d|\bE[-\s]?STUDIO\b/.test(text)) return 'Toshiba';
    if (/\bOCE\b|\bFX[-\s]?\d/.test(text)) return 'OCE';
    if (/\bLENOVO\b/.test(text)) return 'Lenovo';
    if (/\bRICOH\b|\bAFICIO\b|\bMPC\b|\bMP\s*C\b|\bC20(51|71)\b|\bC30(51|71)\b|\bC40(51|71)\b/.test(text)) return 'Ricoh';
    if (/\bCANON\b|\bIMAGECLASS\b|\bIR[-\s]?\d/.test(text)) return 'Canon';
    if (/\bKYOCERA\b|\bTASKALFA\b|\bFS[-\s]?\d/.test(text)) return 'Kyocera';
    if (/\bFUJI\b|\bXEROX\b|\bDOCUCENTRE\b/.test(text)) return 'Fuji Xerox';
    return '';
}

function buildClientName(company, branch) {
    const companyName = clean(company?.companyname || company?.business_style || company?.name);
    const branchName = clean(branch?.branchname || branch?.branch || branch?.departmentname);
    if (!companyName) return branchName;
    if (!branchName || branchName.toLowerCase() === 'main') return companyName;
    const normalizedCompany = normalizeLoose(companyName);
    const normalizedBranch = normalizeLoose(branchName);
    if (normalizedBranch.includes(normalizedCompany)) return branchName;
    return `${companyName} - ${branchName}`;
}

function resolveMachineCustomer(machine) {
    if (!machine) return '';
    const directBranch = GP_STATE.maps.branches.get(String(machine.branch_id || machine.client_id || '')) || null;
    const directCompany = GP_STATE.maps.companies.get(String(machine.company_id || directBranch?.company_id || '')) || null;
    const directName = buildClientName(directCompany, directBranch);
    if (directName) return directName;

    const contracts = GP_STATE.maps.contractsByMachine.get(machineKey(machine)) || [];
    for (const contract of contracts) {
        const contractDep = GP_STATE.maps.contractDeps.get(String(contract?.contract_id || '')) || null;
        const branch = GP_STATE.maps.branches.get(String(contractDep?.branch_id || contract?.branch_id || '')) || null;
        const company = GP_STATE.maps.companies.get(String(branch?.company_id || contract?.company_id || '')) || null;
        const name = buildClientName(company, branch);
        if (name) return name;
    }
    return '';
}

function staffName(id) {
    const staffId = String(id || '').trim();
    if (!staffId || staffId === '0') return '';
    const employee = GP_STATE.maps.employees.get(staffId);
    if (!employee) return `Staff #${staffId}`;
    return clean(employee.nickname || employee.firstname || employee.name || `${employee.firstname || ''} ${employee.lastname || ''}`) || `Staff #${staffId}`;
}

function detectFamily(value) {
    const text = String(value || '').toLowerCase();
    if (/inkjet|ink\s*tank|l[0-9]{3,4}|epson|canon g|brother t[0-9]/.test(text)) return 'inkjet';
    return 'laser';
}

function isMachineInField(machine) {
    return Number(machine?.client_id || 0) > 0
        || Number(machine?.branch_id || 0) > 0
        || Number(machine?.isclient || 0) > 0
        || [3, 18].includes(Number(machine?.status_id || 0));
}

function firstDateValue(...values) {
    return values.find((value) => {
        const text = clean(value);
        return text && !GP_ZERO_DATES.has(text.toLowerCase());
    }) || '';
}

function ageInDays(value) {
    const text = clean(value);
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

function sortByAgeDesc(left, right) {
    return Number(right.age || 0) - Number(left.age || 0);
}

function sortMachineRows(left, right) {
    return `${left.brand} ${left.model} ${left.serial}`.localeCompare(`${right.brand} ${right.model} ${right.serial}`);
}

function dedupeRows(rows, keyField) {
    const seen = new Set();
    const output = [];
    rows.forEach((row) => {
        const key = String(row?.[keyField] || '').trim();
        if (!key || seen.has(key)) return;
        seen.add(key);
        output.push(row);
    });
    return output;
}

function normalizeLoose(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeSerial(value) {
    return clean(value).replace(/\s+/g, '').toUpperCase();
}

function isMachineFallbackSerial(value) {
    const serial = clean(value);
    return /^machine\s+\S+/i.test(serial)
        || /^no machine$/i.test(serial)
        || /^n\/?a(?:\b|$)/i.test(serial)
        || /^not available$/i.test(serial);
}

function normalizeMachineSerialNumber(value) {
    const raw = clean(value);
    if (!raw || isMachineFallbackSerial(raw)) return '';
    if (GP_SERIAL_STOPWORDS.test(raw)) return '';
    const serial = raw.replace(/\s+/g, '').toUpperCase().replace(/^0+(?=[A-Z])/, '');
    if (!serial || isMachineFallbackSerial(serial)) return '';
    if (['NA', 'N/A', 'NONE', 'NULL', '0', '-'].includes(serial)) return '';
    if (/[^A-Z0-9-]/.test(serial)) return '';
    if (!/[A-Z0-9]{4,}/.test(serial)) return '';
    return serial;
}

function isRealSerial(value) {
    return Boolean(normalizeMachineSerialNumber(value));
}

function machineKey(machine) {
    return String(machine?._docId || machine?.id || normalizeSerial(machine?.serial) || '').trim();
}

function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
    return MargaUtils.escapeHtml(String(value ?? ''));
}

function currentUserLabel() {
    const user = MargaAuth.getUser();
    return clean(user?.email || user?.username || user?.name || 'general-production');
}

function toFirestoreFieldValue(value) {
    if (value === null) return { nullValue: null };
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map((entry) => toFirestoreFieldValue(entry)) } };
    }
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
    if (!updateKeys.length) return null;
    const params = updateKeys
        .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join('&');
    const body = { fields: {} };
    updateKeys.forEach((key) => {
        body.fields[key] = toFirestoreFieldValue(fields[key]);
    });
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}&${params}`,
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
    const response = await fetch(
        `${FIREBASE_CONFIG.baseUrl}/${collection}/${encodeURIComponent(docId)}?key=${FIREBASE_CONFIG.apiKey}`,
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
