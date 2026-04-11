if (!MargaAuth.requireAccess('inventory')) {
    throw new Error('Unauthorized access to Inventory module.');
}

const INVENTORY_STATE = {
    loading: false,
    savingSupplier: false,
    parts: [],
    tonerInk: [],
    machines: [],
    suppliers: [],
    partTypes: new Map(),
    models: new Map(),
    brands: new Map(),
    ownerships: new Map(),
    branches: new Map(),
    companies: new Map(),
    pages: {
        parts: 1,
        toner: 1,
        machines: 1,
        suppliers: 1
    }
};

const PAGE_SIZE = {
    parts: 18,
    toner: 18,
    machines: 18,
    suppliers: 18
};

const MACHINE_STATUS_MAP = {
    0: { text: 'Not Set', tone: 'muted' },
    1: { text: 'On Stock', tone: 'stock' },
    2: { text: 'For Delivery', tone: 'attention' },
    3: { text: 'Delivered', tone: 'field' },
    4: { text: 'Used W/in Company', tone: 'muted' },
    5: { text: 'For Junk', tone: 'attention' },
    6: { text: 'Junk', tone: 'attention' },
    7: { text: 'For Overhauling', tone: 'attention' },
    8: { text: 'Under Repair', tone: 'attention' },
    9: { text: 'For Parts', tone: 'attention' },
    10: { text: 'For Sale', tone: 'attention' },
    11: { text: 'Trade In', tone: 'attention' },
    12: { text: 'Outside Repair', tone: 'attention' },
    13: { text: 'Missing', tone: 'attention' },
    14: { text: 'Old', tone: 'muted' },
    15: { text: 'Under QC', tone: 'attention' },
    16: { text: 'Duplicate', tone: 'attention' },
    17: { text: 'N/A', tone: 'muted' },
    18: { text: 'Delivered (No Contract)', tone: 'field' }
};

document.addEventListener('DOMContentLoaded', async () => {
    loadUserHeader();
    bindInventoryControls();
    MargaAuth.applyModulePermissions({ hideUnauthorized: true });
    await loadInventoryData();
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

window.toggleSidebar = toggleSidebar;

function loadUserHeader() {
    const user = MargaAuth.getUser();
    if (!user) return;
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userRole').textContent = MargaAuth.getDisplayRoles(user);
    document.getElementById('userAvatar').textContent = String(user.name || 'A').charAt(0).toUpperCase();
}

function bindInventoryControls() {
    document.getElementById('refreshInventoryBtn').addEventListener('click', () => loadInventoryData());

    document.getElementById('partsSearchInput').addEventListener('input', () => resetPageAndRender('parts'));
    document.getElementById('partsTypeFilter').addEventListener('change', () => resetPageAndRender('parts'));
    document.getElementById('tonerSearchInput').addEventListener('input', () => resetPageAndRender('toner'));
    document.getElementById('tonerSupplierFilter').addEventListener('change', () => resetPageAndRender('toner'));
    document.getElementById('machineSearchInput').addEventListener('input', () => resetPageAndRender('machines'));
    document.getElementById('machineDeploymentFilter').addEventListener('change', () => resetPageAndRender('machines'));
    document.getElementById('machineStatusFilter').addEventListener('change', () => resetPageAndRender('machines'));
    document.getElementById('supplierSearchInput').addEventListener('input', () => resetPageAndRender('suppliers'));
    document.getElementById('supplierAddBtn').addEventListener('click', () => openSupplierForm());
    document.getElementById('supplierForm').addEventListener('submit', onSupplierSubmit);
    document.getElementById('supplierFormCancelBtn').addEventListener('click', closeSupplierForm);
    document.getElementById('supplierFormClearBtn').addEventListener('click', () => resetSupplierForm());
    document.getElementById('suppliersTableBody').addEventListener('click', onSuppliersTableAction);

    bindPager('parts');
    bindPager('toner');
    bindPager('machines');
    bindPager('suppliers');
}

function bindPager(section) {
    const prev = document.getElementById(`${section}PrevBtn`);
    const next = document.getElementById(`${section}NextBtn`);
    if (prev) prev.addEventListener('click', () => changePage(section, -1));
    if (next) next.addEventListener('click', () => changePage(section, 1));
}

function changePage(section, delta) {
    const rows = getSectionRows(section);
    const pageSize = PAGE_SIZE[section];
    const maxPage = Math.max(1, Math.ceil(rows.length / pageSize));
    INVENTORY_STATE.pages[section] = clamp(INVENTORY_STATE.pages[section] + delta, 1, maxPage);
    renderSection(section);
}

function resetPageAndRender(section) {
    INVENTORY_STATE.pages[section] = 1;
    renderSection(section);
}

async function loadInventoryData() {
    if (INVENTORY_STATE.loading) return;
    INVENTORY_STATE.loading = true;
    setStatus('Loading live Firebase masters…');
    renderLoadingStates();

    try {
        const [inventoryRows, tonerRows, machineRows, supplierRows, modelRows, brandRows, partTypeRows, ownershipRows, branchRows, companyRows] = await Promise.all([
            MargaUtils.fetchCollection('tbl_inventoryparts'),
            MargaUtils.fetchCollection('tbl_tonerink'),
            MargaUtils.fetchCollection('tbl_machine'),
            MargaUtils.fetchCollection('tbl_supplier'),
            MargaUtils.fetchCollection('tbl_model'),
            MargaUtils.fetchCollection('tbl_brand'),
            MargaUtils.fetchCollection('tbl_partstype'),
            MargaUtils.fetchCollection('tbl_ownership'),
            MargaUtils.fetchCollection('tbl_branchinfo'),
            MargaUtils.fetchCollection('tbl_companylist')
        ]);

        INVENTORY_STATE.partTypes = new Map(partTypeRows.map((row) => [String(row.id || '').trim(), normalizeText(row.type)]).filter(([, label]) => label));
        INVENTORY_STATE.models = new Map(modelRows.map((row) => [String(row.id || '').trim(), row]).filter(([id]) => id));
        INVENTORY_STATE.brands = new Map(brandRows.map((row) => [String(row.id || '').trim(), row]).filter(([id]) => id));
        INVENTORY_STATE.ownerships = new Map(ownershipRows.map((row) => [String(row.id || '').trim(), normalizeText(row.ownership)]).filter(([, label]) => label));
        INVENTORY_STATE.branches = new Map(branchRows.map((row) => [String(row.id || '').trim(), row]).filter(([id]) => id));
        INVENTORY_STATE.companies = new Map(companyRows.map((row) => [String(row.id || '').trim(), row]).filter(([id]) => id));

        const supplierMap = new Map(
            supplierRows
                .map((row) => [String(row.id || '').trim(), row])
                .filter(([id]) => id)
        );

        INVENTORY_STATE.suppliers = supplierRows
            .map((row) => normalizeSupplierRow(row))
            .filter((row) => row.name)
            .sort((left, right) => left.name.localeCompare(right.name));

        INVENTORY_STATE.parts = inventoryRows
            .map((row) => normalizePartRow(row, supplierMap, INVENTORY_STATE.partTypes))
            .filter((row) => row.name)
            .sort((left, right) => `${left.name} ${left.code}`.localeCompare(`${right.name} ${right.code}`));

        INVENTORY_STATE.tonerInk = tonerRows
            .map((row) => normalizeTonerRow(row, supplierMap, INVENTORY_STATE.models, INVENTORY_STATE.brands))
            .filter((row) => row.name)
            .sort((left, right) => left.name.localeCompare(right.name));

        INVENTORY_STATE.machines = machineRows
            .map((row) => normalizeMachineRow(row, supplierMap))
            .filter((row) => row.serial || row.modelName)
            .sort((left, right) => {
                if (left.isField !== right.isField) return left.isField ? -1 : 1;
                return `${left.modelName} ${left.serial}`.localeCompare(`${right.modelName} ${right.serial}`);
            });

        populateFilters();
        renderAllInventory();
        setStatus(`Live inventory refreshed on ${new Date().toLocaleString('en-PH')}`);
    } catch (error) {
        console.error('Inventory load failed:', error);
        setStatus('Inventory load failed. Please try refresh.');
        MargaUtils.showToast('Failed to load inventory masters', 'error');
        renderErrorStates();
    } finally {
        INVENTORY_STATE.loading = false;
    }
}

function renderAllInventory() {
    renderOverview();
    renderDeploymentBoard();
    renderSection('parts');
    renderSection('toner');
    renderSection('machines');
    renderSection('suppliers');
}

function renderOverview() {
    const fieldMachines = INVENTORY_STATE.machines.filter((row) => row.isField);
    const activeSuppliers = INVENTORY_STATE.suppliers.filter((row) => !row.inactive);
    const uniqueBranches = new Set(fieldMachines.map((row) => row.branchId).filter(Boolean));

    document.getElementById('statPartsCount').textContent = MargaUtils.formatNumber(INVENTORY_STATE.parts.length);
    document.getElementById('statPartsMeta').textContent = `${MargaUtils.formatNumber(new Set(INVENTORY_STATE.parts.map((row) => row.typeLabel).filter(Boolean)).size)} part types tracked`;
    document.getElementById('statTonerCount').textContent = MargaUtils.formatNumber(INVENTORY_STATE.tonerInk.length);
    document.getElementById('statTonerMeta').textContent = `${MargaUtils.formatNumber(sumAmounts(INVENTORY_STATE.tonerInk.map((row) => row.quantity)))} combined quantity`;
    document.getElementById('statFieldMachines').textContent = MargaUtils.formatNumber(fieldMachines.length);
    document.getElementById('statFieldMachinesMeta').textContent = `${MargaUtils.formatNumber(uniqueBranches.size)} branches currently tagged`;
    document.getElementById('statSupplierCount').textContent = MargaUtils.formatNumber(activeSuppliers.length);
    document.getElementById('statSupplierMeta').textContent = `${MargaUtils.formatNumber(INVENTORY_STATE.suppliers.length)} total supplier rows`;
}

function renderDeploymentBoard() {
    const fieldMachines = INVENTORY_STATE.machines
        .filter((row) => row.isField)
        .sort((left, right) => String(right.drDate || '').localeCompare(String(left.drDate || '')))
        .slice(0, 8);
    const shell = document.getElementById('deploymentBoard');

    if (!fieldMachines.length) {
        shell.innerHTML = '<div class="empty-state">No branch-tagged or delivered machines found in the live master.</div>';
        return;
    }

    shell.innerHTML = fieldMachines.map((machine) => `
        <article class="pulse-item">
            <span class="pill ${escapeHtml(machine.statusTone)}">${escapeHtml(machine.statusText)}</span>
            <strong>${escapeHtml(machine.modelName || machine.serial || 'Machine')}</strong>
            <span>${escapeHtml(machine.serial || 'No serial')}</span>
            <small>${escapeHtml(machine.locationLabel || 'Customer location not tagged')}</small>
            <small>${escapeHtml(machine.drDateLabel ? `DR ${machine.drDateLabel}` : 'No delivery date')}</small>
        </article>
    `).join('');
}

function renderSection(section) {
    if (section === 'parts') renderPartsTable();
    if (section === 'toner') renderTonerTable();
    if (section === 'machines') renderMachinesTable();
    if (section === 'suppliers') renderSuppliersTable();
}

function renderPartsTable() {
    const rows = getFilteredParts();
    renderPaginatedTable({
        section: 'parts',
        rows,
        tbodyId: 'partsTableBody',
        metaId: 'partsResultMeta',
        pageMetaId: 'partsPageMeta',
        columnCount: 6,
        empty: 'No part or material rows matched the current filter.',
        rowRenderer: (row) => `
            <tr>
                <td><div class="item-main"><strong>${escapeHtml(row.name)}</strong><small>ID ${escapeHtml(String(row.id || '-'))}</small></div></td>
                <td>${escapeHtml(row.code || '-')}</td>
                <td>${escapeHtml(row.typeLabel || 'Unclassified')}</td>
                <td>${escapeHtml(row.supplierLabel || 'No supplier')}</td>
                <td>${escapeHtml(MargaUtils.formatNumber(row.quantity || 0))}</td>
                <td class="muted-copy">${escapeHtml(row.notes || row.description || '-')}</td>
            </tr>
        `
    });
}

function renderTonerTable() {
    const rows = getFilteredToner();
    renderPaginatedTable({
        section: 'toner',
        rows,
        tbodyId: 'tonerTableBody',
        metaId: 'tonerResultMeta',
        pageMetaId: 'tonerPageMeta',
        columnCount: 5,
        empty: 'No toner or ink rows matched the current filter.',
        rowRenderer: (row) => `
            <tr>
                <td><div class="item-main"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.brandLabel || 'Unknown brand')}</small></div></td>
                <td>${escapeHtml(row.supplierLabel || 'No supplier')}</td>
                <td>${escapeHtml(MargaUtils.formatNumber(row.quantity || 0))}</td>
                <td>${escapeHtml(row.serial || '-')}</td>
                <td class="muted-copy">${escapeHtml(row.remarks || '-')}</td>
            </tr>
        `
    });
}

function renderMachinesTable() {
    const rows = getFilteredMachines();
    renderPaginatedTable({
        section: 'machines',
        rows,
        tbodyId: 'machinesTableBody',
        metaId: 'machinesResultMeta',
        pageMetaId: 'machinesPageMeta',
        columnCount: 7,
        empty: 'No machines matched the current filter.',
        rowRenderer: (row) => `
            <tr>
                <td><div class="item-main"><strong>${escapeHtml(row.serial || 'No serial')}</strong><small>${escapeHtml(row.drDateLabel || 'No DR date')}</small></div></td>
                <td><div class="item-main"><strong>${escapeHtml(row.modelName || row.description || 'Unknown model')}</strong><small>${escapeHtml(row.brandLabel || 'Unknown brand')}</small></div></td>
                <td><span class="pill ${escapeHtml(row.statusTone)}">${escapeHtml(row.statusText)}</span></td>
                <td><div class="item-main"><strong>${escapeHtml(row.locationLabel || 'In-house / not tagged')}</strong><small>${escapeHtml(row.deploymentLabel)}</small></div></td>
                <td>${escapeHtml(row.supplierLabel || 'No supplier')}</td>
                <td class="price">${escapeHtml(MargaUtils.formatCurrency(row.cost || 0))}</td>
                <td class="muted-copy">${escapeHtml(row.remarks || '-')}</td>
            </tr>
        `
    });
}

function renderSuppliersTable() {
    const rows = getFilteredSuppliers();
    renderPaginatedTable({
        section: 'suppliers',
        rows,
        tbodyId: 'suppliersTableBody',
        metaId: 'suppliersResultMeta',
        pageMetaId: 'suppliersPageMeta',
        columnCount: 6,
        empty: 'No supplier rows matched the search.',
        rowRenderer: (row) => `
            <tr>
                <td>
                    <div class="item-main">
                        <strong>${escapeHtml(row.name)}</strong>
                        <small>${escapeHtml(row.inactive ? 'Inactive' : 'Active')}${row.department ? ` • ${escapeHtml(row.department)}` : ''}</small>
                    </div>
                </td>
                <td>${escapeHtml(row.tin || '-')}</td>
                <td class="muted-copy">${escapeHtml(row.address || '-')}</td>
                <td class="muted-copy">${escapeHtml([row.contactPerson, row.phoneLabel, row.email].filter(Boolean).join(' • ') || '-')}</td>
                <td class="muted-copy">${escapeHtml(row.product || '-')}</td>
                <td><button type="button" class="btn btn-secondary btn-sm" data-action="edit-supplier" data-supplier-id="${escapeHtml(String(row.id || ''))}">Edit</button></td>
            </tr>
        `
    });
}

function renderPaginatedTable({ section, rows, tbodyId, metaId, pageMetaId, columnCount, empty, rowRenderer }) {
    const tbody = document.getElementById(tbodyId);
    const meta = document.getElementById(metaId);
    const pageMeta = document.getElementById(pageMetaId);
    const pageSize = PAGE_SIZE[section];
    const maxPage = Math.max(1, Math.ceil(rows.length / pageSize));
    INVENTORY_STATE.pages[section] = clamp(INVENTORY_STATE.pages[section], 1, maxPage);
    const start = (INVENTORY_STATE.pages[section] - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    meta.textContent = `${MargaUtils.formatNumber(rows.length)} result(s)`;
    pageMeta.textContent = `Page ${INVENTORY_STATE.pages[section]} of ${maxPage}`;
    document.getElementById(`${section}PrevBtn`).disabled = INVENTORY_STATE.pages[section] <= 1;
    document.getElementById(`${section}NextBtn`).disabled = INVENTORY_STATE.pages[section] >= maxPage;

    if (!pageRows.length) {
        tbody.innerHTML = `<tr><td colspan="${escapeHtml(String(columnCount || 1))}" class="empty-state">${escapeHtml(empty)}</td></tr>`;
        return;
    }

    tbody.innerHTML = pageRows.map((row) => rowRenderer(row)).join('');
}

function getFilteredParts() {
    const query = normalizeSearch(document.getElementById('partsSearchInput').value);
    const typeFilter = document.getElementById('partsTypeFilter').value;
    return INVENTORY_STATE.parts.filter((row) => {
        if (typeFilter !== 'all' && row.typeLabel !== typeFilter) return false;
        if (!query) return true;
        return [row.name, row.code, row.typeLabel, row.supplierLabel, row.notes, row.description]
            .some((value) => normalizeSearch(value).includes(query));
    });
}

function getFilteredToner() {
    const query = normalizeSearch(document.getElementById('tonerSearchInput').value);
    const supplierFilter = document.getElementById('tonerSupplierFilter').value;
    return INVENTORY_STATE.tonerInk.filter((row) => {
        if (supplierFilter !== 'all' && row.supplierLabel !== supplierFilter) return false;
        if (!query) return true;
        return [row.name, row.brandLabel, row.modelLabel, row.supplierLabel, row.serial, row.remarks]
            .some((value) => normalizeSearch(value).includes(query));
    });
}

function getFilteredMachines() {
    const query = normalizeSearch(document.getElementById('machineSearchInput').value);
    const deployment = document.getElementById('machineDeploymentFilter').value;
    const status = document.getElementById('machineStatusFilter').value;

    return INVENTORY_STATE.machines.filter((row) => {
        if (deployment === 'field' && !row.isField) return false;
        if (deployment === 'stock' && row.statusId !== 1) return false;
        if (deployment === 'attention' && !row.needsAttention) return false;
        if (status !== 'all' && String(row.statusId) !== status) return false;
        if (!query) return true;
        return [row.serial, row.modelName, row.brandLabel, row.locationLabel, row.companyLabel, row.branchLabel, row.supplierLabel, row.remarks]
            .some((value) => normalizeSearch(value).includes(query));
    });
}

function getFilteredSuppliers() {
    const query = normalizeSearch(document.getElementById('supplierSearchInput').value);
    return INVENTORY_STATE.suppliers.filter((row) => {
        if (!query) return true;
        return [row.name, row.tin, row.address, row.contactPerson, row.phoneLabel, row.email, row.product, row.department]
            .some((value) => normalizeSearch(value).includes(query));
    });
}

function getSectionRows(section) {
    if (section === 'parts') return getFilteredParts();
    if (section === 'toner') return getFilteredToner();
    if (section === 'machines') return getFilteredMachines();
    if (section === 'suppliers') return getFilteredSuppliers();
    return [];
}

function populateFilters() {
    populateSelect('partsTypeFilter', uniqueValues(INVENTORY_STATE.parts.map((row) => row.typeLabel)).map((value) => ({ value, label: value })), 'All types');
    populateSelect('tonerSupplierFilter', uniqueValues(INVENTORY_STATE.tonerInk.map((row) => row.supplierLabel)).map((value) => ({ value, label: value })), 'All suppliers');
    populateSelect('machineStatusFilter', Object.entries(MACHINE_STATUS_MAP).map(([value, meta]) => ({ value, label: meta.text })), 'All statuses');
}

function populateSelect(id, options, defaultLabel) {
    const select = document.getElementById(id);
    if (!select) return;
    const current = select.value || 'all';
    select.innerHTML = `<option value="all">${escapeHtml(defaultLabel)}</option>${options
        .filter((item) => item?.value !== undefined && item?.label)
        .map((item) => `<option value="${escapeHtml(String(item.value))}">${escapeHtml(item.label)}</option>`)
        .join('')}`;
    if ([...select.options].some((option) => option.value === current)) {
        select.value = current;
    }
}

function normalizePartRow(row, supplierMap, partTypeMap) {
    const supplier = supplierMap.get(String(row.supplier_id || '').trim()) || null;
    return {
        id: Number(row.id || 0),
        name: normalizeText(row.item_name || row.description),
        code: normalizeText(row.item_code),
        typeLabel: normalizeText(partTypeMap.get(String(row.item_type || '').trim()) || '') || 'Unclassified',
        supplierLabel: formatSupplierName(supplier),
        quantity: Number(row.quantity || 0),
        notes: normalizeText(row.notes),
        description: normalizeText(row.description)
    };
}

function normalizeTonerRow(row, supplierMap, modelMap, brandMap) {
    const model = modelMap.get(String(row.model_id || '').trim()) || null;
    const brand = brandMap.get(String(model?.brand_id || row.brand_id || '').trim()) || null;
    const supplier = supplierMap.get(String(row.supplier_id || '').trim()) || null;
    const brandLabel = getBrandLabel(brand);
    const modelLabel = getModelLabel(model, row);
    return {
        id: Number(row.id || 0),
        brandLabel,
        modelLabel,
        name: normalizeText([brandLabel, modelLabel].filter(Boolean).join(' ')),
        supplierLabel: formatSupplierName(supplier),
        quantity: Number(row.quantity || 0),
        serial: normalizeText(row.serial),
        remarks: normalizeText(row.remarks)
    };
}

function normalizeMachineRow(row, supplierMap) {
    const model = INVENTORY_STATE.models.get(String(row.model_id || '').trim()) || null;
    const brand = INVENTORY_STATE.brands.get(String(model?.brand_id || row.brand_id || '').trim()) || null;
    const supplier = supplierMap.get(String(row.supplier_id || '').trim()) || null;
    const branch = INVENTORY_STATE.branches.get(String(row.client_id || '').trim()) || null;
    const company = INVENTORY_STATE.companies.get(String(branch?.company_id || row.client_id || '').trim()) || null;
    const status = MACHINE_STATUS_MAP[Number(row.status_id || 0)] || { text: `Status ${row.status_id || 0}`, tone: 'muted' };
    const isField = isMachineInField(row);
    return {
        id: Number(row.id || 0),
        serial: normalizeText(row.serial),
        description: normalizeText(row.description),
        brandLabel: getBrandLabel(brand),
        modelName: normalizeText([getBrandLabel(brand), getModelLabel(model, row)].filter(Boolean).join(' ')) || normalizeText(row.description),
        statusId: Number(row.status_id || 0),
        statusText: status.text,
        statusTone: isField ? 'field' : status.tone,
        supplierLabel: formatSupplierName(supplier),
        cost: Number(row.cost || row.amount || 0),
        remarks: normalizeText(row.remarks),
        ownershipLabel: normalizeText(INVENTORY_STATE.ownerships.get(String(row.ownership_id || '').trim()) || ''),
        branchId: Number(row.client_id || 0),
        branchLabel: resolveBranchLabel(branch),
        companyLabel: resolveCompanyLabel(company),
        locationLabel: resolveMachineLocation(branch, company),
        deploymentLabel: buildDeploymentLabel(row, status.text, branch, company, isField),
        drDateLabel: formatDateLabel(row.dr_date),
        drDate: String(row.dr_date || ''),
        isField,
        needsAttention: [2, 7, 8, 12, 13].includes(Number(row.status_id || 0))
    };
}

function normalizeSupplierRow(row) {
    return {
        id: Number(row.id || 0),
        docId: String(row._docId || row.id || '').trim(),
        name: formatSupplierName(row),
        tin: normalizeText(row.tin || row.tin_number || row.tin_no),
        address: normalizeText(row.address || row.supplier_address || row.full_address || row.street_address),
        contactPerson: normalizeText(row.contact_person),
        mobile: normalizeText(row.mobile),
        landline: normalizeText(row.landline),
        phoneLabel: [normalizeText(row.mobile), normalizeText(row.landline)].filter(Boolean).join(' / '),
        email: normalizeText(row.email),
        product: normalizeText(row.product || row.products_offered || row.scope),
        department: normalizeText(row.department_name),
        inactive: Number(row.isinactive || 0) === 1
    };
}

function isMachineInField(machine) {
    const statusId = Number(machine.status_id || 0);
    const clientId = Number(machine.client_id || 0);
    const ownershipId = Number(machine.ownership_id || 0);
    const isClient = Number(machine.isclient || 0);
    return clientId > 0 || isClient > 0 || ownershipId === 2 || statusId === 3 || statusId === 18;
}

function buildDeploymentLabel(machine, statusText, branch, company, isField) {
    if (isField && branch) return `Field tagged to ${normalizeText(branch.branchname)}`;
    if (isField && company) return `Field tagged to ${resolveCompanyLabel(company)}`;
    if (Number(machine.status_id || 0) === 1) return 'Available in-house stock';
    return statusText;
}

function resolveMachineLocation(branch, company) {
    if (branch && company) return `${resolveBranchLabel(branch)} / ${resolveCompanyLabel(company)}`;
    if (branch) return resolveBranchLabel(branch);
    if (company) return resolveCompanyLabel(company);
    return '';
}

function resolveBranchLabel(branch) {
    if (!branch) return '';
    return normalizeText(branch.branchname || branch.branch_address || branch.code);
}

function resolveCompanyLabel(company) {
    if (!company) return '';
    return normalizeText(company.companyname || company.business_style);
}

function formatSupplierName(supplier) {
    if (!supplier || typeof supplier !== 'object') return '';
    return normalizeText(
        supplier.supplier
        || supplier.supplier_name
        || supplier.vendor
        || supplier.vendor_name
        || supplier.name
        || supplier.company
        || supplier.companyname
        || ''
    );
}

function getModelLabel(model, fallback = null) {
    return normalizeText(model?.modelname || model?.model || model?.model_name || fallback?.description || '');
}

function getBrandLabel(brand) {
    return normalizeText(brand?.brandname || brand?.brand_name || brand?.brand || '');
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeSearch(value) {
    return normalizeText(value).toLowerCase();
}

function uniqueValues(values) {
    return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function sumAmounts(values) {
    return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function formatDateLabel(value) {
    const text = String(value || '').trim();
    if (!text || text === '0000-00-00' || text.startsWith('undefined')) return '';
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? text : parsed.toLocaleDateString('en-PH');
}

function escapeHtml(value) {
    return MargaUtils.escapeHtml(String(value ?? ''));
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function setStatus(message) {
    document.getElementById('inventoryStatusPill').textContent = message;
}

function renderLoadingStates() {
    document.getElementById('partsTableBody').innerHTML = '<tr><td colspan="6" class="loading-state">Loading live inventory data…</td></tr>';
    document.getElementById('tonerTableBody').innerHTML = '<tr><td colspan="5" class="loading-state">Loading live inventory data…</td></tr>';
    document.getElementById('machinesTableBody').innerHTML = '<tr><td colspan="7" class="loading-state">Loading live inventory data…</td></tr>';
    document.getElementById('suppliersTableBody').innerHTML = '<tr><td colspan="6" class="loading-state">Loading live inventory data…</td></tr>';
    document.getElementById('deploymentBoard').innerHTML = '<div class="loading-state">Loading deployment board…</div>';
}

function renderErrorStates() {
    document.getElementById('partsTableBody').innerHTML = '<tr><td colspan="6" class="empty-state danger-note">Inventory data failed to load. Try refresh.</td></tr>';
    document.getElementById('tonerTableBody').innerHTML = '<tr><td colspan="5" class="empty-state danger-note">Inventory data failed to load. Try refresh.</td></tr>';
    document.getElementById('machinesTableBody').innerHTML = '<tr><td colspan="7" class="empty-state danger-note">Inventory data failed to load. Try refresh.</td></tr>';
    document.getElementById('suppliersTableBody').innerHTML = '<tr><td colspan="6" class="empty-state danger-note">Inventory data failed to load. Try refresh.</td></tr>';
    document.getElementById('deploymentBoard').innerHTML = '<div class="empty-state danger-note">Deployment board unavailable until data reload succeeds.</div>';
}

function onSuppliersTableAction(event) {
    const button = event.target.closest('[data-action="edit-supplier"]');
    if (!button) return;
    const supplierId = Number(button.dataset.supplierId || 0);
    const supplier = INVENTORY_STATE.suppliers.find((row) => Number(row.id || 0) === supplierId);
    if (!supplier) {
        MargaUtils.showToast('Supplier row could not be loaded for editing.', 'error');
        return;
    }
    openSupplierForm(supplier);
}

function openSupplierForm(supplier = null) {
    const shell = document.getElementById('supplierFormShell');
    shell.classList.remove('hidden');
    fillSupplierForm(supplier);
    shell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('supplierNameInput').focus();
}

function closeSupplierForm() {
    document.getElementById('supplierFormShell').classList.add('hidden');
    resetSupplierForm();
}

function resetSupplierForm() {
    document.getElementById('supplierForm').reset();
    document.getElementById('supplierDocIdInput').value = '';
    document.getElementById('supplierRecordIdInput').value = '';
    document.getElementById('supplierStatusInput').value = '0';
    document.getElementById('supplierFormTitle').textContent = 'Add Supplier';
    document.getElementById('supplierFormSaveBtn').textContent = 'Save Supplier';
}

function fillSupplierForm(supplier = null) {
    resetSupplierForm();
    if (!supplier) return;
    document.getElementById('supplierDocIdInput').value = supplier.docId || String(supplier.id || '');
    document.getElementById('supplierRecordIdInput').value = String(supplier.id || '');
    document.getElementById('supplierNameInput').value = supplier.name || '';
    document.getElementById('supplierTinInput').value = supplier.tin || '';
    document.getElementById('supplierAddressInput').value = supplier.address || '';
    document.getElementById('supplierContactPersonInput').value = supplier.contactPerson || '';
    document.getElementById('supplierMobileInput').value = supplier.mobile || '';
    document.getElementById('supplierLandlineInput').value = supplier.landline || '';
    document.getElementById('supplierEmailInput').value = supplier.email || '';
    document.getElementById('supplierProductInput').value = supplier.product || '';
    document.getElementById('supplierDepartmentInput').value = supplier.department || '';
    document.getElementById('supplierStatusInput').value = supplier.inactive ? '1' : '0';
    document.getElementById('supplierFormTitle').textContent = `Edit ${supplier.name}`;
    document.getElementById('supplierFormSaveBtn').textContent = 'Update Supplier';
}

async function onSupplierSubmit(event) {
    event.preventDefault();
    if (INVENTORY_STATE.savingSupplier) return;

    const supplierName = normalizeText(document.getElementById('supplierNameInput').value);
    if (!supplierName) {
        MargaUtils.showToast('Supplier name is required.', 'error');
        return;
    }

    const currentDocId = String(document.getElementById('supplierDocIdInput').value || '').trim();
    const currentRecordId = Number(document.getElementById('supplierRecordIdInput').value || 0);
    const duplicate = INVENTORY_STATE.suppliers.find((row) => (
        normalizeSearch(row.name) === normalizeSearch(supplierName)
        && Number(row.id || 0) !== currentRecordId
    ));
    if (duplicate) {
        MargaUtils.showToast(`Supplier "${supplierName}" already exists. Open that row and update it instead.`, 'error');
        return;
    }

    const nextId = currentRecordId || getNextSupplierNumericId();
    const payload = {
        id: nextId,
        supplier: supplierName,
        tin: normalizeText(document.getElementById('supplierTinInput').value),
        address: normalizeText(document.getElementById('supplierAddressInput').value),
        contact_person: normalizeText(document.getElementById('supplierContactPersonInput').value),
        mobile: normalizeText(document.getElementById('supplierMobileInput').value),
        landline: normalizeText(document.getElementById('supplierLandlineInput').value),
        email: normalizeText(document.getElementById('supplierEmailInput').value),
        product: normalizeText(document.getElementById('supplierProductInput').value),
        department_name: normalizeText(document.getElementById('supplierDepartmentInput').value),
        isinactive: Number(document.getElementById('supplierStatusInput').value || 0)
    };
    const targetDocId = currentDocId || String(nextId);

    setSupplierFormSaving(true);
    try {
        let result;
        if (currentDocId) {
            result = await patchDocument('tbl_supplier', targetDocId, payload, {
                label: `Supplier ${supplierName}`,
                dedupeKey: `tbl_supplier:${targetDocId}`
            });
        } else {
            result = await setDocument('tbl_supplier', targetDocId, payload, {
                label: `Supplier ${supplierName}`,
                dedupeKey: `tbl_supplier:${targetDocId}`
            });
        }
        upsertLocalSupplierRow(targetDocId, payload);
        closeSupplierForm();
        document.getElementById('supplierSearchInput').value = supplierName;
        renderOverview();
        resetPageAndRender('suppliers');
        if (result?.queued) {
            setStatus('Offline mode: supplier save queued until connection returns.');
            MargaUtils.showToast(currentDocId ? 'Supplier update saved offline and queued.' : 'Supplier saved offline and queued.', 'info');
        } else {
            MargaUtils.showToast(currentDocId ? 'Supplier updated.' : 'Supplier saved.', 'success');
            await loadInventoryData();
        }
    } catch (error) {
        console.error('Failed to save supplier:', error);
        MargaUtils.showToast('Supplier save failed. Please try again.', 'error');
    } finally {
        setSupplierFormSaving(false);
    }
}

function setSupplierFormSaving(isSaving) {
    INVENTORY_STATE.savingSupplier = Boolean(isSaving);
    const saveButton = document.getElementById('supplierFormSaveBtn');
    const clearButton = document.getElementById('supplierFormClearBtn');
    const cancelButton = document.getElementById('supplierFormCancelBtn');
    saveButton.disabled = isSaving;
    clearButton.disabled = isSaving;
    cancelButton.disabled = isSaving;
    saveButton.textContent = isSaving ? 'Saving…' : (document.getElementById('supplierDocIdInput').value ? 'Update Supplier' : 'Save Supplier');
}

function getNextSupplierNumericId() {
    return INVENTORY_STATE.suppliers.reduce((maxId, row) => Math.max(maxId, Number(row.id || 0)), 0) + 1;
}

function upsertLocalSupplierRow(docId, payload) {
    const normalized = normalizeSupplierRow({
        ...payload,
        _docId: docId
    });
    const nextRows = INVENTORY_STATE.suppliers.slice();
    const index = nextRows.findIndex((row) => row.docId === normalized.docId || Number(row.id || 0) === Number(normalized.id || 0));
    if (index >= 0) {
        nextRows[index] = normalized;
    } else {
        nextRows.push(normalized);
    }
    INVENTORY_STATE.suppliers = nextRows.sort((left, right) => left.name.localeCompare(right.name));
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
